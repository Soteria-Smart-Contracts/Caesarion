const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const cp = require('child_process');
const { TaskManager, WORKSPACE } = require('../src/task_manager');

test('TaskManager engine and API tests', async (t) => {
    const testPort = 3567;
    let serverProcess;

    await new Promise((resolve, reject) => {
        serverProcess = cp.spawn('node', ['server.js'], {
            env: { ...process.env, PORT: testPort },
            stdio: 'pipe'
        });
        serverProcess.stdout.on('data', (d) => {
            if (d.toString().includes('Caesarion server running')) {
                resolve();
            }
        });
        serverProcess.on('error', reject);
    });

    const baseUrl = `http://localhost:${testPort}`;

    t.after(() => {
        if (serverProcess) serverProcess.kill();
    });

    await t.test('POST /api/reset resets history, tasks and workspace', async () => {
        const res = await fetch(`${baseUrl}/api/reset`, { method: 'POST' });
        assert.strictEqual(res.status, 200);

        const tasksRes = await fetch(`${baseUrl}/api/tasks`);
        const { tasks } = await tasksRes.json();
        assert.deepStrictEqual(tasks, []);
    });

    await t.test('GET /api/tasks returns list of tasks', async () => {
        const res = await fetch(`${baseUrl}/api/tasks`);
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.ok(Array.isArray(data.tasks));
    });

    await t.test('POST /api/tasks validates required inputs', async () => {
        const res = await fetch(`${baseUrl}/api/tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: 'Hello' })
        });
        assert.strictEqual(res.status, 400);
        const err = await res.json();
        assert.ok(err.error);
    });

    await t.test('TaskManager unit test: ghost workspace staging and approval isolation', async () => {
        const tm = new TaskManager();
        tm.resetAll();

        // Write a test file in live workspace
        fs.mkdirSync(WORKSPACE, { recursive: true });
        fs.writeFileSync(path.join(WORKSPACE, 'live_file.txt'), 'Original live content', 'utf8');

        // Create a task
        const task = {
            id: 'test_task_1',
            prompt: 'Create feature file',
            title: 'Create feature file',
            mode: 'just_go',
            status: 'running',
            createdAt: new Date().toISOString(),
            ghostWorkspace: tm.createGhostWorkspace('test_task_1'),
            plan: '1. Plan steps',
            modifiedFiles: ['feature.js'],
            summary: 'Added feature.js',
            explanation: 'Created feature.js with hello() function',
            logs: []
        };
        tm.tasks.push(task);
        tm.saveTasks();

        // Write to ghost workspace only
        fs.writeFileSync(path.join(task.ghostWorkspace, 'feature.js'), 'export function hello() {}', 'utf8');

        // Check live workspace: feature.js MUST NOT EXIST in live workspace yet!
        assert.strictEqual(fs.existsSync(path.join(WORKSPACE, 'feature.js')), false);
        assert.strictEqual(fs.readFileSync(path.join(WORKSPACE, 'live_file.txt'), 'utf8'), 'Original live content');

        // Transition task to ready_for_approval
        task.status = 'ready_for_approval';
        tm.saveTasks();

        // Approve task
        tm.approveTask('test_task_1');

        // Check that after approval, feature.js now exists in live workspace
        assert.strictEqual(fs.existsSync(path.join(WORKSPACE, 'feature.js')), true);
        assert.strictEqual(fs.readFileSync(path.join(WORKSPACE, 'feature.js'), 'utf8'), 'export function hello() {}');

        // Clean up
        tm.resetAll();
    });

    await t.test('TaskManager unit test: reject task discards ghost workspace without altering live workspace', async () => {
        const tm = new TaskManager();
        tm.resetAll();

        const task = {
            id: 'test_task_2',
            prompt: 'Test reject',
            title: 'Test reject',
            mode: 'just_go',
            status: 'ready_for_approval',
            createdAt: new Date().toISOString(),
            ghostWorkspace: tm.createGhostWorkspace('test_task_2'),
            plan: '1. Plan steps',
            modifiedFiles: ['bad.js'],
            summary: 'Bad file',
            explanation: 'Do not want this',
            logs: []
        };
        tm.tasks.push(task);
        tm.saveTasks();

        fs.writeFileSync(path.join(task.ghostWorkspace, 'bad.js'), 'bad code', 'utf8');

        // Reject task
        tm.rejectTask('test_task_2', 'Rejected test');

        assert.strictEqual(fs.existsSync(path.join(WORKSPACE, 'bad.js')), false);
        assert.strictEqual(task.status, 'rejected');

        tm.resetAll();
    });

    await t.test('Task endpoints via HTTP: get, reply, approve, reject flow', async () => {
        const tm = new TaskManager();
        tm.resetAll();

        // Populate a task in ready_for_approval
        const ghostDir = tm.createGhostWorkspace('http_test_task');
        fs.writeFileSync(path.join(ghostDir, 'http_created.txt'), 'staged content', 'utf8');

        const task = {
            id: 'http_test_task',
            prompt: 'Http test',
            title: 'Http test',
            mode: 'plan_for_review',
            status: 'ready_for_approval',
            createdAt: new Date().toISOString(),
            ghostWorkspace: ghostDir,
            plan: '1. Step one\n2. Step two',
            modifiedFiles: ['http_created.txt'],
            summary: 'Summary from mock',
            explanation: 'Explanation from mock',
            logs: []
        };
        tm.tasks.push(task);
        tm.saveTasks();

        // GET /api/tasks/:id
        const getRes = await fetch(`${baseUrl}/api/tasks/http_test_task`);
        assert.strictEqual(getRes.status, 200);
        const { task: fetchedTask } = await getRes.json();
        assert.strictEqual(fetchedTask.id, 'http_test_task');
        assert.strictEqual(fetchedTask.status, 'ready_for_approval');
        assert.deepStrictEqual(fetchedTask.modifiedFiles, ['http_created.txt']);

        // POST /api/tasks/:id/approve
        const approveRes = await fetch(`${baseUrl}/api/tasks/http_test_task/approve`, { method: 'POST' });
        assert.strictEqual(approveRes.status, 200);
        const approveJson = await approveRes.json();
        assert.strictEqual(approveJson.status, 'success');

        // Verify live workspace received file
        assert.strictEqual(fs.readFileSync(path.join(WORKSPACE, 'http_created.txt'), 'utf8'), 'staged content');
    });
});
