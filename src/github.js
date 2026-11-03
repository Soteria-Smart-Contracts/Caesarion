const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const zlib = require('zlib');

const WORKSPACE = path.join(os.tmpdir(), 'caesarion_workspace');
const MAX_REPO_SIZE_BYTES = 50 * 1024 * 1024; // 50MB
const CAESARION_BRANCH = 'caesarion-branch';

// GitHub OAuth App Client ID (supports standard OAuth apps or device authorization)
// Configured via GITHUB_CLIENT_ID environment variable
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';

/**
 * Compute Git Blob SHA1 hash locally (blob <size>\0<content>)
 */
function computeGitBlobSha(contentBuffer) {
    const header = Buffer.from(`blob ${contentBuffer.length}\0`);
    return crypto.createHash('sha1').update(Buffer.concat([header, contentBuffer])).digest('hex');
}

/**
 * Perform a GitHub API request with authentication
 */
async function githubRequest(endpoint, token, options = {}) {
    const url = endpoint.startsWith('https://') ? endpoint : `https://api.github.com${endpoint}`;
    const headers = {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Caesarion-Agent',
        ...(options.headers || {})
    };
    if (token) {
        headers['Authorization'] = `token ${token}`;
    }

    const res = await fetch(url, {
        ...options,
        headers
    });

    const contentType = res.headers.get('content-type') || '';
    let data;
    if (contentType.includes('application/json')) {
        data = await res.json();
    } else {
        data = await res.text();
    }

    if (!res.ok) {
        const errorMsg = (typeof data === 'object' && data.message) ? data.message : String(data);
        const err = new Error(errorMsg);
        err.status = res.status;
        err.data = data;
        throw err;
    }

    return data;
}

/**
 * Start GitHub Device Authorization Flow
 */
async function startDeviceFlow(clientId = GITHUB_CLIENT_ID) {
    if (!clientId) {
        throw new Error('OAuth Client ID not configured. Please connect using a GitHub Personal Access Token or configure GITHUB_CLIENT_ID.');
    }

    let res;
    let data;
    try {
        res = await fetch('https://github.com/login/device/code', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                client_id: clientId,
                scope: 'repo user'
            })
        });

        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            data = await res.json();
        } else {
            const text = await res.text();
            data = { error: text };
        }
    } catch (netErr) {
        throw new Error(`Network error connecting to GitHub: ${netErr.message}`);
    }

    if (!res.ok || data.error) {
        if (res.status === 404 || data.error === 'Not Found') {
            throw new Error(`GitHub OAuth App with Client ID "${clientId}" was not found or does not have Device Flow enabled. Please connect using a GitHub Personal Access Token, or configure a valid GITHUB_CLIENT_ID.`);
        }
        throw new Error(data.error_description || data.error || 'Failed to initiate device flow');
    }

    return data; // { device_code, user_code, verification_uri, expires_in, interval }
}

/**
 * Poll for GitHub Device Authorization Token
 */
async function pollDeviceToken(deviceCode, clientId = GITHUB_CLIENT_ID) {
    const res = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            client_id: clientId,
            device_code: deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        })
    });

    const data = await res.json();
    return data; // { access_token, token_type, scope } or { error: 'authorization_pending' | 'slow_down' | ... }
}

/**
 * Exchange OAuth web code for access token
 */
async function exchangeOAuthCode(code, clientId = GITHUB_CLIENT_ID, clientSecret = GITHUB_CLIENT_SECRET) {
    const res = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            client_id: clientId,
            client_secret: clientSecret,
            code
        })
    });

    const data = await res.json();
    if (data.error) {
        throw new Error(data.error_description || data.error);
    }
    return data;
}

/**
 * Get authenticated user info
 */
async function getAuthenticatedUser(token) {
    return await githubRequest('/user', token);
}

/**
 * List all repositories for the user (owned and accessible)
 */
async function listUserRepositories(token) {
    let allRepos = [];
    let page = 1;
    while (page <= 5) { // fetch up to 500 repos
        const repos = await githubRequest(`/user/repos?per_page=100&page=${page}&sort=updated`, token);
        if (!Array.isArray(repos) || repos.length === 0) break;
        allRepos = allRepos.concat(repos.map(r => ({
            id: r.id,
            name: r.name,
            full_name: r.full_name,
            owner: r.owner.login,
            private: r.private,
            default_branch: r.default_branch,
            size: r.size, // Size in KB
            html_url: r.html_url,
            description: r.description
        })));
        if (repos.length < 100) break;
        page++;
    }
    return allRepos;
}

/**
 * List branches for a repository
 */
async function listRepoBranches(owner, repo, token) {
    const branches = await githubRequest(`/repos/${owner}/${repo}/branches?per_page=100`, token);
    return branches.map(b => ({
        name: b.name,
        commit: b.commit.sha
    }));
}

/**
 * Get repository details including size check
 */
async function checkRepoSize(owner, repo, token) {
    const repoData = await githubRequest(`/repos/${owner}/${repo}`, token);
    const sizeBytes = (repoData.size || 0) * 1024;
    return {
        sizeBytes,
        sizeKB: repoData.size,
        exceedsLimit: sizeBytes > MAX_REPO_SIZE_BYTES,
        default_branch: repoData.default_branch
    };
}

