const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');
const { Agent } = require('./agent');

const TASKS_FILE = path.join(os.tmpdir(), 'caesarion_tasks.json');
const WORKSPACE = path.join(os.tmpdir(), 'caesarion_workspace');
const GHOST_BASE_DIR = path.join(os.tmpdir(), 'caesarion_ghost_workspaces');

// Ensure base directories exist
if (!fs.existsSync(WORKSPACE)) {
    fs.mkdirSync(WORKSPACE, { recursive: true });
}
if (!fs.existsSync(GHOST_BASE_DIR)) {
    fs.mkdirSync(GHOST_BASE_DIR, { recursive: true });
}

function copyRecursiveSync(src, dest) {
    if (!fs.existsSync(src)) return;
    const stats = fs.statSync(src);
    if (stats.isDirectory()) {
        fs.mkdirSync(dest, { recursive: true });
        for (const childItem of fs.readdirSync(src)) {
            copyRecursiveSync(path.join(src, childItem), path.join(dest, childItem));
        }
    } else {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
    }
}

class TaskManager extends EventEmitter {
    constructor() {
        super();
        this.tasks = [];
        this.activeAgents = new Map(); // taskId -> { agent, loopPromise, resumeResolve }
        this.loadTasks();
    }

    loadTasks() {
        try {
            if (fs.existsSync(TASKS_FILE)) {
                const data = fs.readFileSync(TASKS_FILE, 'utf8');
                this.tasks = JSON.parse(data);
            } else {
                this.tasks = [];
            }
        } catch (e) {
            console.error("Failed to load tasks from disk:", e);
            this.tasks = [];
        }
    }

    saveTasks() {
        try {
            fs.writeFileSync(TASKS_FILE, JSON.stringify(this.tasks, null, 2), 'utf8');
        } catch (e) {
            console.error("Failed to save tasks to disk:", e);
        }
    }

    getAllTasks() {
        return this.tasks.map(t => ({
            id: t.id,
            title: t.title,
            mode: t.mode,
            status: t.status,
            createdAt: t.createdAt,
            updatedAt: t.updatedAt,
            plan: t.plan || '',
            modifiedFiles: t.modifiedFiles || [],
            summary: t.summary || '',
            explanation: t.explanation || ''
        }));
    }

    getTask(id) {
        return this.tasks.find(t => t.id === id);
    }

    createGhostWorkspace(taskId) {
        const ghostDir = path.join(GHOST_BASE_DIR, taskId);
        if (fs.existsSync(ghostDir)) {
            fs.rmSync(ghostDir, { recursive: true, force: true });
        }
        fs.mkdirSync(ghostDir, { recursive: true });
        // Clone current live workspace into ghost workspace
        copyRecursiveSync(WORKSPACE, ghostDir);
        return ghostDir;
    }

    appendTaskLog(task, event) {
        if (!task.logs) task.logs = [];
        task.logs.push({
            timestamp: new Date().toISOString(),
            ...event
        });
        task.updatedAt = new Date().toISOString();
        this.saveTasks();
        this.emit(`log:${task.id}`, event);
    }

    async createTask({ prompt, mode = 'just_go', apiUrl, apiKey, model }) {
        const id = 'task_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
        const title = prompt.length > 50 ? prompt.substring(0, 47) + '...' : prompt;
        const ghostWorkspace = this.createGhostWorkspace(id);

        const task = {
            id,
            prompt,
            title,
            mode, // 'just_go' | 'plan_for_review' | 'interactive'
            status: 'planning', // 'planning' | 'waiting_review' | 'running' | 'ready_for_approval' | 'approved' | 'rejected' | 'failed'
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            ghostWorkspace,
            plan: '',
            modifiedFiles: [],
            summary: '',
            explanation: '',
            logs: []
        };

        this.tasks.unshift(task);
        this.saveTasks();

        // Start autonomous agent execution asynchronously
        this.startAgentLoop(task, { apiUrl, apiKey, model });

        return task;
    }

