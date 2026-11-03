// State variables
let currentSelectedFile = null;
let currentViewMode = 'chat'; // 'chat' or 'split'

// GitHub Session State
let githubState = {
    token: null,
    user: null,
    activeRepo: null,       // { owner, repo, name, defaultBranch, size }
    baseBranch: null,
    caesarionBranch: 'caesarion-branch',
    devicePollTimer: null,
    autoSyncTimer: null
};

// DOM Elements
const appContainer = document.getElementById('appContainer');
const viewChatOnlyBtn = document.getElementById('viewChatOnlyBtn');
const viewEditorSplitBtn = document.getElementById('viewEditorSplitBtn');
const downloadZipBtn = document.getElementById('downloadZipBtn');
const editorFilePath = document.getElementById('editorFilePath');
const editorTextarea = document.getElementById('editorTextarea');
const editorEmptyState = document.getElementById('editorEmptyState');
const saveFileBtn = document.getElementById('saveFileBtn');
const editorStatusMsg = document.getElementById('editorStatusMsg');
const chatColumnTitle = document.getElementById('chatColumnTitle');
const createPrBtn = document.getElementById('createPrBtn');
const branchSyncStatus = document.getElementById('branchSyncStatus');

// GitHub Modal Elements
const githubModal = document.getElementById('githubModal');
const closeGithubModal = document.getElementById('closeGithubModal');
const sidebarGithubBtn = document.getElementById('sidebarGithubBtn');
const settingsGithubConnectBtn = document.getElementById('settingsGithubConnectBtn');
const settingsGithubDisconnectBtn = document.getElementById('settingsGithubDisconnectBtn');
const settingsGithubConnectedState = document.getElementById('settingsGithubConnectedState');
const settingsGithubUser = document.getElementById('settingsGithubUser');

const githubAuthView = document.getElementById('githubAuthView');
const githubRepoView = document.getElementById('githubRepoView');
const githubModalFooter = document.getElementById('githubModalFooter');
const startGithubDeviceAuthBtn = document.getElementById('startGithubDeviceAuthBtn');
const deviceCodeBox = document.getElementById('deviceCodeBox');
const userCodeDisplay = document.getElementById('userCodeDisplay');
const verificationLink = document.getElementById('verificationLink');
const devicePollStatus = document.getElementById('devicePollStatus');
const githubPatInput = document.getElementById('githubPatInput');
const savePatBtn = document.getElementById('savePatBtn');

const githubUserAvatar = document.getElementById('githubUserAvatar');
const githubUserName = document.getElementById('githubUserName');
const disconnectGithubBtn = document.getElementById('disconnectGithubBtn');
const githubRepoSelect = document.getElementById('githubRepoSelect');
const githubBranchGroup = document.getElementById('githubBranchGroup');
const githubBranchSelect = document.getElementById('githubBranchSelect');
const repoSizeNotice = document.getElementById('repoSizeNotice');
const repoLoadError = document.getElementById('repoLoadError');
const loadRepoBtn = document.getElementById('loadRepoBtn');

// Load cached credentials and restore chat history on page load
document.addEventListener("DOMContentLoaded", async () => {
    const cachedApiUrl = localStorage.getItem("caesarion_apiUrl");
    const cachedApiKey = localStorage.getItem("caesarion_apiKey");
    const cachedModel = localStorage.getItem("caesarion_model");
    const cachedViewMode = localStorage.getItem("caesarion_viewMode");

    if (cachedApiUrl) document.getElementById('apiUrl').value = cachedApiUrl;
    if (cachedApiKey) document.getElementById('apiKey').value = cachedApiKey;
    if (cachedModel) document.getElementById('model').value = cachedModel;

    if (cachedViewMode === 'split') {
        setViewMode('split');
    } else {
        setViewMode('chat');
    }

    // Restore GitHub session
    initGitHubSession();

    await loadChatHistory();
    updateFileTree();
});

// Typewriter rendering queue for smooth, paced output
class TypewriterQueue {
    constructor() {
        this.queue = [];
        this.isRunning = false;
    }

    add(targetElem, text, speedMs = 20, isBackend = false, onComplete = null) {
        return new Promise((resolve) => {
            this.queue.push({
                targetElem,
                text,
                speedMs,
                isBackend,
                onComplete: () => {
                    if (onComplete) onComplete();
                    resolve();
                }
            });
            if (!this.isRunning) {
                this.processNext();
            }
        });
    }

    async processNext() {
        if (this.queue.length === 0) {
            this.isRunning = false;
            return;
        }

        this.isRunning = true;
        const item = this.queue.shift();
        const { targetElem, text, speedMs, onComplete } = item;

        targetElem.classList.add('cursor-blink');

        const chunkSize = speedMs < 15 ? 3 : 1;
        let index = 0;

        await new Promise((resolve) => {
            const timer = setInterval(() => {
                if (index < text.length) {
                    const chunk = text.slice(index, index + chunkSize);
                    targetElem.textContent += chunk;
                    index += chunkSize;
                } else {
                    clearInterval(timer);
                    targetElem.classList.remove('cursor-blink');
                    resolve();
                }
            }, Math.max(5, speedMs));
        });

        if (onComplete) onComplete();
        this.processNext();
    }
}

