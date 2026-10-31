const http = require('http');
const fs = require('fs');
const path = require('path');
const { Agent } = require('./src/agent');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const server = http.createServer(async (req, res) => {
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

                const agent = new Agent(apiUrl, apiKey, model);

                for await (const logMessage of agent.run(task)) {
                    sendLog(logMessage.trim());
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
