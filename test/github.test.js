const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const github = require('../src/github');

const WORKSPACE = path.join(os.tmpdir(), 'caesarion_workspace');

test('GitHub Integration Module & Backend API Suite', async (t) => {
    let serverProcess;
    const testPort = 3890;

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

    await t.test('50MB Repo Size Check validates limits correctly', async () => {
        assert.strictEqual(github.MAX_REPO_SIZE_BYTES, 50 * 1024 * 1024);

        // Check calculation logic: size > 51200 KB is > 50MB
        const smallSizeKB = 25000;
        assert.strictEqual(smallSizeKB * 1024 <= github.MAX_REPO_SIZE_BYTES, true);

        const oversizedKB = 55000;
        assert.strictEqual(oversizedKB * 1024 > github.MAX_REPO_SIZE_BYTES, true);
    });

    await t.test('PR summary generator enforces 60-word limit fallback', async () => {
        // Test fallback summary
        const summary = await github.generatePRSummary(null, null, null, 'Repository: test/test');
        assert.ok(summary.title);
        assert.ok(summary.description);
        const wordCount = summary.description.split(/\s+/).length;
        assert.ok(wordCount <= 60, `Description has ${wordCount} words, should be <= 60`);
    });

    await t.test('POST /api/github/device-token handles missing or invalid device_code', async () => {
        const res = await fetch(`${baseUrl}/api/github/device-token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_code: 'invalid-test-code' })
        });
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        // GitHub API will return an error object (e.g. error: "bad_verification_code" or similar)
        assert.ok(data.error !== undefined);
    });

    await t.test('GET /api/github/user requires authorization header', async () => {
        const res = await fetch(`${baseUrl}/api/github/user`);
        assert.strictEqual(res.status, 401);
        const data = await res.json();
        assert.strictEqual(data.error, 'Missing GitHub token');
    });

    await t.test('GET /api/github/repos requires authorization header', async () => {
        const res = await fetch(`${baseUrl}/api/github/repos`);
        assert.strictEqual(res.status, 401);
    });

    await t.test('GET /api/github/branches requires owner and repo', async () => {
        const res = await fetch(`${baseUrl}/api/github/branches?owner=test`);
        assert.strictEqual(res.status, 400);
        const data = await res.json();
        assert.strictEqual(data.error, 'Missing owner or repo parameter');
    });

    await t.test('GET /api/github/repo-size requires owner and repo', async () => {
        const res = await fetch(`${baseUrl}/api/github/repo-size?owner=test`);
        assert.strictEqual(res.status, 400);
        const data = await res.json();
        assert.strictEqual(data.error, 'Missing owner or repo parameter');
    });

    await t.test('POST /api/github/load-repo requires all parameters', async () => {
        const res = await fetch(`${baseUrl}/api/github/load-repo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ owner: 'test' })
        });
        assert.strictEqual(res.status, 400);
        const data = await res.json();
        assert.ok(data.error.includes('Missing owner'));
    });

    await t.test('POST /api/github/sync requires owner, repo and token', async () => {
        const res = await fetch(`${baseUrl}/api/github/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ owner: 'test' })
        });
        assert.strictEqual(res.status, 400);
        const data = await res.json();
        assert.ok(data.error.includes('Missing owner'));
    });

    await t.test('POST /api/github/create-pr requires baseBranch and token', async () => {
        const res = await fetch(`${baseUrl}/api/github/create-pr`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ owner: 'test', repo: 'my-repo' })
        });
        assert.strictEqual(res.status, 400);
        const data = await res.json();
        assert.ok(data.error.includes('Missing owner'));
    });

    await t.test('GET /api/files returns empty state prompt when workspace has no files', async () => {
        // Clear workspace
        if (fs.existsSync(WORKSPACE)) {
            fs.rmSync(WORKSPACE, { recursive: true, force: true });
            fs.mkdirSync(WORKSPACE, { recursive: true });
        }

        const res = await fetch(`${baseUrl}/api/files`);
        assert.strictEqual(res.status, 200);
        const text = await res.text();
        assert.ok(text.includes('(empty directory)') || text.includes('Workspace is empty.'));

        // Recreate sample.txt and directory for subsequent tests in suite
        fs.mkdirSync(path.join(WORKSPACE, 'test_dir'), { recursive: true });
        fs.writeFileSync(path.join(WORKSPACE, 'sample.txt'), 'Sample content for editor test', 'utf8');
        fs.writeFileSync(path.join(WORKSPACE, 'test_dir', 'nested.js'), 'console.log("nested")', 'utf8');
    });
});
