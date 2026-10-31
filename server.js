const http = require('http');
const fs = require('fs');
const path = require('path');
const { Agent } = require('./src/agent');
const { get_workspace_tree } = require('./src/tools/file_system');
const os = require('os');
const { execSync } = require('child_process');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const SESSION_FILE = path.join(os.tmpdir(), 'caesarion_session.json');

function loadSession() {
    try {
        if (fs.existsSync(SESSION_FILE)) {
            const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
            return {
                chatHistory: data.chatHistory || [],
                agentMessages: data.agentMessages || []
            };
        }
    } catch (e) {
        console.error("Failed to load session file:", e.message);
    }
    return { chatHistory: [], agentMessages: [] };
}

function saveSession(chatHistory, agentMessages = []) {
    try {
        fs.writeFileSync(SESSION_FILE, JSON.stringify({ chatHistory, agentMessages }, null, 2), 'utf-8');
    } catch (e) {
        console.error("Failed to save session file:", e.message);
    }
}

let session = loadSession();
let activeAgent = null; // Cache session
let chatHistory = session.chatHistory;

const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/api/history') {
        // Always sync with disk in case another process or invocation updated it
        const currentSession = loadSession();
        chatHistory = currentSession.chatHistory;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ history: chatHistory }));
        return;
    }

    if (req.method === 'GET' && req.url === '/api/files') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(get_workspace_tree());
        return;
    }

    if (req.method === 'GET' && req.url.startsWith('/api/download')) {
        const urlParams = new URLSearchParams(req.url.split('?')[1]);
        const fileParam = urlParams.get('file');

        if (!fileParam) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Missing file parameter');
            return;
        }

        const workspace = path.join(os.tmpdir(), 'caesarion_workspace');
        // Safely resolve the path inside the workspace
        const requestedFile = path.normalize(path.join(workspace, fileParam));

        // Prevent path traversal escape
        if (!requestedFile.startsWith(workspace)) {
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            res.end('403 Forbidden');
            return;
        }

        try {
            const data = fs.readFileSync(requestedFile);
            res.writeHead(200, {
                'Content-Type': 'application/octet-stream',
                'Content-Disposition': `attachment; filename="${path.basename(requestedFile)}"`
            });
            res.end(data);
        } catch (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('File not found or unreadable');
        }
        return;
    }

    // Preview server for workspace files
    if (req.method === 'GET' && (req.url === '/preview' || req.url.startsWith('/preview/') || req.url.startsWith('/preview?'))) {
        const workspace = path.join(os.tmpdir(), 'caesarion_workspace');
        const rawPath = req.url.split('?')[0];
        let relativePath = rawPath.replace(/^\/preview(\/)?/, '');

        if (!relativePath || relativePath === '') {
            relativePath = 'index.html';
        }

        // Safely resolve and prevent path traversal escape
        const requestedFile = path.normalize(path.join(workspace, relativePath));

        if (!requestedFile.startsWith(workspace)) {
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            res.end('403 Forbidden');
            return;
        }

        try {
            let stat = fs.statSync(requestedFile);
            let finalFile = requestedFile;
            if (stat.isDirectory()) {
                finalFile = path.join(requestedFile, 'index.html');
                stat = fs.statSync(finalFile);
            }

            const data = fs.readFileSync(finalFile);
            const ext = path.extname(finalFile).toLowerCase();
            const mimeTypes = {
                '.html': 'text/html',
                '.htm': 'text/html',
                '.js': 'text/javascript',
                '.mjs': 'text/javascript',
                '.css': 'text/css',
                '.json': 'application/json',
                '.png': 'image/png',
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.gif': 'image/gif',
                '.svg': 'image/svg+xml',
                '.ico': 'image/x-icon',
                '.txt': 'text/plain',
                '.wasm': 'application/wasm'
            };
            const contentType = mimeTypes[ext] || 'application/octet-stream';

            res.writeHead(200, { 'Content-Type': contentType });
            res.end(data);
            return;
        } catch (err) {
            res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="utf-8">
                    <title>Caesarion Preview - Not Found</title>
                    <style>
                        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f1117; color: #f3f4f6; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                        .card { background: #181b24; border: 1px solid #2b3042; padding: 32px; border-radius: 12px; max-width: 480px; text-align: center; }
                        h2 { margin-top: 0; color: #ef4444; }
                        p { color: #9ca3af; line-height: 1.5; }
                        code { background: #13151e; padding: 2px 6px; border-radius: 4px; color: #60a5fa; font-family: monospace; }
                    </style>
                </head>
                <body>
                    <div class="card">
                        <h2>No Preview Available</h2>
                        <p>No <code>index.html</code> was found in the Virtual VM workspace yet.</p>
                        <p>Ask Caesarion to create an <code>index.html</code> file or build your app first, then refresh this preview page!</p>
                    </div>
                </body>
                </html>
            `);
            return;
        }
    }

    // Serve static files
    if (req.method === 'GET') {
        let filePath = req.url === '/' ? '/index.html' : req.url;
        // Normalize the path to resolve any ../
        filePath = path.normalize(path.join(PUBLIC_DIR, filePath));

        // Prevent directory traversal
        if (!filePath.startsWith(PUBLIC_DIR)) {
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            res.end('403 Forbidden');
            return;
        }

        try {
            const data = fs.readFileSync(filePath);
            const ext = path.extname(filePath);
            let contentType = 'text/plain';
            if (ext === '.html') contentType = 'text/html';
            if (ext === '.js') contentType = 'text/javascript';
            if (ext === '.css') contentType = 'text/css';

            res.writeHead(200, { 'Content-Type': contentType });
            res.end(data);
            return;
        } catch (error) {
            if (error.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('404 Not Found');
            } else {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('500 Internal Server Error');
            }
            return;
        }
    }

    if (req.method === 'POST' && req.url === '/api/reset') {
        activeAgent = null;
        chatHistory = [];
        try {
            if (fs.existsSync(SESSION_FILE)) {
                fs.unlinkSync(SESSION_FILE);
            }
            const workspace = path.join(os.tmpdir(), 'caesarion_workspace');
            if (fs.existsSync(workspace)) {
                // Securely empty the directory using fs module instead of fragile bash exec
                fs.rmSync(workspace, { recursive: true, force: true });
                fs.mkdirSync(workspace, { recursive: true });
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: "Session and workspace reset." }));
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }

    // Handle API requests
    if (req.method === 'POST' && req.url === '/api/run') {
        let bodyStr = '';
        req.on('data', chunk => bodyStr += chunk.toString());
        req.on('end', async () => {
            try {
                const { apiUrl, apiKey, model, task } = JSON.parse(bodyStr);

                // Set up SSE (Server-Sent Events) to stream logs
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive'
                });

                const sendLog = (msg) => {
                    res.write(`data: ${JSON.stringify({ type: 'log', message: msg })}\n\n`);
                };

                const currentSession = loadSession();
                chatHistory = currentSession.chatHistory;

                if (!activeAgent) {
                    activeAgent = new Agent(apiUrl, apiKey, model);
                    if (currentSession.agentMessages && currentSession.agentMessages.length > 0) {
                        activeAgent.messages = currentSession.agentMessages;
                    }
                } else {
                    // Update credentials if they changed
                    activeAgent.apiUrl = apiUrl.replace(/\/+$/, '');
                    activeAgent.apiKey = apiKey;
                    activeAgent.model = model;
                }

                chatHistory.push({ role: 'user', content: task });
                saveSession(chatHistory, activeAgent.messages);

                let currentTurnAgentLogs = [];
                for await (const logMessage of activeAgent.run(task)) {
                    const trimmed = logMessage.trim();
                    currentTurnAgentLogs.push(trimmed);
                    sendLog(trimmed);
                }

                if (currentTurnAgentLogs.length > 0) {
                    chatHistory.push({ role: 'agent', content: currentTurnAgentLogs.join('\n') + '\n' });
                }

                saveSession(chatHistory, activeAgent.messages);

                res.end();
            } catch (error) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: error.message }));
            }
        });
        return;
    }

    // Default route
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
});

server.listen(PORT, () => {
    console.log(`Caesarion server running at http://localhost:${PORT}`);
});
