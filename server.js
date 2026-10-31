const http = require('http');
const fs = require('fs');
const path = require('path');
const { Agent } = require('./src/agent');
const { get_workspace_tree } = require('./src/tools/file_system');
const os = require('os');
const { execSync } = require('child_process');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const WORKSPACE = path.join(os.tmpdir(), 'caesarion_workspace');

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8'
};

function getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return MIME_TYPES[ext] || 'application/octet-stream';
}

let activeAgent = null; // Cache session
let chatHistory = []; // Cache session chat history

const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/api/history') {
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

        const workspace = WORKSPACE;
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

    // Workspace Preview Server: serves index.html or requested static workspace files
    if (req.method === 'GET' && (req.url === '/preview' || req.url.startsWith('/preview/') || req.url.startsWith('/preview?'))) {
        let rawPath = req.url.split('?')[0];
        let subPath = rawPath.replace(/^\/preview\/?/, '');

        // If path is empty, default to index.html
        if (!subPath || subPath === '/') {
            subPath = 'index.html';
        }

        // Decode URI component to handle spaces/symbols
        try {
            subPath = decodeURIComponent(subPath);
        } catch (e) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Invalid URL encoding');
            return;
        }

        // Resolve absolute path and ensure it stays within WORKSPACE
        const resolvedPath = path.resolve(WORKSPACE, subPath);
        if (!resolvedPath.startsWith(WORKSPACE)) {
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            res.end('403 Forbidden');
            return;
        }

        const requestedFile = resolvedPath;

        try {
            if (fs.existsSync(requestedFile)) {
                let fileToServe = requestedFile;
                const stat = fs.statSync(requestedFile);
                if (stat.isDirectory()) {
                    fileToServe = path.join(requestedFile, 'index.html');
                }

                if (fs.existsSync(fileToServe) && !fs.statSync(fileToServe).isDirectory()) {
                    const data = fs.readFileSync(fileToServe);
                    const contentType = getMimeType(fileToServe);
                    res.writeHead(200, { 'Content-Type': contentType });
                    res.end(data);
                    return;
                }
            }

            // Fallback if index.html is missing
            res.writeHead(404, { 'Content-Type': 'text/html' });
            res.end(`<!DOCTYPE html>
<html>
<head><title>Caesarion Preview - Not Found</title></head>
<body style="font-family: sans-serif; background: #1e1e1e; color: #fff; padding: 40px; text-align: center;">
    <h2>Workspace Preview</h2>
    <p>No <code>index.html</code> found in the workspace yet.</p>
    <p style="color: #888;">Create an index.html file with Caesarion to preview it here.</p>
</body>
</html>`);
            return;
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end(`Internal Server Error: ${err.message}`);
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

                // Record user message to chat history
                chatHistory.push({ role: 'user', content: task });

                // Set up SSE (Server-Sent Events) to stream logs
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive'
                });

                let agentTurnContent = '';
                const sendLog = (msg) => {
                    agentTurnContent += msg + '\n';
                    res.write(`data: ${JSON.stringify({ type: 'log', message: msg })}\n\n`);
                };

                if (!activeAgent) {
                    activeAgent = new Agent(apiUrl, apiKey, model);
                } else {
                    // Update credentials if they changed
                    activeAgent.apiUrl = apiUrl.replace(/\/+$/, '');
                    activeAgent.apiKey = apiKey;
                    activeAgent.model = model;
                }

                for await (const logMessage of activeAgent.run(task)) {
                    sendLog(logMessage.trim());
                }

                // Record agent's response to history
                if (agentTurnContent.trim()) {
                    chatHistory.push({ role: 'agent', content: agentTurnContent.trim() });
                }

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

if (require.main === module) {
    server.listen(PORT, () => {
        console.log(`Caesarion server running at http://localhost:${PORT}`);
    });
}

module.exports = { server, WORKSPACE, MIME_TYPES, getMimeType };
