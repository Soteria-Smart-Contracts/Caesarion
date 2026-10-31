const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { server, WORKSPACE } = require('./server');

let testPort;
let baseUrl;
let httpServer;

function makeRequest(method, reqPath, body = null, headers = {}) {
    return new Promise((resolve, reject) => {
        const reqHeaders = { ...headers };
        let bodyData = null;
        if (body) {
            bodyData = typeof body === 'string' ? body : JSON.stringify(body);
            if (!reqHeaders['Content-Type']) {
                reqHeaders['Content-Type'] = 'application/json';
            }
            reqHeaders['Content-Length'] = Buffer.byteLength(bodyData);
        }

        const options = {
            hostname: 'localhost',
            port: testPort,
            path: reqPath,
            method,
            headers: reqHeaders
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body: data
                });
            });
        });

        req.on('error', reject);
        if (bodyData) {
            req.write(bodyData);
        }
        req.end();
    });
}

describe('Caesarion Server & Features Tests', () => {
    before(() => {
        return new Promise((resolve) => {
            httpServer = server.listen(0, () => {
                testPort = httpServer.address().port;
                baseUrl = `http://localhost:${testPort}`;
                resolve();
            });
        });
    });

    after(() => {
        return new Promise((resolve) => {
            httpServer.close(resolve);
        });
    });

    beforeEach(async () => {
        // Reset session and workspace before each test
        await makeRequest('POST', '/api/reset');
    });

    test('GET /api/history returns empty history initially', async () => {
        const res = await makeRequest('GET', '/api/history');
        assert.strictEqual(res.statusCode, 200);
        const json = JSON.parse(res.body);
        assert.deepStrictEqual(json, { history: [] });
    });

    test('GET /preview returns friendly fallback when index.html is missing', async () => {
        const res = await makeRequest('GET', '/preview');
        assert.strictEqual(res.statusCode, 404);
        assert.ok(res.headers['content-type'].includes('text/html'));
        assert.ok(res.body.includes('No <code>index.html</code> found in the workspace yet.'));
    });

    test('GET /preview serves index.html when present in workspace', async () => {
        const htmlContent = '<h1>Welcome to my Caesarion App</h1>';
        fs.writeFileSync(path.join(WORKSPACE, 'index.html'), htmlContent, 'utf-8');

        // Test /preview
        const res1 = await makeRequest('GET', '/preview');
        assert.strictEqual(res1.statusCode, 200);
        assert.ok(res1.headers['content-type'].includes('text/html'));
        assert.strictEqual(res1.body, htmlContent);

        // Test /preview/
        const res2 = await makeRequest('GET', '/preview/');
        assert.strictEqual(res2.statusCode, 200);
        assert.strictEqual(res2.body, htmlContent);

        // Test /preview/index.html
        const res3 = await makeRequest('GET', '/preview/index.html');
        assert.strictEqual(res3.statusCode, 200);
        assert.strictEqual(res3.body, htmlContent);
    });

    test('GET /preview serves linked workspace assets with appropriate mime types', async () => {
        const jsContent = 'console.log("hello world");';
        const cssContent = 'body { background: #000; }';
        fs.writeFileSync(path.join(WORKSPACE, 'main.js'), jsContent, 'utf-8');
        fs.writeFileSync(path.join(WORKSPACE, 'style.css'), cssContent, 'utf-8');

        const jsRes = await makeRequest('GET', '/preview/main.js');
        assert.strictEqual(jsRes.statusCode, 200);
        assert.ok(jsRes.headers['content-type'].includes('text/javascript'));
        assert.strictEqual(jsRes.body, jsContent);

        const cssRes = await makeRequest('GET', '/preview/style.css');
        assert.strictEqual(cssRes.statusCode, 200);
        assert.ok(cssRes.headers['content-type'].includes('text/css'));
        assert.strictEqual(cssRes.body, cssContent);
    });

    test('GET /preview prevents path traversal', async () => {
        const res = await makeRequest('GET', '/preview/..%2f..%2fserver.js');
        assert.strictEqual(res.statusCode, 403);
        const res2 = await makeRequest('GET', '/preview/dir/../../server.js');
        assert.strictEqual(res2.statusCode, 403);
    });

    test('Chat history persists across requests and clears on /api/reset', async () => {
        // Mock a run or test run
        // We can test POST /api/run with invalid credentials or mock to verify user message recorded
        const runRes = await makeRequest('POST', '/api/run', {
            apiUrl: 'http://127.0.0.1:9999/v1',
            apiKey: 'fake-key',
            model: 'test-model',
            task: 'Create a website'
        });

        // The request produces SSE stream with error or iteration logs
        assert.strictEqual(runRes.statusCode, 200);

        // Check /api/history
        const historyRes = await makeRequest('GET', '/api/history');
        assert.strictEqual(historyRes.statusCode, 200);
        const historyData = JSON.parse(historyRes.body);

        assert.ok(historyData.history.length >= 1);
        assert.strictEqual(historyData.history[0].role, 'user');
        assert.strictEqual(historyData.history[0].content, 'Create a website');

        // Check reset
        const resetRes = await makeRequest('POST', '/api/reset');
        assert.strictEqual(resetRes.statusCode, 200);

        const afterResetHistory = await makeRequest('GET', '/api/history');
        const emptyHistoryData = JSON.parse(afterResetHistory.body);
        assert.deepStrictEqual(emptyHistoryData, { history: [] });
    });
});