    async startAgentLoop(task, credentials) {
        const agent = new Agent(
            credentials.apiUrl,
            credentials.apiKey,
            credentials.model,
            task.ghostWorkspace
        );

        let resumeResolve = null;

        this.activeAgents.set(task.id, {
            agent,
            waitForUser: () => new Promise(res => { resumeResolve = res; }),
            resolveUser: (data) => {
                if (resumeResolve) {
                    const fn = resumeResolve;
                    resumeResolve = null;
                    fn(data);
                }
            }
        });

        try {
            // Execution loop with Deep Planning & Iteration
            const runIter = agent.runTask({
                taskPrompt: task.prompt,
                mode: task.mode,
                taskCallback: async (action, payload) => {
                    if (action === 'set_plan') {
                        task.plan = payload.plan;
                        this.saveTasks();
                    } else if (action === 'require_review') {
                        task.status = 'waiting_review';
                        task.plan = payload.plan;
                        this.appendTaskLog(task, {
                            type: 'review_required',
                            message: payload.message || 'Plan formulated. Please review and approve to proceed with execution.',
                            plan: payload.plan
                        });
                        this.saveTasks();

                        const active = this.activeAgents.get(task.id);
                        if (active) {
                            const userResponse = await active.waitForUser();
                            return userResponse;
                        }
                    } else if (action === 'ask_question') {
                        task.status = 'waiting_review';
                        this.appendTaskLog(task, {
                            type: 'question_asked',
                            message: payload.question
                        });
                        this.saveTasks();

                        const active = this.activeAgents.get(task.id);
                        if (active) {
                            const userResponse = await active.waitForUser();
                            return userResponse;
                        }
                    }
                }
            });

            for await (const event of runIter) {
                if (event.type === 'status_change') {
                    task.status = event.status;
                }
                if (event.type === 'plan_created') {
                    task.plan = event.plan;
                }
                if (event.type === 'files_modified') {
                    task.modifiedFiles = Array.from(new Set([...(task.modifiedFiles || []), ...event.files]));
                }
                this.appendTaskLog(task, event);
            }

            // Generate completion summary & explanation using LLM if modifiedFiles exist
            if (task.status !== 'failed' && task.status !== 'rejected') {
                task.status = 'ready_for_approval';
                this.appendTaskLog(task, {
                    type: 'summarizing',
                    message: 'Task execution completed in ghost workspace. Generating changes breakdown and summary...'
                });

                const summaryResult = await agent.generateSummary({
                    prompt: task.prompt,
                    plan: task.plan,
                    modifiedFiles: task.modifiedFiles || []
                });

                task.summary = summaryResult.summary || 'Task completed successfully in ghost workspace.';
                task.explanation = summaryResult.explanation || 'Review modified files and approve to apply to live workspace.';

                this.appendTaskLog(task, {
                    type: 'ready_for_approval',
                    message: 'Task is ready for your review and approval.',
                    summary: task.summary,
                    explanation: task.explanation,
                    modifiedFiles: task.modifiedFiles
                });
            }

            this.saveTasks();
        } catch (err) {
            console.error(`Task ${task.id} execution error:`, err);
            task.status = 'failed';
            this.appendTaskLog(task, {
                type: 'error',
                message: `Task execution failed: ${err.message}`
            });
            this.saveTasks();
        } finally {
            this.activeAgents.delete(task.id);
        }
    }

    replyToTask(taskId, { message, approvePlan }) {
        const task = this.getTask(taskId);
        if (!task) throw new Error('Task not found');

        const active = this.activeAgents.get(taskId);
        if (!active) {
            throw new Error('Task is not actively waiting for input');
        }

        task.status = 'running';
        this.appendTaskLog(task, {
            type: 'user_reply',
            message: message || (approvePlan ? 'Plan approved by user. Proceeding with execution.' : 'User input submitted.')
        });

        active.resolveUser({ message, approvePlan: Boolean(approvePlan) });
        this.saveTasks();
        return task;
    }

    approveTask(taskId) {
        const task = this.getTask(taskId);
        if (!task) throw new Error('Task not found');
        if (task.status !== 'ready_for_approval') {
            throw new Error(`Cannot approve task with status '${task.status}'`);
        }

        // Apply ghost workspace changes to live workspace
        if (fs.existsSync(task.ghostWorkspace)) {
            copyRecursiveSync(task.ghostWorkspace, WORKSPACE);
        }

        task.status = 'approved';
        task.updatedAt = new Date().toISOString();
        this.appendTaskLog(task, {
            type: 'approved',
            message: 'Changes approved! Successfully applied ghost workspace to live workspace.'
        });

        this.saveTasks();
        return task;
    }

    rejectTask(taskId, reason = 'Rejected by user') {
        const task = this.getTask(taskId);
        if (!task) throw new Error('Task not found');

        task.status = 'rejected';
        task.updatedAt = new Date().toISOString();
        this.appendTaskLog(task, {
            type: 'rejected',
            message: `Task rejected: ${reason}. Live workspace was not modified.`
        });

        // Clean up ghost workspace
        if (fs.existsSync(task.ghostWorkspace)) {
            fs.rmSync(task.ghostWorkspace, { recursive: true, force: true });
        }

        this.saveTasks();
        return task;
    }

    resetAll() {
        this.activeAgents.clear();
        this.tasks = [];
        try {
            if (fs.existsSync(TASKS_FILE)) fs.unlinkSync(TASKS_FILE);
            if (fs.existsSync(GHOST_BASE_DIR)) {
                fs.rmSync(GHOST_BASE_DIR, { recursive: true, force: true });
                fs.mkdirSync(GHOST_BASE_DIR, { recursive: true });
            }
        } catch (e) {
            console.error("Failed to reset tasks:", e);
        }
    }
}

const taskManager = new TaskManager();

module.exports = {
    TaskManager,
    taskManager,
    WORKSPACE,
    GHOST_BASE_DIR,
    TASKS_FILE,
    copyRecursiveSync
};