const typewriter = new TypewriterQueue();

function scrollChatToBottom(force = false) {
    const logsDiv = document.getElementById('logs');
    if (!logsDiv) return;
    if (force) {
        logsDiv.scrollTop = logsDiv.scrollHeight;
    }
}

async function loadChatHistory() {
    try {
        const res = await fetch('/api/history');
        if (!res.ok) return;
        const data = await res.json();
        if (data.history && data.history.length > 0) {
            removeEmptyState();
            const logsDiv = document.getElementById('logs');
            logsDiv.innerHTML = '';
            for (const item of data.history) {
                if (item.role === 'user') {
                    const p = document.createElement('div');
                    p.className = 'user-msg';
                    p.textContent = item.content;
                    logsDiv.appendChild(p);
                } else if (item.role === 'agent') {
                    if (item.backendLogs && item.backendLogs.length > 0) {
                        const card = createBackendCard(item.modifiedFiles || []);
                        const body = card.querySelector('.backend-body');
                        body.textContent = item.backendLogs.join('\n');
                        card.classList.add('collapsed');
                        const toggleBtn = card.querySelector('.backend-toggle-btn');
                        if (toggleBtn) toggleBtn.innerHTML = 'Show logs &#9660;';
                        logsDiv.appendChild(card);
                    }

                    if (item.userReplies && item.userReplies.length > 0) {
                        for (const reply of item.userReplies) {
                            const div = document.createElement('div');
                            div.className = 'agent-msg';
                            div.textContent = reply;
                            logsDiv.appendChild(div);
                        }
                    } else if (item.content && (!item.backendLogs || item.backendLogs.length === 0)) {
                        const div = document.createElement('div');
                        div.className = 'agent-msg';
                        div.textContent = item.content;
                        logsDiv.appendChild(div);
                    }
                }
            }
            logsDiv.scrollTop = logsDiv.scrollHeight;
        } else {
            showEmptyStateIfNeeded();
        }
    } catch (e) {
        console.error("Failed to load chat history:", e);
    }
}

