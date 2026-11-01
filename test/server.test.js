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

    await t.test('GET /preview redirects to /preview/ preserving query string', async () => {
        // Without redirect following
        const res = await fetch(`${baseUrl}/preview?v=123`, { redirect: 'manual' });
        assert.strictEqual(res.status, 302);
        assert.strictEqual(res.headers.get('location'), '/preview/?v=123');
    });

    await t.test('GET /preview/ serves index.html with base tag and subfiles from workspace', async () => {
        const workspace = path.join(os.tmpdir(), 'caesarion_workspace');
        fs.mkdirSync(path.join(workspace, 'assets'), { recursive: true });
        fs.writeFileSync(path.join(workspace, 'index.html'), '<!DOCTYPE html><html><head><title>App</title></head><body><h1>Hello from Virtual VM!</h1></body></html>');
        fs.writeFileSync(path.join(workspace, 'style.css'), 'body { background: blue; }');
        fs.writeFileSync(path.join(workspace, 'assets', 'app.js'), 'console.log("preview script");');
        fs.writeFileSync(path.join(workspace, 'font.woff2'), 'fake-woff2-data');

        // Test preview with slash
        const resSlash = await fetch(`${baseUrl}/preview/`);
        assert.strictEqual(resSlash.status, 200);
        assert.strictEqual(resSlash.headers.get('content-type'), 'text/html');
        const textSlash = await resSlash.text();
        assert.ok(textSlash.includes('<base href="/preview/">'));
        assert.ok(textSlash.includes('<h1>Hello from Virtual VM!</h1>'));

        // Test following redirect from /preview
        const resFollow = await fetch(`${baseUrl}/preview`);
        assert.strictEqual(resFollow.status, 200);
        const textFollow = await resFollow.text();
        assert.ok(textFollow.includes('<base href="/preview/">'));

        // Test preview subresource at relative path
        const resCss = await fetch(`${baseUrl}/preview/style.css`);
        assert.strictEqual(resCss.status, 200);
        assert.strictEqual(resCss.headers.get('content-type'), 'text/css');
        const textCss = await resCss.text();
        assert.strictEqual(textCss, 'body { background: blue; }');

        // Test nested subresource
        const resJs = await fetch(`${baseUrl}/preview/assets/app.js`);
        assert.strictEqual(resJs.status, 200);
        assert.strictEqual(resJs.headers.get('content-type'), 'text/javascript');
        const textJs = await resJs.text();
        assert.strictEqual(textJs, 'console.log("preview script");');

        // Test woff2 font MIME type
        const resWoff2 = await fetch(`${baseUrl}/preview/font.woff2`);
        assert.strictEqual(resWoff2.status, 200);
        assert.strictEqual(resWoff2.headers.get('content-type'), 'font/woff2');

        // Test root fallback: workspace files requested as root-relative URLs load successfully
        const resFallback = await fetch(`${baseUrl}/style.css`);
        assert.strictEqual(resFallback.status, 200);
        assert.strictEqual(resFallback.headers.get('content-type'), 'text/css');
        const textFallback = await resFallback.text();
        assert.strictEqual(textFallback, 'body { background: blue; }');

        // Test root fallback nested file
        const resFallbackNested = await fetch(`${baseUrl}/assets/app.js`);
        assert.strictEqual(resFallbackNested.status, 200);
        assert.strictEqual(resFallbackNested.headers.get('content-type'), 'text/javascript');
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
