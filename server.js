const http = require('http');
const fs = require('fs');
const path = require('path');
const { Agent } = require('./src/agent');
const { get_workspace_tree } = require('./src/tools/file_system');
const os = require('os');
const zlib = require('zlib');
const { execSync } = require('child_process');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const WORKSPACE = path.join(os.tmpdir(), 'caesarion_workspace');

let activeAgent = null; // Cache session
let chatHistory = []; // In-memory session chat history

function getAllFilesRecursively(dir, baseDir = dir) {
    if (!fs.existsSync(dir)) return [];
    let files = [];
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            files = files.concat(getAllFilesRecursively(fullPath, baseDir));
        } else {
            const relPath = path.relative(baseDir, fullPath);
            files.push({ fullPath, relPath });
        }
    }
    return files;
}

function createZipArchive(fileList) {
    const localHeaders = [];
    const centralHeaders = [];
    let offset = 0;

    for (const item of fileList) {
        const data = fs.readFileSync(item.fullPath);
        const normalizedRelPath = item.relPath.replace(/\\/g, '/');
        const nameBuf = Buffer.from(normalizedRelPath, 'utf8');
        const crc = zlib.crc32(data);
        const size = data.length;

        // Local header (30 + name.length)
        const localHdr = Buffer.alloc(30 + nameBuf.length);
        localHdr.writeUInt32LE(0x04034b50, 0);
        localHdr.writeUInt16LE(20, 4);          // version needed
        localHdr.writeUInt16LE(0, 6);           // flags
        localHdr.writeUInt16LE(0, 8);           // compression: 0 (stored)
        localHdr.writeUInt16LE(0, 10);          // mod time
        localHdr.writeUInt16LE(0, 12);          // mod date
        localHdr.writeUInt32LE(crc, 14);        // CRC-32
        localHdr.writeUInt32LE(size, 18);       // compressed size
        localHdr.writeUInt32LE(size, 22);       // uncompressed size
        localHdr.writeUInt16LE(nameBuf.length, 26);
        localHdr.writeUInt16LE(0, 28);
        nameBuf.copy(localHdr, 30);

        localHeaders.push(localHdr, data);

        // Central directory header (46 + name.length)
        const cdHdr = Buffer.alloc(46 + nameBuf.length);
        cdHdr.writeUInt32LE(0x02014b50, 0);
        cdHdr.writeUInt16LE(20, 4);             // version made by
        cdHdr.writeUInt16LE(20, 6);             // version needed
        cdHdr.writeUInt16LE(0, 8);              // flags
        cdHdr.writeUInt16LE(0, 10);             // compression
        cdHdr.writeUInt16LE(0, 12);             // mod time
        cdHdr.writeUInt16LE(0, 14);             // mod date
        cdHdr.writeUInt32LE(crc, 16);           // CRC-32
        cdHdr.writeUInt32LE(size, 20);          // compressed size
        cdHdr.writeUInt32LE(size, 24);          // uncompressed size
        cdHdr.writeUInt16LE(nameBuf.length, 28);
        cdHdr.writeUInt16LE(0, 30);
        cdHdr.writeUInt16LE(0, 32);
        cdHdr.writeUInt16LE(0, 34);
        cdHdr.writeUInt16LE(0, 36);
        cdHdr.writeUInt32LE(0, 38);
        cdHdr.writeUInt32LE(offset, 42);        // local header offset
        nameBuf.copy(cdHdr, 46);

        centralHeaders.push(cdHdr);
        offset += localHdr.length + data.length;
    }

    const cdOffset = offset;
    const cdSize = centralHeaders.reduce((acc, h) => acc + h.length, 0);

    // End of central directory record (22 bytes)
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(fileList.length, 8);
    eocd.writeUInt16LE(fileList.length, 10);
    eocd.writeUInt32LE(cdSize, 12);
    eocd.writeUInt32LE(cdOffset, 16);
    eocd.writeUInt16LE(0, 20);

    return Buffer.concat([...localHeaders, ...centralHeaders, eocd]);
}

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

    // Get individual file content for the code editor
    if (req.method === 'GET' && req.url.startsWith('/api/file?')) {
        const urlParams = new URLSearchParams(req.url.split('?')[1]);
        const fileParam = urlParams.get('file');

        if (!fileParam) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing file parameter' }));
            return;
        }

        const requestedFile = path.normalize(path.join(WORKSPACE, fileParam));
        if (!requestedFile.startsWith(WORKSPACE)) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: '403 Forbidden' }));
            return;
        }

        try {
            const content = fs.readFileSync(requestedFile, 'utf8');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ file: fileParam, content }));
        } catch (err) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'File not found or unreadable' }));
        }
        return;
    }

    // Save individual file content from the code editor
    if (req.method === 'POST' && req.url === '/api/file') {
        let bodyStr = '';
        req.on('data', chunk => bodyStr += chunk.toString());
        req.on('end', () => {
            try {
                const { file, content } = JSON.parse(bodyStr);
                if (!file || typeof content !== 'string') {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing file or content' }));
                    return;
                }

                const requestedFile = path.normalize(path.join(WORKSPACE, file));
                if (!requestedFile.startsWith(WORKSPACE)) {
                    res.writeHead(403, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: '403 Forbidden' }));
                    return;
                }

                fs.mkdirSync(path.dirname(requestedFile), { recursive: true });
                fs.writeFileSync(requestedFile, content, 'utf8');

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'success', file }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    // Download zip archive of all workspace files
    if (req.method === 'GET' && (req.url === '/api/download-zip' || req.url.startsWith('/api/download-zip?'))) {
        try {
            if (!fs.existsSync(WORKSPACE)) {
                fs.mkdirSync(WORKSPACE, { recursive: true });
            }
            const allFiles = getAllFilesRecursively(WORKSPACE);
            const zipBuffer = createZipArchive(allFiles);

            res.writeHead(200, {
                'Content-Type': 'application/zip',
                'Content-Disposition': 'attachment; filename="workspace.zip"',
                'Content-Length': zipBuffer.length
            });
            res.end(zipBuffer);
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to generate zip: ' + err.message }));
        }
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

        // Safely resolve the path inside the workspace
        const requestedFile = path.normalize(path.join(WORKSPACE, fileParam));

        // Prevent path traversal escape
        if (!requestedFile.startsWith(WORKSPACE)) {
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

                if (!activeAgent) {
                    activeAgent = new Agent(apiUrl, apiKey, model);
                } else {
                    // Update credentials if they changed
                    activeAgent.apiUrl = apiUrl.replace(/\/+$/, '');
                    activeAgent.apiKey = apiKey;
                    activeAgent.model = model;
                }

                chatHistory.push({ role: 'user', content: task });

                let currentTurnAgentLogs = [];
                for await (const logMessage of activeAgent.run(task)) {
                    const trimmed = logMessage.trim();
                    currentTurnAgentLogs.push(trimmed);
                    sendLog(trimmed);
                }

                if (currentTurnAgentLogs.length > 0) {
                    chatHistory.push({ role: 'agent', content: currentTurnAgentLogs.join('\n') + '\n' });
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

server.listen(PORT, () => {
    console.log(`Caesarion server running at http://localhost:${PORT}`);
});
