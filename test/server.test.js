const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

test('Backend API and Preview Server test suite', async (t) => {
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

    await t.test('GET /api/history initially returns empty history', async () => {
        const res = await fetch(`${baseUrl}/api/history`);
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.deepStrictEqual(data, { history: [] });
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

    await t.test('GET /preview serves index.html and inlines workspace styles and scripts', async () => {
        const workspace = path.join(os.tmpdir(), 'caesarion_workspace');
        fs.mkdirSync(workspace, { recursive: true });
        fs.writeFileSync(path.join(workspace, 'index.html'), '<!DOCTYPE html><html><head><title>App</title><link rel="stylesheet" href="style.css"></head><body><h1>Hello from Virtual VM!</h1><script src="app.js"></script></body></html>');
        fs.writeFileSync(path.join(workspace, 'style.css'), 'body { background: blue; }');
        fs.writeFileSync(path.join(workspace, 'app.js'), 'console.log("workspace app loaded");');
        fs.writeFileSync(path.join(workspace, 'extra.css'), '.extra { color: red; }');
        fs.writeFileSync(path.join(workspace, 'main.js'), 'console.log("main script");');

        // Test root preview
        const resIndex = await fetch(`${baseUrl}/preview`);
        assert.strictEqual(resIndex.status, 200);
        assert.strictEqual(resIndex.headers.get('content-type'), 'text/html');
        const textIndex = await resIndex.text();
        assert.ok(textIndex.includes('<base href="/preview/">'));
        assert.ok(textIndex.includes('body { background: blue; }'));
        assert.ok(textIndex.includes('console.log("workspace app loaded");'));
        assert.ok(textIndex.includes('.extra { color: red; }'));
        assert.ok(textIndex.includes('console.log("main script");'));

        // Test preview with slash
        const resSlash = await fetch(`${baseUrl}/preview/`);
        assert.strictEqual(resSlash.status, 200);
        const textSlash = await resSlash.text();
        assert.ok(textSlash.includes('<base href="/preview/">'));
        assert.ok(textSlash.includes('body { background: blue; }'));

        // Test preview subresource direct path
        const resCss = await fetch(`${baseUrl}/preview/style.css`);
        assert.strictEqual(resCss.status, 200);
        assert.strictEqual(resCss.headers.get('content-type'), 'text/css');
        const textCss = await resCss.text();
        assert.strictEqual(textCss, 'body { background: blue; }');

        const resScript = await fetch(`${baseUrl}/preview/app.js`);
        assert.strictEqual(resScript.status, 200);
        assert.strictEqual(resScript.headers.get('content-type'), 'text/javascript');
        const textJs = await resScript.text();
        assert.strictEqual(textJs, 'console.log("workspace app loaded");');

        // Test preview root-relative resource fallback with preview referer header
        const resRootRelative = await fetch(`${baseUrl}/app.js`, {
            headers: { 'Referer': `${baseUrl}/preview/` }
        });
        assert.strictEqual(resRootRelative.status, 200);
        assert.strictEqual(resRootRelative.headers.get('content-type'), 'text/javascript');
        const textRootJs = await resRootRelative.text();
        assert.strictEqual(textRootJs, 'console.log("workspace app loaded");');

        // Test workspace-only file fallback without referer
        const resExtraCss = await fetch(`${baseUrl}/extra.css`);
        assert.strictEqual(resExtraCss.status, 200);
        assert.strictEqual(resExtraCss.headers.get('content-type'), 'text/css');
        const textExtraCss = await resExtraCss.text();
        assert.strictEqual(textExtraCss, '.extra { color: red; }');
    });

    await t.test('Path traversal in /preview is blocked', async () => {
        // Send a raw HTTP request with /preview/../package.json so fetch client doesn't resolve it before sending
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

    await t.test('POST /api/reset resets history and clears workspace', async () => {
        const resReset = await fetch(`${baseUrl}/api/reset`, { method: 'POST' });
        assert.strictEqual(resReset.status, 200);

        const resHistory = await fetch(`${baseUrl}/api/history`);
        const historyData = await resHistory.json();
        assert.deepStrictEqual(historyData, { history: [] });

        const resPreview = await fetch(`${baseUrl}/preview`);
        assert.strictEqual(resPreview.status, 404);
    });
});