/**
 * Load repo files into the Virtual VM workspace
 */
async function loadRepoToWorkspace(owner, repo, branch, token) {
    // 1. Check size limit
    const sizeCheck = await checkRepoSize(owner, repo, token);
    if (sizeCheck.exceedsLimit) {
        throw new Error(`Larger repositories are not yet supported. Repository size is ${(sizeCheck.sizeBytes / (1024*1024)).toFixed(1)}MB, maximum allowed is 50MB.`);
    }

    // 2. Clear current workspace
    if (fs.existsSync(WORKSPACE)) {
        fs.rmSync(WORKSPACE, { recursive: true, force: true });
    }
    fs.mkdirSync(WORKSPACE, { recursive: true });

    // 3. Get branch ref / commit to extract tree
    const branchData = await githubRequest(`/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`, token);
    const commitSha = branchData.commit.sha;

    // 4. Get Git tree recursively
    const treeData = await githubRequest(`/repos/${owner}/${repo}/git/trees/${commitSha}?recursive=1`, token);
    if (!treeData.tree || !Array.isArray(treeData.tree)) {
        throw new Error("Failed to retrieve repository tree from GitHub.");
    }

    // Check tree total size if truncated or calculate size
    let calculatedBytes = 0;
    const blobItems = treeData.tree.filter(item => item.type === 'blob');
    for (const item of blobItems) {
        calculatedBytes += (item.size || 0);
    }
    if (calculatedBytes > MAX_REPO_SIZE_BYTES) {
        throw new Error(`Larger repositories are not yet supported. Repository uncompressed file content is ${(calculatedBytes / (1024*1024)).toFixed(1)}MB, maximum allowed is 50MB.`);
    }

    // 5. Download blob contents
    // Use raw content or git blob API
    for (const item of blobItems) {
        const filePath = path.join(WORKSPACE, item.path);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });

        // Fetch blob content
        const blob = await githubRequest(item.url, token);
        let contentBuffer;
        if (blob.encoding === 'base64') {
            contentBuffer = Buffer.from(blob.content, 'base64');
        } else {
            contentBuffer = Buffer.from(blob.content || '', 'utf8');
        }
        fs.writeFileSync(filePath, contentBuffer);
    }

    // 6. Ensure `caesarion-branch` exists remotely
    const caesarionBranchName = 'caesarion-branch';
    let targetBranchCreated = false;
    try {
        // Check if caesarion-branch already exists
        await githubRequest(`/repos/${owner}/${repo}/git/ref/heads/${caesarionBranchName}`, token);
        // If it exists, update it or keep it at current commit
        targetBranchCreated = true;
    } catch (e) {
        // Doesn't exist, create it from base branch commitSha
        try {
            await githubRequest(`/repos/${owner}/${repo}/git/refs`, token, {
                method: 'POST',
                body: JSON.stringify({
                    ref: `refs/heads/${caesarionBranchName}`,
                    sha: commitSha
                })
            });
            targetBranchCreated = true;
        } catch (createErr) {
            console.error("Error creating caesarion-branch:", createErr.message);
        }
    }

    return {
        loadedFilesCount: blobItems.length,
        baseBranch: branch,
        targetBranch: caesarionBranchName,
        commitSha
    };
}

/**
 * Get all files currently in WORKSPACE as a map of relativePath -> Buffer
 */
function getWorkspaceFilesMap(dir = WORKSPACE, baseDir = WORKSPACE) {
    let files = {};
    if (!fs.existsSync(dir)) return files;
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            Object.assign(files, getWorkspaceFilesMap(fullPath, baseDir));
        } else {
            const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
            files[relPath] = fs.readFileSync(fullPath);
        }
    }
    return files;
}

/**
 * Sync workspace diffs to caesarion-branch on GitHub
 */