function createBackendCard(modifiedFiles = []) {
    const card = document.createElement('div');
    card.className = 'backend-card';

    const header = document.createElement('div');
    header.className = 'backend-header';

    const titleGroup = document.createElement('div');
    titleGroup.className = 'backend-header-title';

    const titleText = document.createElement('span');
    titleText.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -2px; margin-right: 4px;"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
        Backend Execution
    `;
    titleGroup.appendChild(titleText);

    const summaryTag = document.createElement('span');
    summaryTag.className = 'backend-summary-tag';
    if (modifiedFiles.length > 0) {
        summaryTag.textContent = `${modifiedFiles.length} file${modifiedFiles.length > 1 ? 's' : ''} modified (${modifiedFiles.join(', ')})`;
    } else {
        summaryTag.textContent = 'Running tasks';
    }
    titleGroup.appendChild(summaryTag);

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'backend-toggle-btn';
    toggleBtn.type = 'button';
    toggleBtn.innerHTML = 'Hide logs &#9650;';

    const body = document.createElement('div');
    body.className = 'backend-body';

    function toggleCollapse() {
        const isCollapsed = card.classList.toggle('collapsed');
        toggleBtn.innerHTML = isCollapsed ? 'Show logs &#9660;' : 'Hide logs &#9650;';
    }

    toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleCollapse();
    });

    header.addEventListener('click', () => {
        toggleCollapse();
    });

    header.appendChild(titleGroup);
    header.appendChild(toggleBtn);
    card.appendChild(header);
    card.appendChild(body);

    return card;
}

// Modal Logic
const settingsModal = document.getElementById('settingsModal');
const settingsBtn = document.getElementById('settingsBtn');
const closeSettings = document.getElementById('closeSettings');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');

function openSettings() {
    settingsModal.style.display = 'flex';
    updateSettingsGithubUI();
}

function saveAndCloseSettings() {
    localStorage.setItem("caesarion_apiUrl", document.getElementById('apiUrl').value);
    localStorage.setItem("caesarion_apiKey", document.getElementById('apiKey').value);
    localStorage.setItem("caesarion_model", document.getElementById('model').value);
    settingsModal.style.display = 'none';
}

settingsBtn.addEventListener('click', openSettings);
closeSettings.addEventListener('click', saveAndCloseSettings);
if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener('click', saveAndCloseSettings);
}

window.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
        saveAndCloseSettings();
    }
    if (e.target === githubModal) {
        closeGithub();
    }
});

window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (settingsModal.style.display === 'flex') saveAndCloseSettings();
        if (githubModal.style.display === 'flex') closeGithub();
    }
});

// View Mode Switching
function setViewMode(mode) {
    currentViewMode = mode;
    localStorage.setItem("caesarion_viewMode", mode);

    if (mode === 'split') {
        appContainer.classList.add('mode-split');
        viewEditorSplitBtn.classList.add('active');
        viewChatOnlyBtn.classList.remove('active');
        if (chatColumnTitle) chatColumnTitle.textContent = 'Agent Assistant';
    } else {
        appContainer.classList.remove('mode-split');
        viewChatOnlyBtn.classList.add('active');
        viewEditorSplitBtn.classList.remove('active');
        if (chatColumnTitle) chatColumnTitle.textContent = 'Chat Log';
    }
}

viewChatOnlyBtn.addEventListener('click', () => setViewMode('chat'));
viewEditorSplitBtn.addEventListener('click', () => setViewMode('split'));

// -------------------------------------------------------------
// GITHUB INTEGRATION
// -------------------------------------------------------------

function initGitHubSession() {
    const cachedToken = localStorage.getItem('caesarion_github_token');
    const cachedUser = localStorage.getItem('caesarion_github_user');
    const cachedRepo = localStorage.getItem('caesarion_github_repo');
    const cachedBaseBranch = localStorage.getItem('caesarion_github_baseBranch');

    if (cachedToken) {
        githubState.token = cachedToken;
        if (cachedUser) {
            try { githubState.user = JSON.parse(cachedUser); } catch(e){}
        }
        if (cachedRepo) {
            try { githubState.activeRepo = JSON.parse(cachedRepo); } catch(e){}
        }
        if (cachedBaseBranch) {
            githubState.baseBranch = cachedBaseBranch;
        }

        // Verify token in background
        verifyGitHubToken(cachedToken);
        if (githubState.activeRepo) {
            startAutoSync();
        }
    }
    updateSettingsGithubUI();
    updatePrButtonState();
}

function updateSettingsGithubUI() {
    if (githubState.token && githubState.user) {
        if (settingsGithubConnectBtn) settingsGithubConnectBtn.style.display = 'none';
        if (settingsGithubConnectedState) settingsGithubConnectedState.style.display = 'flex';
        if (settingsGithubUser) settingsGithubUser.textContent = `Connected as @${githubState.user.login}`;
    } else {
        if (settingsGithubConnectBtn) settingsGithubConnectBtn.style.display = 'flex';
        if (settingsGithubConnectedState) settingsGithubConnectedState.style.display = 'none';
    }
}

function updatePrButtonState() {
    if (createPrBtn) {
        if (githubState.token && githubState.activeRepo) {
            createPrBtn.style.display = 'inline-flex';
            createPrBtn.disabled = false;
            createPrBtn.title = `Create Pull Request for ${githubState.activeRepo.owner}/${githubState.activeRepo.repo}`;
        } else {
            createPrBtn.style.display = 'inline-flex';
            createPrBtn.disabled = true;
            createPrBtn.title = 'Connect a GitHub repository to create PRs';
        }
    }
}

function openGithubModal() {
    githubModal.style.display = 'flex';
    if (githubState.token) {
        showConnectedRepoView();
    } else {
        showUnconnectedAuthView();
    }
}

function closeGithub() {
    githubModal.style.display = 'none';
    if (githubState.devicePollTimer) {
        clearInterval(githubState.devicePollTimer);
        githubState.devicePollTimer = null;
    }
}

if (sidebarGithubBtn) sidebarGithubBtn.addEventListener('click', openGithubModal);
if (settingsGithubConnectBtn) {
    settingsGithubConnectBtn.addEventListener('click', () => {
        saveAndCloseSettings();
        openGithubModal();
    });
}
if (settingsGithubDisconnectBtn) {
    settingsGithubDisconnectBtn.addEventListener('click', disconnectGitHub);
}
if (closeGithubModal) closeGithubModal.addEventListener('click', closeGithub);

function showUnconnectedAuthView() {
    githubAuthView.style.display = 'flex';
    githubRepoView.style.display = 'none';
    githubModalFooter.style.display = 'none';
    deviceCodeBox.style.display = 'none';
    startGithubDeviceAuthBtn.style.display = 'inline-flex';
}

function showConnectedRepoView() {
    githubAuthView.style.display = 'none';
    githubRepoView.style.display = 'flex';
    githubModalFooter.style.display = 'flex';

    if (githubState.user) {
        githubUserName.textContent = githubState.user.name ? `${githubState.user.name} (@${githubState.user.login})` : `@${githubState.user.login}`;
        if (githubState.user.avatar_url) {
            githubUserAvatar.src = githubState.user.avatar_url;
            githubUserAvatar.style.display = 'inline-block';
        }
    }

    loadUserRepositories();
}

async function verifyGitHubToken(token) {
    try {
        const res = await fetch('/api/github/user', {
            headers: { 'Authorization': `token ${token}` }
        });
        if (res.ok) {
            const user = await res.json();
            githubState.user = user;
            localStorage.setItem('caesarion_github_user', JSON.stringify(user));
            updateSettingsGithubUI();
        } else {
            // Invalid token
            disconnectGitHub();
        }
    } catch (e) {
        console.error("Token verification failed:", e);
    }
}

// Device Flow Authorization
if (startGithubDeviceAuthBtn) {
    startGithubDeviceAuthBtn.addEventListener('click', async () => {
        try {
            startGithubDeviceAuthBtn.disabled = true;
            startGithubDeviceAuthBtn.textContent = 'Requesting authorization...';

            const res = await fetch('/api/github/device-code', { method: 'POST' });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Failed to start device authorization flow');
            }

            const data = await res.json();
            userCodeDisplay.textContent = data.user_code;
            verificationLink.href = data.verification_uri;
            deviceCodeBox.style.display = 'flex';
            startGithubDeviceAuthBtn.style.display = 'none';

            // Poll for authorization
            const interval = (data.interval || 5) * 1000;
            githubState.devicePollTimer = setInterval(async () => {
                try {
                    const pollRes = await fetch('/api/github/device-token', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ device_code: data.device_code })
                    });
                    const pollData = await pollRes.json();

                    if (pollData.access_token) {
                        clearInterval(githubState.devicePollTimer);
                        githubState.devicePollTimer = null;
                        devicePollStatus.textContent = 'Authorized! Loading your profile...';

                        githubState.token = pollData.access_token;
                        localStorage.setItem('caesarion_github_token', pollData.access_token);

                        await verifyGitHubToken(pollData.access_token);
                        showConnectedRepoView();
                    } else if (pollData.error === 'authorization_pending') {
                        devicePollStatus.textContent = 'Waiting for your approval on GitHub...';
                    } else if (pollData.error === 'slow_down') {
                        // Keep waiting
                    } else if (pollData.error) {
                        clearInterval(githubState.devicePollTimer);
                        githubState.devicePollTimer = null;
                        devicePollStatus.textContent = `Error: ${pollData.error_description || pollData.error}`;
                        startGithubDeviceAuthBtn.style.display = 'inline-flex';
                        startGithubDeviceAuthBtn.disabled = false;
                        startGithubDeviceAuthBtn.textContent = 'Connect with GitHub';
                    }
                } catch (e) {
                    console.error("Polling error:", e);
                }
            }, interval);

        } catch (err) {
            alert(`GitHub Auth Error: ${err.message}`);
            startGithubDeviceAuthBtn.disabled = false;
            startGithubDeviceAuthBtn.textContent = 'Connect with GitHub';
        }
    });
}

// PAT Connect Button
if (savePatBtn) {
    savePatBtn.addEventListener('click', async () => {
        const pat = githubPatInput.value.trim();
        if (!pat) {
            alert("Please enter a valid GitHub token.");
            return;
        }

        savePatBtn.disabled = true;
        savePatBtn.textContent = 'Verifying...';

        try {
            const res = await fetch('/api/github/user', {
                headers: { 'Authorization': `token ${pat}` }
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Invalid GitHub token');
            }

            const user = await res.json();
            githubState.token = pat;
            githubState.user = user;
            localStorage.setItem('caesarion_github_token', pat);
            localStorage.setItem('caesarion_github_user', JSON.stringify(user));

            githubPatInput.value = '';
            showConnectedRepoView();
            updateSettingsGithubUI();
        } catch (err) {
            alert(`Error connecting GitHub: ${err.message}`);
        } finally {
            savePatBtn.disabled = false;
            savePatBtn.textContent = 'Connect';
        }
    });
}

function disconnectGitHub() {
    githubState.token = null;
    githubState.user = null;
    githubState.activeRepo = null;
    githubState.baseBranch = null;
    localStorage.removeItem('caesarion_github_token');
    localStorage.removeItem('caesarion_github_user');
    localStorage.removeItem('caesarion_github_repo');
    localStorage.removeItem('caesarion_github_baseBranch');

    if (githubState.autoSyncTimer) {
        clearInterval(githubState.autoSyncTimer);
        githubState.autoSyncTimer = null;
    }

    updateSettingsGithubUI();
    updatePrButtonState();
    showUnconnectedAuthView();
    updateFileTree();
}

if (disconnectGithubBtn) disconnectGithubBtn.addEventListener('click', disconnectGitHub);

// List Repositories
async function loadUserRepositories() {
    githubRepoSelect.innerHTML = '<option value="">Loading repositories...</option>';
    githubRepoSelect.disabled = true;
    githubBranchGroup.style.display = 'none';
    repoSizeNotice.style.display = 'none';
    repoLoadError.style.display = 'none';
    loadRepoBtn.disabled = true;

    try {
        const res = await fetch('/api/github/repos', {
            headers: { 'Authorization': `token ${githubState.token}` }
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to list repositories');
        }

        const data = await res.json();
        githubRepoSelect.innerHTML = '<option value="">-- Choose a repository --</option>';

        if (data.repos && data.repos.length > 0) {
            data.repos.forEach(repo => {
                const opt = document.createElement('option');
                opt.value = JSON.stringify({
                    owner: repo.owner,
                    repo: repo.name,
                    defaultBranch: repo.default_branch,
                    size: repo.size,
                    fullName: repo.full_name
                });
                opt.textContent = `${repo.full_name} ${repo.private ? '(Private)' : ''}`;
                githubRepoSelect.appendChild(opt);
            });
            githubRepoSelect.disabled = false;
        } else {
            githubRepoSelect.innerHTML = '<option value="">No repositories found.</option>';
        }
    } catch (err) {
        githubRepoSelect.innerHTML = `<option value="">Error: ${err.message}</option>`;
    }
}

// Repo selection change -> Fetch branches & check size
githubRepoSelect.addEventListener('change', async () => {
    const selectedVal = githubRepoSelect.value;
    repoLoadError.style.display = 'none';
    loadRepoBtn.disabled = true;

    if (!selectedVal) {
        githubBranchGroup.style.display = 'none';
        repoSizeNotice.style.display = 'none';
        return;
    }

    const repoInfo = JSON.parse(selectedVal);
    const sizeMB = ((repoInfo.size || 0) / 1024).toFixed(1);

    // 50MB Size Check: repoInfo.size is in KB (50MB = 51200KB)
    if (repoInfo.size > 51200) {
        repoSizeNotice.style.display = 'none';
        repoLoadError.textContent = `Error: Larger repositories are not yet supported. This repository is ${sizeMB}MB (maximum repo size is 50MB).`;
        repoLoadError.style.display = 'block';
        githubBranchGroup.style.display = 'none';
        loadRepoBtn.disabled = true;
        return;
    }

    repoSizeNotice.textContent = `Repository size: ~${sizeMB}MB (Limit: 50MB)`;
    repoSizeNotice.style.display = 'block';

    // Fetch branches for repo
    githubBranchSelect.innerHTML = '<option value="">Loading branches...</option>';
    githubBranchGroup.style.display = 'block';
    githubBranchSelect.disabled = true;

    try {
        const res = await fetch(`/api/github/branches?owner=${encodeURIComponent(repoInfo.owner)}&repo=${encodeURIComponent(repoInfo.repo)}`, {
            headers: { 'Authorization': `token ${githubState.token}` }
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to fetch branches');
        }

        const data = await res.json();
        githubBranchSelect.innerHTML = '<option value="">-- Choose a branch --</option>';

        if (data.branches && data.branches.length > 0) {
            data.branches.forEach(branch => {
                const opt = document.createElement('option');
                opt.value = branch.name;
                opt.textContent = branch.name === repoInfo.defaultBranch ? `${branch.name} (default)` : branch.name;
                if (branch.name === repoInfo.defaultBranch) {
                    opt.selected = true;
                }
                githubBranchSelect.appendChild(opt);
            });
            githubBranchSelect.disabled = false;
            loadRepoBtn.disabled = !githubBranchSelect.value;
        }
    } catch (err) {
        repoLoadError.textContent = `Failed to load branches: ${err.message}`;
        repoLoadError.style.display = 'block';
    }
});

githubBranchSelect.addEventListener('change', () => {
    loadRepoBtn.disabled = !githubBranchSelect.value;
});

// Load Repo into Workspace Button
if (loadRepoBtn) {
    loadRepoBtn.addEventListener('click', async () => {
        const repoVal = githubRepoSelect.value;
        const branchVal = githubBranchSelect.value;
        if (!repoVal || !branchVal) return;

        const repoInfo = JSON.parse(repoVal);

        loadRepoBtn.disabled = true;
        loadRepoBtn.textContent = 'Loading repository...';
        repoLoadError.style.display = 'none';

        try {
            const res = await fetch('/api/github/load-repo', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    owner: repoInfo.owner,
                    repo: repoInfo.repo,
                    branch: branchVal,
                    token: githubState.token
                })
            });

            const data = await res.json();
            if (!res.ok || data.error) {
                throw new Error(data.error || 'Failed to load repository into workspace');
            }

            // Save active repo session
            githubState.activeRepo = repoInfo;
            githubState.baseBranch = branchVal;
            localStorage.setItem('caesarion_github_repo', JSON.stringify(repoInfo));
            localStorage.setItem('caesarion_github_baseBranch', branchVal);

            closeGithub();
            updatePrButtonState();
            await updateFileTree();
            startAutoSync();

            alert(`Repository ${repoInfo.fullName} (${branchVal}) successfully loaded! Changes will sync to caesarion-branch every 30s.`);
        } catch (err) {
            repoLoadError.textContent = err.message;
            repoLoadError.style.display = 'block';
        } finally {
            loadRepoBtn.disabled = false;
            loadRepoBtn.textContent = 'Load In';
        }
    });
}

// -------------------------------------------------------------
// AUTO-SYNC WORKSPACE DIFFS EVERY 30 SECONDS
// -------------------------------------------------------------
function startAutoSync() {
    if (githubState.autoSyncTimer) {
        clearInterval(githubState.autoSyncTimer);
    }

    if (branchSyncStatus) {
        branchSyncStatus.textContent = 'Branch synched';
        branchSyncStatus.style.color = 'var(--text-dim)';
    }

    githubState.autoSyncTimer = setInterval(async () => {
        if (!githubState.token || !githubState.activeRepo) return;

        try {
            const res = await fetch('/api/github/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    owner: githubState.activeRepo.owner,
                    repo: githubState.activeRepo.repo,
                    branch: githubState.caesarionBranch,
                    token: githubState.token
                })
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Sync failed');
            }

            const data = await res.json();
            if (branchSyncStatus) {
                branchSyncStatus.textContent = 'Branch synched';
                branchSyncStatus.style.color = 'var(--success)';
                setTimeout(() => {
                    if (branchSyncStatus) branchSyncStatus.style.color = 'var(--text-dim)';
                }, 3000);
            }
        } catch (e) {
            console.error("Auto-sync error:", e.message);
            if (branchSyncStatus) {
                branchSyncStatus.textContent = 'Error synching branch';
                branchSyncStatus.style.color = 'var(--danger)';
            }
        }
    }, 30000); // 30 seconds
}

// -------------------------------------------------------------
// CREATE PULL REQUEST BUTTON
// -------------------------------------------------------------
if (createPrBtn) {
    createPrBtn.addEventListener('click', async () => {
        if (!githubState.token || !githubState.activeRepo) {
            openGithubModal();
            return;
        }

        const apiUrl = document.getElementById('apiUrl').value;
        const apiKey = document.getElementById('apiKey').value;
        const model = document.getElementById('model').value;

        createPrBtn.disabled = true;
        createPrBtn.innerHTML = `
            <svg class="spinner" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1s linear infinite;"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>
            Creating PR...
        `;

        try {
            const res = await fetch('/api/github/create-pr', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    owner: githubState.activeRepo.owner,
                    repo: githubState.activeRepo.repo,
                    headBranch: githubState.caesarionBranch,
                    baseBranch: githubState.baseBranch || 'main',
                    token: githubState.token,
                    apiUrl,
                    apiKey,
                    model
                })
            });

            const data = await res.json();
            if (!res.ok || data.error) {
                throw new Error(data.error || 'Failed to create Pull Request');
            }

            if (branchSyncStatus) {
                branchSyncStatus.textContent = 'Branch synched';
                branchSyncStatus.style.color = 'var(--success)';
            }

            // Redirect user directly to the PR page on GitHub
            if (data.prUrl) {
                window.open(data.prUrl, '_blank') || (window.location.href = data.prUrl);
            }
        } catch (err) {
            alert(`Error creating Pull Request: ${err.message}`);
        } finally {
            createPrBtn.disabled = false;
            createPrBtn.innerHTML = `
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" y1="9" x2="6" y2="21"/></svg>
                Create PR
            `;
        }
    });
}

// File Tree Polling & Selection
let treeInterval = null;
async function updateFileTree() {
    try {
        const res = await fetch('/api/files');
        const html = await res.text();
        const treeElem = document.getElementById('fileTree');
        if (treeElem) {
            // Check if workspace is empty
            const isWorkspaceEmpty = !html.trim() || html.includes('Workspace is empty.') || html.includes('(empty directory)');
            if (isWorkspaceEmpty) {
                treeElem.innerHTML = `
                    <div class="empty-filesystem-state" style="padding: 24px 12px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 12px; color: var(--text-muted); font-family: var(--font-sans);">
                        <div style="width: 40px; height: 40px; border-radius: 50%; background: var(--bg-surface-elevated); display: flex; align-items: center; justify-content: center; border: 1px solid var(--border-subtle); color: var(--text-main);">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>
                        </div>
                        <div style="font-size: 0.88rem; font-weight: 500; color: var(--text-main); line-height: 1.4;">
                            Chat to Get Started Or Initiate a remote repository session
                        </div>
                        <button id="emptyWsConnectGithubBtn" type="button" style="background-color: var(--primary); color: #ffffff; padding: 7px 12px; font-size: 0.8rem; font-weight: 500; border-radius: var(--radius-sm); margin-top: 4px;">
                            Connect GitHub
                        </button>
                    </div>
                `;
                const emptyBtn = document.getElementById('emptyWsConnectGithubBtn');
                if (emptyBtn) {
                    emptyBtn.addEventListener('click', openGithubModal);
                }
            } else {
                treeElem.innerHTML = html;
                if (currentSelectedFile) {
                    const activeLink = treeElem.querySelector(`[data-path="${CSS.escape(currentSelectedFile)}"]`);
                    if (activeLink) {
                        activeLink.classList.add('active');
                    }
                }
            }
        }
    } catch (e) {
        const treeElem = document.getElementById('fileTree');
        if (treeElem) {
            treeElem.innerHTML = '<span style="color: #ef4444;">Failed to load file tree.</span>';
        }
    }
}

// Handle File Tree Clicks (delegated)
document.getElementById('fileTree').addEventListener('click', async (e) => {
    if (e.target.closest('#emptyWsConnectGithubBtn')) return;
    const fileLink = e.target.closest('.file-item') || (e.target.tagName === 'A' ? e.target : null);
    if (!fileLink) return;

    e.preventDefault();
    const filePath = fileLink.getAttribute('data-path') || fileLink.textContent.trim();
    if (!filePath) return;

    await openFileInEditor(filePath);
});

async function openFileInEditor(filePath) {
    try {
        const res = await fetch(`/api/file?file=${encodeURIComponent(filePath)}`);
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: 'Failed to read file' }));
            throw new Error(err.error || 'Failed to read file');
        }

        const data = await res.json();
        currentSelectedFile = filePath;

        if (currentViewMode !== 'split') {
            setViewMode('split');
        }

        document.querySelectorAll('#fileTree .file-item').forEach(el => {
            if (el.getAttribute('data-path') === filePath) {
                el.classList.add('active');
            } else {
                el.classList.remove('active');
            }
        });

        editorFilePath.textContent = filePath;
        editorTextarea.value = data.content;
        editorTextarea.disabled = false;
        saveFileBtn.disabled = false;
        editorEmptyState.classList.add('hidden');
        editorTextarea.focus();
    } catch (err) {
        alert(`Error opening file "${filePath}": ${err.message}`);
    }
}

// Save File Functionality
async function saveCurrentFile() {
    if (!currentSelectedFile) return;

    const content = editorTextarea.value;
    saveFileBtn.disabled = true;
    saveFileBtn.textContent = 'Saving...';

    try {
        const res = await fetch('/api/file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file: currentSelectedFile, content })
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: 'Failed to save file' }));
            throw new Error(err.error || 'Failed to save file');
        }

        editorStatusMsg.classList.add('show');
        setTimeout(() => {
            editorStatusMsg.classList.remove('show');
        }, 2000);
    } catch (err) {
        alert(`Error saving file: ${err.message}`);
    } finally {
        saveFileBtn.disabled = false;
        saveFileBtn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            Save
        `;
    }
}

