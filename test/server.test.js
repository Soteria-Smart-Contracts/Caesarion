const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

test('Backend API, Session Persistence and Preview Server test suite', async (t) => {
    let serverProcess;
    const testPort = 3456;

    // Start server in background
    await new Promise((resolve, reject) => {
        serverProcess = spawn('node', ['server.js'], {
            env: { ...process.env, PORT: testPort },
            stdio: 'pipe'
        });

        serverProcess.stdout.on('data', (data) => {
            if (data.toString().includes('Caesarion server running')) {
                resolve();
            }
        });

        serverProcess.on('error', reject);
    });

    const baseUrl = `http://localhost:${testPort}`;

    t.after(() => {
        if (serverProcess) {
            serverProcess.kill();
        }
    });

    await t.test('POST /api/reset resets history and clears workspace and session file', async () => {
        const resReset = await fetch(`${baseUrl}/api/reset`, { method: 'POST' });
        assert.strictEqual(resReset.status, 200);

        const resHistory = await fetch(`${baseUrl}/api/history`);
        const historyData = await resHistory.json();
        assert.deepStrictEqual(historyData, { history: [] });

        const sessionFile = path.join(os.tmpdir(), 'caesarion_session.json');
        assert.strictEqual(fs.existsSync(sessionFile), false);
    });

    await t.test('Session file persists history across server reads', async () => {
        const sessionFile = path.join(os.tmpdir(), 'caesarion_session.json');
        fs.writeFileSync(sessionFile, JSON.stringify({
            chatHistory: [
                { role: 'user', content: 'hello' },
                { role: 'agent', content: 'world' }
            ],
            agentMessages: []
        }));

        const resHistory = await fetch(`${baseUrl}/api/history`);
        const historyData = await resHistory.json();
        assert.deepStrictEqual(historyData.history, [
            { role: 'user', content: 'hello' },
            { role: 'agent', content: 'world' }
        ]);
    });

    await t.test('GET /preview returns 404 fallback when no index.html exists', async () => {
        const workspace = path.join(os.tmpdir(), 'caesarion_workspace');
        const indexPath = path.join(workspace, 'index.html');
        if (fs.existsSync(indexPath)) fs.unlinkSync(indexPath);

        const res = await fetch(`${baseUrl}/preview`);
        assert.strictEqual(res.status, 404);
        const text = await res.text();
        assert.ok(text.includes('No Preview Available'));
    });

    await t.test('GET /preview serves index.html and subfiles from workspace', async () => {
        const workspace = path.join(os.tmpdir(), 'caesarion_workspace');
        fs.mkdirSync(workspace, { recursive: true });
        fs.writeFileSync(path.join(workspace, 'index.html'), '<h1>Hello from Virtual VM!</h1>');
        fs.writeFileSync(path.join(workspace, 'style.css'), 'body { background: blue; }');

        // Test root preview
        const resIndex = await fetch(`${baseUrl}/preview`);
        assert.strictEqual(resIndex.status, 200);
        assert.strictEqual(resIndex.headers.get('content-type'), 'text/html');
        const textIndex = await resIndex.text();
        assert.strictEqual(textIndex, '<h1>Hello from Virtual VM!</h1>');

        // Test preview with slash
        const resSlash = await fetch(`${baseUrl}/preview/`);
        assert.strictEqual(resSlash.status, 200);
        const textSlash = await resSlash.text();
        assert.strictEqual(textSlash, '<h1>Hello from Virtual VM!</h1>');

        // Test preview subresource
        const resCss = await fetch(`${baseUrl}/preview/style.css`);
        assert.strictEqual(resCss.status, 200);
        assert.strictEqual(resCss.headers.get('content-type'), 'text/css');
        const textCss = await resCss.text();
        assert.strictEqual(textCss, 'body { background: blue; }');
    });

    await t.test('Path traversal in /preview is blocked', async () => {
        const status = await new Promise((resolve, reject) => {
            const req = http.request({
                hostname: 'localhost',
                port: testPort,
                path: '/preview/../package.json',
                method: 'GET'
            }, (res) => {
                resolve(res.statusCode);
            });
            req.on('error', reject);
            req.end();
        });
        assert.strictEqual(status, 403);
    });

    await t.test('POST /api/reset resets history cleanly again', async () => {
        const resReset = await fetch(`${baseUrl}/api/reset`, { method: 'POST' });
        assert.strictEqual(resReset.status, 200);

        const resHistory = await fetch(`${baseUrl}/api/history`);
        const historyData = await resHistory.json();
        assert.deepStrictEqual(historyData, { history: [] });

        const resPreview = await fetch(`${baseUrl}/preview`);
        assert.strictEqual(resPreview.status, 404);
    });
});
