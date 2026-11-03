const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');

const WORKSPACE = path.join(os.tmpdir(), 'caesarion_workspace');

test('Server endpoints for file editor and zip download', async (t) => {
    // Start server as child process
    const serverProcess = cp.spawn('node', ['server.js'], { cwd: __dirname });

    // Ensure cleanup
    t.after(() => {
        serverProcess.kill();
    });

    // Wait for server to be ready
    await new Promise((resolve) => {
        serverProcess.stdout.on('data', (d) => {
            if (d.toString().includes('Caesarion server running')) {
                resolve();
            }
        });
        setTimeout(resolve, 1500);
    });

    // Ensure workspace exists with initial test files
    fs.mkdirSync(path.join(WORKSPACE, 'test_dir'), { recursive: true });
    fs.writeFileSync(path.join(WORKSPACE, 'sample.txt'), 'Sample content for editor test', 'utf8');
    fs.writeFileSync(path.join(WORKSPACE, 'test_dir', 'nested.js'), 'console.log("nested")', 'utf8');

    await t.test('GET /api/files returns HTML with file-item data-path attributes', async () => {
        const res = await fetch('http://localhost:3000/api/files');
        assert.strictEqual(res.status, 200);
        const html = await res.text();
        assert.ok(html.includes('class="file-item"'));
        assert.ok(html.includes('data-path="sample.txt"'));
        assert.ok(html.includes('data-path="test_dir/nested.js"') || html.includes('data-path="test_dir\\nested.js"'));
    });

    await t.test('GET /api/file?file=... returns file contents', async () => {
        const res = await fetch('http://localhost:3000/api/file?file=sample.txt');
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.file, 'sample.txt');
        assert.strictEqual(data.content, 'Sample content for editor test');
    });

    await t.test('GET /api/file rejects directory traversal', async () => {
        const res = await fetch('http://localhost:3000/api/file?file=../../etc/passwd');
        assert.strictEqual(res.status, 403);
    });

    await t.test('POST /api/file saves modified or new file content', async () => {
        const newContent = 'Updated content from code editor';
        const res = await fetch('http://localhost:3000/api/file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file: 'sample.txt', content: newContent })
        });
        assert.strictEqual(res.status, 200);
        const json = await res.json();
        assert.strictEqual(json.status, 'success');

        // Verify content on disk
        const onDisk = fs.readFileSync(path.join(WORKSPACE, 'sample.txt'), 'utf8');
        assert.strictEqual(onDisk, newContent);
    });

    await t.test('GET /api/download-zip returns valid zip buffer containing workspace files', async () => {
        const res = await fetch('http://localhost:3000/api/download-zip');
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.headers.get('content-type'), 'application/zip');
        const disposition = res.headers.get('content-disposition');
        assert.ok(disposition && disposition.includes('attachment; filename="workspace.zip"'));

        const zipBuffer = Buffer.from(await res.arrayBuffer());
        assert.ok(zipBuffer.length > 0);
        // ZIP magic number 0x04034b50 (PK\x03\x04)
        assert.strictEqual(zipBuffer.slice(0, 4).toString('hex'), '504b0304');
    });

    await t.test('public/app.js has valid JavaScript syntax', () => {
        assert.doesNotThrow(() => {
            cp.execSync('node -c public/app.js', { cwd: __dirname });
        });
    });
});