saveFileBtn.addEventListener('click', saveCurrentFile);

editorTextarea.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveCurrentFile();
    }
});

downloadZipBtn.addEventListener('click', () => {
    window.location.href = '/api/download-zip';
});

function removeEmptyState() {
    const emptyState = document.getElementById('emptyLogs');
    if (emptyState) {
        emptyState.remove();
    }
}

function showEmptyStateIfNeeded() {
    const logsDiv = document.getElementById('logs');
    if (!logsDiv.hasChildNodes() || logsDiv.children.length === 0) {
        logsDiv.innerHTML = `
            <div class="empty-state" id="emptyLogs">
                <div class="empty-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                </div>
                <h3>Chat to Get Started Or Initiate a remote repository session</h3>
                <p>Caesarion can run commands, inspect and write files, formulate plans, and autonomously solve problems in its workspace.</p>
                <button id="emptyChatConnectGithubBtn" type="button" style="background-color: var(--primary); color: #ffffff; padding: 8px 14px; font-size: 0.85rem; font-weight: 500; border-radius: var(--radius-sm); margin-top: 6px;">
                    Connect GitHub
                </button>
            </div>
        `;
        const chatEmptyBtn = document.getElementById('emptyChatConnectGithubBtn');
        if (chatEmptyBtn) {
            chatEmptyBtn.addEventListener('click', openGithubModal);
        }
    }
}

