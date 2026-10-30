const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

async function fetch_repository_context({ repo_name, token }) {
    if (!token) return "Error: GitHub token is required for fetching repository.";

    const cloneDir = path.join(os.tmpdir(), `caesarion_repo_${Date.now()}`);
    const url = `https://${token}@github.com/${repo_name}.git`;

    try {
        // Shallow clone
        execSync(`git clone --depth 1 ${url} ${cloneDir}`, { stdio: 'ignore' });

        let allContent = '';
        const limitChars = 80000; // Roughly 20k tokens

        function walk(dir) {
            let results = [];
            const list = fs.readdirSync(dir);
            list.forEach(file => {
                file = path.join(dir, file);
                const stat = fs.statSync(file);
                if (stat && stat.isDirectory()) {
                    // Skip hidden dirs like .git
                    if (!file.includes('.git')) {
                        results = results.concat(walk(file));
                    }
                } else {
                    results.push(file);
                }
            });
            return results;
        }

        const files = walk(cloneDir);
        for (const file of files) {
            if (allContent.length > limitChars) break;

            try {
                // Read file, skip binaries or very large files easily by catching errors or ignoring
                const content = fs.readFileSync(file, 'utf-8');
                const relPath = path.relative(cloneDir, file);
                const block = `\n--- File: ${relPath} ---\n${content}\n`;

                if (allContent.length + block.length < limitChars) {
                    allContent += block;
                } else {
                    const remaining = limitChars - allContent.length;
                    allContent += block.substring(0, remaining) + "\n...[TRUNCATED]\n";
                    break;
                }
            } catch (err) {
                // Ignore binary files or read errors
            }
        }

        execSync(`rm -rf ${cloneDir}`); // Cleanup
        return allContent || "Repository is empty or unreadable.";

    } catch (error) {
        return `Error fetching repository context: ${error.message}`;
    }
}

async function create_pull_request({ repo_name, title, body, head, base = "main", token }) {
    if (!token) return "Error: GitHub token is required but not provided in environment context.";

    try {
        const response = await fetch(`https://api.github.com/repos/${repo_name}/pulls`, {
            method: 'POST',
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ title, body, head, base })
        });

        const data = await response.json();

        if (response.ok) {
            return `Successfully created PR: ${data.html_url}`;
        } else {
            return `Error creating PR: ${data.message}`;
        }
    } catch (error) {
        return `Error creating PR: ${error.message}`;
    }
}

const github_tools = [
    {
        type: "function",
        function: {
            name: "fetch_repository_context",
            description: "Clones a GitHub repository and returns the concatenated content of its files up to ~20,000 tokens.",
            parameters: {
                type: "object",
                properties: {
                    repo_name: { type: "string", description: "The full repository name, e.g. 'owner/repo'." }
                },
                required: ["repo_name"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "create_pull_request",
            description: "Creates a pull request on GitHub.",
            parameters: {
                type: "object",
                properties: {
                    repo_name: { type: "string", description: "The full repository name, e.g. 'owner/repo'." },
                    title: { type: "string", description: "The PR title." },
                    body: { type: "string", description: "The PR body/description." },
                    head: { type: "string", description: "The name of the branch where your changes are implemented." },
                    base: { type: "string", description: "The name of the branch you want the changes pulled into. Default is main." }
                },
                required: ["repo_name", "title", "body", "head"]
            }
        }
    }
];

module.exports = { create_pull_request, fetch_repository_context, github_tools };