async function syncBranchDiffs(owner, repo, branch = CAESARION_BRANCH, token) {
    const currentFiles = getWorkspaceFilesMap();
    const currentPaths = Object.keys(currentFiles);

    // 1. Get branch commit ref
    let branchRef;
    try {
        branchRef = await githubRequest(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, token);
    } catch (e) {
        try {
            branchRef = await githubRequest(`/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, token);
        } catch (e2) {
            throw new Error(`Branch ${branch} not found on GitHub.`);
        }
    }

    const currentCommitSha = Array.isArray(branchRef) ? branchRef[0]?.object?.sha : branchRef?.object?.sha;
    if (!currentCommitSha) {
        throw new Error(`Could not resolve commit SHA for branch ${branch}`);
    }

    const commitData = await githubRequest(`/repos/${owner}/${repo}/git/commits/${currentCommitSha}`, token);
    const baseTreeSha = commitData.tree.sha;

    // 2. Get current remote tree
    const remoteTreeData = await githubRequest(`/repos/${owner}/${repo}/git/trees/${baseTreeSha}?recursive=1`, token);
    const remoteItems = (remoteTreeData.tree || []).filter(item => item.type === 'blob');
    const remoteMap = {};
    remoteItems.forEach(item => {
        remoteMap[item.path] = item.sha;
    });

    // 3. Find diffs locally without making unnecessary POST blob requests!
    const treeUpdates = [];
    let hasDiff = false;

    // Detect additions and modifications by comparing local git blob sha with remote sha
    for (const relPath of currentPaths) {
        const contentBuf = currentFiles[relPath];
        const localSha = computeGitBlobSha(contentBuf);

        if (remoteMap[relPath] !== localSha) {
            hasDiff = true;
            // Only upload the blob to GitHub if the file actually changed
            const contentBase64 = contentBuf.toString('base64');
            const blobRes = await githubRequest(`/repos/${owner}/${repo}/git/blobs`, token, {
                method: 'POST',
                body: JSON.stringify({
                    content: contentBase64,
                    encoding: 'base64'
                })
            });

            treeUpdates.push({
                path: relPath,
                mode: '100644',
                type: 'blob',
                sha: blobRes.sha
            });
        }
    }

    // Detect deletions
    for (const remotePath of Object.keys(remoteMap)) {
        if (!currentFiles[remotePath]) {
            hasDiff = true;
            treeUpdates.push({
                path: remotePath,
                mode: '100644',
                type: 'blob',
                sha: null
            });
        }
    }

    // Only push if diffs exist
    if (!hasDiff || treeUpdates.length === 0) {
        return { synced: false, message: 'No diffs detected', commitSha: currentCommitSha };
    }

    // 4. Create new tree
    const newTree = await githubRequest(`/repos/${owner}/${repo}/git/trees`, token, {
        method: 'POST',
        body: JSON.stringify({
            base_tree: baseTreeSha,
            tree: treeUpdates
        })
    });

    // 5. Create new commit
    const newCommit = await githubRequest(`/repos/${owner}/${repo}/git/commits`, token, {
        method: 'POST',
        body: JSON.stringify({
            message: `Caesarion workspace sync: ${new Date().toISOString()}`,
            tree: newTree.sha,
            parents: [currentCommitSha]
        })
    });

    // 6. Update branch ref
    await githubRequest(`/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, token, {
        method: 'PATCH',
        body: JSON.stringify({
            sha: newCommit.sha,
            force: true
        })
    });

    return {
        synced: true,
        message: 'Branch synched',
        commitSha: newCommit.sha,
        diffCount: treeUpdates.length
    };
}

/**
 * Generate PR Title and Description (<= 60 words) via single LLM call
 */
async function generatePRSummary(apiUrl, apiKey, model, changesDescription) {
    if (!apiUrl || !apiKey || !model) {
        return {
            title: 'Caesarion automated updates',
            description: 'Automated workspace updates generated by Caesarion.'
        };
    }

    try {
        const prompt = `You are a software engineer creating a Pull Request.
Here is a summary of recent changes made in the workspace:
${changesDescription}

Generate a concise JSON response containing:
1. "title": A clear, conventional PR title (e.g. "feat: add user authentication flow").
2. "description": A concise PR description summarizing the changes in 60 words or less.

Format strictly as JSON:
{"title": "...", "description": "..."}`;

        const res = await fetch(`${apiUrl.replace(/\/+$/, '')}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: 'You are an AI assistant that writes concise GitHub Pull Request titles and descriptions.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.3
            })
        });

        if (!res.ok) {
            throw new Error(`LLM Error: ${res.status}`);
        }

        const data = await res.json();
        const content = data.choices[0].message.content.trim();
        // Extract JSON block if wrapped
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            let desc = parsed.description || 'Automated updates by Caesarion.';
            // Enforce max 60 words
            const words = desc.split(/\s+/);
            if (words.length > 60) {
                desc = words.slice(0, 60).join(' ') + '...';
            }
            return {
                title: parsed.title || 'Caesarion automated updates',
                description: desc
            };
        }
    } catch (e) {
        console.error("Failed to generate AI PR summary:", e.message);
    }

    return {
        title: 'Caesarion automated updates',
        description: 'Updates and code changes generated and synchronized by Caesarion.'
    };
}

/**
 * Create GitHub Pull Request
 */
async function createPullRequest(owner, repo, headBranch, baseBranch, title, body, token) {
    const pr = await githubRequest(`/repos/${owner}/${repo}/pulls`, token, {
        method: 'POST',
        body: JSON.stringify({
            title,
            body,
            head: headBranch,
            base: baseBranch
        })
    });

    return {
        id: pr.id,
        number: pr.number,
        html_url: pr.html_url,
        state: pr.state
    };
}

module.exports = {
    GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET,
    MAX_REPO_SIZE_BYTES,
    githubRequest,
    startDeviceFlow,
    pollDeviceToken,
    exchangeOAuthCode,
    getAuthenticatedUser,
    listUserRepositories,
    listRepoBranches,
    checkRepoSize,
    loadRepoToWorkspace,
    syncBranchDiffs,
    generatePRSummary,
    createPullRequest
};