// Reset Session
document.getElementById('resetBtn').addEventListener('click', async () => {
    if (!confirm("Are you sure you want to reset the session and wipe the workspace?")) return;
    try {
        await fetch('/api/reset', { method: 'POST' });
        document.getElementById('logs').innerHTML = '';
        showEmptyStateIfNeeded();
        await updateFileTree();
        alert("Session and workspace reset successfully.");
    } catch (e) {
        alert("Error resetting session: " + e.message);
    }
});

function logUserMessage(message) {
    removeEmptyState();
    const logsDiv = document.getElementById('logs');
    const p = document.createElement('div');
    p.className = 'user-msg';
    p.textContent = message;
    logsDiv.appendChild(p);
    logsDiv.scrollTop = logsDiv.scrollHeight;
}

let currentBackendCard = null;
let currentBackendBody = null;
let currentUserMsgDiv = null;
let modifiedFilesSet = new Set();

async function handleSendMessage() {
    const apiUrl = document.getElementById('apiUrl').value;
    const apiKey = document.getElementById('apiKey').value;
    const model = document.getElementById('model').value;
    const taskInput = document.getElementById('task');
    const task = taskInput.value.trim();
    const startBtn = document.getElementById('startBtn');

    if (!apiUrl || !apiKey || !model || !task) {
        alert("Please fill in all required fields (URL, API Key, Model, Task).");
        return;
    }

    logUserMessage(task);
    taskInput.value = '';

    currentBackendCard = null;
    currentBackendBody = null;
    currentUserMsgDiv = null;
    modifiedFilesSet.clear();

    startBtn.disabled = true;
    startBtn.innerHTML = `
        <svg class="spinner" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1s linear infinite;"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>
        Running...
    `;

    treeInterval = setInterval(updateFileTree, 2000);
    const logsDiv = document.getElementById('logs');

    function ensureBackendCard() {
        if (!currentBackendCard) {
            removeEmptyState();
            currentBackendCard = createBackendCard([]);
            currentBackendBody = currentBackendCard.querySelector('.backend-body');
            logsDiv.appendChild(currentBackendCard);
        }
        return currentBackendBody;
    }

    try {
        const response = await fetch('/api/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiUrl, apiKey, model, task })
        });

        if (!response.body) throw new Error("No response body.");

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            let parts = buffer.split('\n\n');
            buffer = parts.pop();

            for (let eventStr of parts) {
                if (eventStr.startsWith('data: ')) {
                    try {
                        const event = JSON.parse(eventStr.substring(6));

                        if (event.type === 'tool_call' && event.tool === 'write_file' && event.args && event.args.filepath) {
                            modifiedFilesSet.add(event.args.filepath);
                        }

                        if (event.type === 'user_reply') {
                            removeEmptyState();
                            if (!currentUserMsgDiv) {
                                currentUserMsgDiv = document.createElement('div');
                                currentUserMsgDiv.className = 'agent-msg';
                                logsDiv.appendChild(currentUserMsgDiv);
                            }
                            await typewriter.add(currentUserMsgDiv, event.message + '\n\n', 25, false);
                        } else if (event.type === 'backend_log' || event.type === 'tool_call' || event.type === 'tool_result' || event.type === 'iteration_start') {
                            const bBody = ensureBackendCard();
                            const line = (event.message || '') + '\n';
                            await typewriter.add(bBody, line, 12, true);
                        } else if (event.type === 'turn_complete') {
                            if (event.modifiedFiles && Array.isArray(event.modifiedFiles)) {
                                event.modifiedFiles.forEach(f => modifiedFilesSet.add(f));
                            }
                        } else if (event.type === 'log') {
                            const bBody = ensureBackendCard();
                            await typewriter.add(bBody, event.message + '\n', 12, true);
                        } else if (event.type === 'error') {
                            const bBody = ensureBackendCard();
                            await typewriter.add(bBody, `Error: ${event.message}\n`, 12, true);
                        }
                    } catch (e) {
                        console.error("Parse error", e, eventStr);
                    }
                }
            }
        }
    } catch (error) {
        const bBody = ensureBackendCard();
        await typewriter.add(bBody, `Fatal Error: ${error.message}\n`, 12, true);
    } finally {
        if (currentBackendCard) {
            const filesList = Array.from(modifiedFilesSet);
            const summaryTag = currentBackendCard.querySelector('.backend-summary-tag');
            if (summaryTag) {
                if (filesList.length > 0) {
                    summaryTag.textContent = `${filesList.length} file${filesList.length > 1 ? 's' : ''} modified (${filesList.join(', ')})`;
                } else {
                    summaryTag.textContent = 'Execution finished';
                }
            }
            currentBackendCard.classList.add('collapsed');
            const toggleBtn = currentBackendCard.querySelector('.backend-toggle-btn');
            if (toggleBtn) {
                toggleBtn.innerHTML = 'Show logs &#9660;';
            }
        }

        currentBackendCard = null;
        currentBackendBody = null;
        currentUserMsgDiv = null;

        startBtn.disabled = false;
        startBtn.innerHTML = `
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            Send
        `;
        if (treeInterval) clearInterval(treeInterval);
        updateFileTree();
    }
}

document.getElementById('startBtn').addEventListener('click', handleSendMessage);

document.getElementById('task').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
    }
});
