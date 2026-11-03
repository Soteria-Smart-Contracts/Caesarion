// State variables
let currentSelectedFile = null;
let currentActiveView = 'tasks'; // 'tasks' or 'editor'
let currentSelectedTaskId = null;
let activeEventSource = null;
let selectedTaskMode = 'just_go';
let tasksList = [];

// DOM Elements - Navigation & Modes
const viewTasksBtn = document.getElementById('viewTasksBtn');
const viewEditorBtn = document.getElementById('viewEditorBtn');
const tasksViewSection = document.getElementById('tasksViewSection');
const editorViewSection = document.getElementById('editorViewSection');

// DOM Elements - Tasks Central
const taskListElem = document.getElementById('taskList');
const newTaskBtn = document.getElementById('newTaskBtn');
const taskCreatorPane = document.getElementById('taskCreatorPane');
const taskActivePane = document.getElementById('taskActivePane');
const taskCreatorPrompt = document.getElementById('taskCreatorPrompt');
const launchTaskBtn = document.getElementById('launchTaskBtn');
const modeSelector = document.getElementById('modeSelector');

// DOM Elements - Active Task Pane
const activeTaskStatusBadge = document.getElementById('activeTaskStatusBadge');
const activeTaskTitle = document.getElementById('activeTaskTitle');
const openApprovalModalBtn = document.getElementById('openApprovalModalBtn');
const approvalBanner = document.getElementById('approvalBanner');
const bannerApproveBtn = document.getElementById('bannerApproveBtn');
const taskFeed = document.getElementById('taskFeed');
const taskReplyInput = document.getElementById('taskReplyInput');
const taskReplyBtn = document.getElementById('taskReplyBtn');

// DOM Elements - Approval Modal
const approvalModal = document.getElementById('approvalModal');
const closeApprovalModal = document.getElementById('closeApprovalModal');
const closeApprovalBtn = document.getElementById('closeApprovalBtn');
const approvalSummaryText = document.getElementById('approvalSummaryText');
const approvalFilesList = document.getElementById('approvalFilesList');
const approvalExplanationText = document.getElementById('approvalExplanationText');
const approveAndApplyBtn = document.getElementById('approveAndApplyBtn');
const rejectTaskBtn = document.getElementById('rejectTaskBtn');

// DOM Elements - Code Editor & Chat View
let currentViewMode = 'chat'; // 'chat' or 'split'

// GitHub Session State
let githubState = {
    token: null,
    user: null,
    activeRepo: null,       // { owner, repo, name, defaultBranch, size }
    baseBranch: null,
    caesarionBranch: 'caesarion-branch',
    devicePollTimer: null,
    autoSyncTimer: null
};

// DOM Elements
const appContainer = document.getElementById('appContainer');
const viewChatOnlyBtn = document.getElementById('viewChatOnlyBtn');
const viewEditorSplitBtn = document.getElementById('viewEditorSplitBtn');
const downloadZipBtn = document.getElementById('downloadZipBtn');
const editorFilePath = document.getElementById('editorFilePath');
const editorTextarea = document.getElementById('editorTextarea');
const editorEmptyState = document.getElementById('editorEmptyState');
const saveFileBtn = document.getElementById('saveFileBtn');
const editorStatusMsg = document.getElementById('editorStatusMsg');
const startBtn = document.getElementById('startBtn');
const taskInput = document.getElementById('task');
const logsDiv = document.getElementById('logs');
const chatColumnTitle = document.getElementById('chatColumnTitle');
const createPrBtn = document.getElementById('createPrBtn');
const branchSyncStatus = document.getElementById('branchSyncStatus');

// GitHub Modal Elements
const githubModal = document.getElementById('githubModal');
const closeGithubModal = document.getElementById('closeGithubModal');
const sidebarGithubBtn = document.getElementById('sidebarGithubBtn');
const settingsGithubConnectBtn = document.getElementById('settingsGithubConnectBtn');
const settingsGithubDisconnectBtn = document.getElementById('settingsGithubDisconnectBtn');
const settingsGithubConnectedState = document.getElementById('settingsGithubConnectedState');
const settingsGithubUser = document.getElementById('settingsGithubUser');

const githubAuthView = document.getElementById('githubAuthView');
const githubRepoView = document.getElementById('githubRepoView');
const githubModalFooter = document.getElementById('githubModalFooter');
const startGithubDeviceAuthBtn = document.getElementById('startGithubDeviceAuthBtn');
const deviceCodeBox = document.getElementById('deviceCodeBox');
const userCodeDisplay = document.getElementById('userCodeDisplay');
const verificationLink = document.getElementById('verificationLink');
const devicePollStatus = document.getElementById('devicePollStatus');
const githubPatInput = document.getElementById('githubPatInput');
const savePatBtn = document.getElementById('savePatBtn');

const githubUserAvatar = document.getElementById('githubUserAvatar');
const githubUserName = document.getElementById('githubUserName');
const disconnectGithubBtn = document.getElementById('disconnectGithubBtn');
const githubRepoSelect = document.getElementById('githubRepoSelect');
const githubBranchGroup = document.getElementById('githubBranchGroup');
const githubBranchSelect = document.getElementById('githubBranchSelect');
const repoSizeNotice = document.getElementById('repoSizeNotice');
const repoLoadError = document.getElementById('repoLoadError');
const loadRepoBtn = document.getElementById('loadRepoBtn');

// Load cached credentials, restore tasks & chat history on page load
document.addEventListener("DOMContentLoaded", async () => {
    const cachedApiUrl = localStorage.getItem("caesarion_apiUrl");
    const cachedApiKey = localStorage.getItem("caesarion_apiKey");
    const cachedModel = localStorage.getItem("caesarion_model");
    const cachedView = localStorage.getItem("caesarion_activeView");

    if (cachedApiUrl) document.getElementById('apiUrl').value = cachedApiUrl;
    if (cachedApiKey) document.getElementById('apiKey').value = cachedApiKey;
    if (cachedModel) document.getElementById('model').value = cachedModel;

    if (cachedView === 'editor') {
        switchView('editor');
    } else {
        switchView('tasks');
    }

    setupModeSelector();
    await loadTasks();
    // Restore GitHub session
    initGitHubSession();

    await loadChatHistory();
    updateFileTree();
});

// Switch Main Views (Tasks Central vs Editor & Chat)
function switchView(view) {
    currentActiveView = view;
    localStorage.setItem("caesarion_activeView", view);

    if (view === 'editor') {
        tasksViewSection.classList.remove('active');
        editorViewSection.classList.add('active');
        viewEditorBtn.classList.add('active');
        viewTasksBtn.classList.remove('active');
        updateFileTree();
    } else {
        editorViewSection.classList.remove('active');
        tasksViewSection.classList.add('active');
        viewTasksBtn.classList.add('active');
        viewEditorBtn.classList.remove('active');
        loadTasks();
    }
}

viewTasksBtn.addEventListener('click', () => switchView('tasks'));
viewEditorBtn.addEventListener('click', () => switchView('editor'));

// Mode Selector Buttons
function setupModeSelector() {
    const options = modeSelector.querySelectorAll('.mode-option');
    options.forEach(opt => {
        opt.addEventListener('click', () => {
            options.forEach(o => o.classList.remove('active'));
            opt.classList.add('active');
            selectedTaskMode = opt.getAttribute('data-mode');
        });
    });
}

// ---------------- TASK MANAGEMENT ---------------- //
async function loadTasks() {
    try {
        const res = await fetch('/api/tasks');
        if (!res.ok) return;
        const data = await res.json();
        tasksList = data.tasks || [];
        renderTaskList();

        // Restore active task if available
        if (currentSelectedTaskId) {
            const found = tasksList.find(t => t.id === currentSelectedTaskId);
            if (found) {
                selectTask(found.id, false);
            }
        }
    } catch (e) {
        console.error("Failed to load tasks:", e);
    }
}

function renderTaskList() {
    taskListElem.innerHTML = '';
    if (tasksList.length === 0) {
        taskListElem.innerHTML = `
            <div style="text-align: center; color: var(--text-dim); padding: 24px 12px; font-size: 0.8rem;">
                No tasks yet.<br>Click "New Task" to begin.
            </div>
        `;
        return;
    }

    for (const t of tasksList) {
        const card = document.createElement('div');
        card.className = `task-card ${t.id === currentSelectedTaskId ? 'active' : ''}`;
        card.dataset.id = t.id;

        const statusLabels = {
            planning: 'Planning',
            waiting_review: 'Review Plan',
            running: 'Running',
            ready_for_approval: 'Task Complete',
            approved: 'Approved',
            rejected: 'Rejected',
            failed: 'Failed'
        };

        const statusText = statusLabels[t.status] || t.status;

        card.innerHTML = `
            <div class="task-card-title">${escapeHtml(t.title)}</div>
            <div class="task-card-meta">
                <span class="mode-badge">${t.mode.replace('_', ' ')}</span>
                <span class="status-badge ${t.status}">${statusText}</span>
            </div>
        `;

        card.addEventListener('click', () => {
            selectTask(t.id);
        });

        taskListElem.appendChild(card);
    }
}

function showTaskCreator() {
    currentSelectedTaskId = null;
    if (activeEventSource) {
        activeEventSource.close();
        activeEventSource = null;
    }
    document.querySelectorAll('.task-card').forEach(c => c.classList.remove('active'));
    taskActivePane.style.display = 'none';
    taskCreatorPane.style.display = 'flex';
    taskCreatorPrompt.value = '';
    taskCreatorPrompt.focus();
}

newTaskBtn.addEventListener('click', showTaskCreator);

async function selectTask(taskId, fetchDetails = true) {
    currentSelectedTaskId = taskId;
    document.querySelectorAll('.task-card').forEach(c => {
        if (c.dataset.id === taskId) c.classList.add('active');
        else c.classList.remove('active');
    });

    taskCreatorPane.style.display = 'none';
    taskActivePane.style.display = 'flex';

    if (fetchDetails) {
        try {
            const res = await fetch(`/api/tasks/${taskId}`);
            if (!res.ok) throw new Error('Task not found');
            const data = await res.json();
            const task = data.task;
            updateActiveTaskUI(task);
        } catch (e) {
            console.error(e);
        }
    }

    // Connect SSE stream for live updates
    connectTaskStream(taskId);
}

function updateActiveTaskUI(task) {
    activeTaskTitle.textContent = task.title;
    activeTaskStatusBadge.className = `status-badge ${task.status}`;

    const statusLabels = {
        planning: 'Planning',
        waiting_review: 'Review Plan',
        running: 'Running',
        ready_for_approval: 'Task Complete',
        approved: 'Approved',
        rejected: 'Rejected',
        failed: 'Failed'
    };
    activeTaskStatusBadge.textContent = statusLabels[task.status] || task.status;

    // Show/hide approval banner & review button
    if (task.status === 'ready_for_approval') {
        approvalBanner.style.display = 'flex';
        openApprovalModalBtn.style.display = 'inline-flex';
    } else {
        approvalBanner.style.display = 'none';
        openApprovalModalBtn.style.display = 'none';
    }

    // Populate feed with existing logs
    renderTaskFeed(task.logs || [], task);
}

function renderTaskFeed(logs, task) {
    taskFeed.innerHTML = '';

    for (const item of logs) {
        appendFeedItem(item);
    }

    // If waiting for review of the plan, display prompt in feed
    if (task.status === 'waiting_review' && task.plan) {
        const reviewBox = document.createElement('div');
        reviewBox.className = 'feed-item';
        reviewBox.innerHTML = `
            <div style="background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: var(--radius-sm); padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px;">
                <span style="font-size: 0.88rem; color: #fcd34d;">The plan is ready for your review. Approve to start execution or reply with instructions below.</span>
                <button class="btn-success" id="inlineApprovePlanBtn" style="padding: 6px 14px; font-size: 0.8rem;">Approve Plan & Proceed</button>
            </div>
        `;
        reviewBox.querySelector('#inlineApprovePlanBtn').addEventListener('click', () => {
            replyToActiveTask('', true);
        });
        taskFeed.appendChild(reviewBox);
    }

    taskFeed.scrollTop = taskFeed.scrollHeight;
}

function appendFeedItem(event) {
    const itemElem = document.createElement('div');
    itemElem.className = 'feed-item';

    if (event.type === 'plan_created') {
        itemElem.innerHTML = `
            <div class="feed-plan-card">
                <div class="feed-plan-title">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/></svg>
                    Autonomous Execution Plan
                </div>
                <div class="feed-plan-content">${escapeHtml(event.plan)}</div>
            </div>
        `;
    } else if (event.type === 'tool_call') {
        itemElem.innerHTML = `
            <div class="tool-log-item ${event.tool === 'write_file' ? 'write-file' : 'run-bash'}" style="font-family: var(--font-mono); font-size: 0.78rem; padding: 6px 10px; background: #131722; border-radius: 4px; border-left: 3px solid #3b82f6;">
                <span style="color: #60a5fa; font-weight: 600;">[Tool]</span> ${escapeHtml(event.tool)}
                <div style="color: #94a3b8; margin-top: 2px;">${escapeHtml(JSON.stringify(event.args))}</div>
            </div>
        `;
    } else if (event.type === 'tool_result') {
        itemElem.innerHTML = `
            <div style="font-family: var(--font-mono); font-size: 0.76rem; padding: 6px 10px; background: #0c0e14; border-radius: 4px; color: #64748b; max-height: 120px; overflow-y: auto; white-space: pre-wrap;">
                <span style="color: #10b981;">[Output]</span> ${escapeHtml(event.result)}
            </div>
        `;
    } else if (event.type === 'user_reply') {
        itemElem.innerHTML = `
            <div class="user-msg" style="align-self: flex-end; font-size: 0.88rem;">${escapeHtml(event.message)}</div>
        `;
    } else if (event.type === 'backend_log') {
        itemElem.innerHTML = `
            <div style="font-family: var(--font-mono); font-size: 0.8rem; color: #94a3b8; background: rgba(255, 255, 255, 0.02); padding: 6px 10px; border-radius: 4px; white-space: pre-wrap;">${escapeHtml(event.message)}</div>
        `;
    } else if (event.type === 'ready_for_approval') {
        itemElem.innerHTML = `
            <div style="background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: var(--radius-sm); padding: 12px 16px;">
                <div style="font-weight: 600; color: #34d399; margin-bottom: 4px;">Task Complete in Ghost Staging!</div>
                <div style="font-size: 0.85rem; color: #e2e8f0;">${escapeHtml(event.summary)}</div>
            </div>
        `;
    } else if (event.type === 'approved') {
        itemElem.innerHTML = `
            <div style="background: rgba(16, 185, 129, 0.2); border: 1px solid #10b981; border-radius: var(--radius-sm); padding: 10px 14px; color: #6ee7b7; font-weight: 500; font-size: 0.85rem;">
                Changes approved and applied to live workspace.
            </div>
        `;
    } else if (event.type === 'rejected') {
        itemElem.innerHTML = `
            <div style="background: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; border-radius: var(--radius-sm); padding: 10px 14px; color: #fca5a5; font-size: 0.85rem;">
                ${escapeHtml(event.message)}
            </div>
        `;
    } else if (event.message) {
        itemElem.innerHTML = `
            <div style="font-size: 0.82rem; color: var(--text-dim); padding: 2px 4px;">${escapeHtml(event.message)}</div>
        `;
    }

    taskFeed.appendChild(itemElem);
    taskFeed.scrollTop = taskFeed.scrollHeight;
}

function connectTaskStream(taskId) {
    if (activeEventSource) {
        activeEventSource.close();
        activeEventSource = null;
    }

    const es = new EventSource(`/api/tasks/${taskId}/stream`);
    activeEventSource = es;

    es.onmessage = (e) => {
        try {
            const event = JSON.parse(e.data);
            if (currentSelectedTaskId === taskId) {
                // If status changed or ready for approval
                if (event.type === 'status_change') {
                    activeTaskStatusBadge.className = `status-badge ${event.status}`;
                    activeTaskStatusBadge.textContent = event.status;
        this.isRunning = true;
        const item = this.queue.shift();
        const { targetElem, text, speedMs, onComplete } = item;

        targetElem.classList.add('cursor-blink');

        const chunkSize = speedMs < 15 ? 3 : 1;
        let index = 0;

        await new Promise((resolve) => {
            const timer = setInterval(() => {
                if (index < text.length) {
                    const chunk = text.slice(index, index + chunkSize);
                    targetElem.textContent += chunk;
                    index += chunkSize;
                } else {
                    clearInterval(timer);
                    targetElem.classList.remove('cursor-blink');
                    resolve();
                }
                if (event.type === 'ready_for_approval') {
                    activeTaskStatusBadge.className = 'status-badge ready_for_approval';
                    activeTaskStatusBadge.textContent = 'Task Complete';
                    approvalBanner.style.display = 'flex';
                    openApprovalModalBtn.style.display = 'inline-flex';
                    // Automatically pop up breakdown modal once task completes
                    openTaskApprovalModal(taskId);
                }
                appendFeedItem(event);
                loadTasks(); // refresh task list badges
            }
        } catch (err) {
            console.error("Stream parse error:", err);
        }
    };

    es.onerror = () => {
        // SSE reconnect handles automatically
    };
}

// Launch Task
launchTaskBtn.addEventListener('click', async () => {
    const prompt = taskCreatorPrompt.value.trim();
    const apiUrl = document.getElementById('apiUrl').value;
    const apiKey = document.getElementById('apiKey').value;
    const model = document.getElementById('model').value;

    if (!prompt) {
        alert("Please enter a task description.");
        return;
    }
    if (!apiUrl || !apiKey || !model) {
        alert("Please configure your API credentials in API Settings first.");
        openSettings();
        return;
    }

    launchTaskBtn.disabled = true;
    launchTaskBtn.textContent = 'Launching...';

    try {
        const res = await fetch('/api/tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt,
                mode: selectedTaskMode,
                apiUrl,
                apiKey,
                model
            })
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: 'Failed to create task' }));
            throw new Error(err.error || 'Failed to create task');
        }

        const data = await res.json();
        await loadTasks();
        selectTask(data.task.id);
    } catch (e) {
        alert(`Error starting task: ${e.message}`);
    } finally {
        launchTaskBtn.disabled = false;
        launchTaskBtn.innerHTML = `
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            Start Autonomous Task
        `;
    }
});

// Reply to active task
async function replyToActiveTask(message, approvePlan = false) {
    if (!currentSelectedTaskId) return;

    try {
        const res = await fetch(`/api/tasks/${currentSelectedTaskId}/reply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, approvePlan })
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: 'Failed to send reply' }));
            throw new Error(err.error || 'Failed to send reply');
        }

        taskReplyInput.value = '';
    } catch (e) {
        alert(`Error replying: ${e.message}`);
    }
}

taskReplyBtn.addEventListener('click', () => {
    const text = taskReplyInput.value.trim();
    if (text) replyToActiveTask(text, false);
});

taskReplyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const text = taskReplyInput.value.trim();
        if (text) replyToActiveTask(text, false);
    }
});

// ---------------- APPROVAL POPUP MODAL ---------------- //
async function openTaskApprovalModal(taskId) {
    try {
        const res = await fetch(`/api/tasks/${taskId}`);
        if (!res.ok) return;
        const { task } = await res.json();

        approvalSummaryText.textContent = task.summary || 'Task completed in ghost workspace.';
        approvalExplanationText.textContent = task.explanation || 'No detailed explanation provided.';

        approvalFilesList.innerHTML = '';
        const files = task.modifiedFiles || [];
        if (files.length === 0) {
            approvalFilesList.innerHTML = '<span style="color: var(--text-dim); font-size: 0.8rem;">No files modified</span>';
        } else {
            files.forEach(f => {
                const chip = document.createElement('span');
                chip.className = 'modified-file-chip';
                chip.textContent = f;
                approvalFilesList.appendChild(chip);
            });
        }

        approvalModal.style.display = 'flex';
    } catch (e) {
        console.error("Failed to load task details for approval:", e);
function scrollChatToBottom(force = false) {
    const logsDiv = document.getElementById('logs');
    if (!logsDiv) return;
    if (force) {
        logsDiv.scrollTop = logsDiv.scrollHeight;
    }
}

openApprovalModalBtn.addEventListener('click', () => {
    if (currentSelectedTaskId) openTaskApprovalModal(currentSelectedTaskId);
});
bannerApproveBtn.addEventListener('click', () => {
    if (currentSelectedTaskId) openTaskApprovalModal(currentSelectedTaskId);
});

function closeApprovalModalWindow() {
    approvalModal.style.display = 'none';
}

closeApprovalModal.addEventListener('click', closeApprovalModalWindow);
closeApprovalBtn.addEventListener('click', closeApprovalModalWindow);

approveAndApplyBtn.addEventListener('click', async () => {
    if (!currentSelectedTaskId) return;
    approveAndApplyBtn.disabled = true;
    approveAndApplyBtn.textContent = 'Applying...';

    try {
        const res = await fetch(`/api/tasks/${currentSelectedTaskId}/approve`, {
            method: 'POST'
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: 'Approval failed' }));
            throw new Error(err.error || 'Approval failed');
        }

        closeApprovalModalWindow();
        await loadTasks();
        selectTask(currentSelectedTaskId);
        updateFileTree();
        alert("Changes successfully applied to live workspace! You can now preview or view them in Editor & Chat.");
    } catch (e) {
        alert(`Error approving task: ${e.message}`);
    } finally {
        approveAndApplyBtn.disabled = false;
        approveAndApplyBtn.innerHTML = `
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
            Approve & Apply to Workspace
        `;
    }
});

rejectTaskBtn.addEventListener('click', async () => {
    if (!currentSelectedTaskId) return;
    if (!confirm("Are you sure you want to reject this task? Ghost staging changes will be discarded.")) return;

    try {
        const res = await fetch(`/api/tasks/${currentSelectedTaskId}/reject`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: 'Rejected from review modal' })
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: 'Rejection failed' }));
            throw new Error(err.error || 'Rejection failed');
        }

        closeApprovalModalWindow();
        await loadTasks();
        selectTask(currentSelectedTaskId);
    } catch (e) {
        alert(`Error rejecting task: ${e.message}`);
    }
});

// ---------------- CODE EDITOR & CHAT ---------------- //
async function loadChatHistory() {
    try {
        const res = await fetch('/api/history');
        if (!res.ok) return;
        const data = await res.json();
        if (data.history && data.history.length > 0) {
            removeEmptyState();
            logsDiv.innerHTML = '';
            for (const item of data.history) {
                if (item.role === 'user') {
                    const p = document.createElement('div');
                    p.className = 'user-msg';
                    p.textContent = item.content;
                    logsDiv.appendChild(p);
                } else if (item.role === 'agent') {
                    if (item.backendLogs && item.backendLogs.length > 0) {
                        const card = createBackendCard(item.modifiedFiles || []);
                        const body = card.querySelector('.backend-body');
                        body.textContent = item.backendLogs.join('\n');
                        card.classList.add('collapsed');
                        const toggleBtn = card.querySelector('.backend-toggle-btn');
                        if (toggleBtn) toggleBtn.innerHTML = 'Show logs &#9660;';
                        logsDiv.appendChild(card);
                    }

                    if (item.userReplies && item.userReplies.length > 0) {
                        for (const reply of item.userReplies) {
                            const div = document.createElement('div');
                            div.className = 'agent-msg';
                            div.textContent = reply;
                            logsDiv.appendChild(div);
                        }
                    } else if (item.content && (!item.backendLogs || item.backendLogs.length === 0)) {
                        const div = document.createElement('div');
                        div.className = 'agent-msg';
                        div.textContent = item.content;
                        logsDiv.appendChild(div);
                    }
                }
            }
            logsDiv.scrollTop = logsDiv.scrollHeight;
        }
    } catch (e) {
        console.error("Failed to load chat history:", e);
    }
}

function createBackendCard(modifiedFiles = []) {
    const card = document.createElement('div');
    card.className = 'backend-card';

    const header = document.createElement('div');
    header.className = 'backend-header';

    const titleText = document.createElement('span');
    titleText.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -2px; margin-right: 4px;"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
        Backend Execution
    `;

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'backend-toggle-btn';
    toggleBtn.type = 'button';
    toggleBtn.innerHTML = 'Hide logs &#9650;';

    const body = document.createElement('div');
    body.className = 'backend-body';

    function toggleCollapse() {
        const isCollapsed = card.classList.toggle('collapsed');
        toggleBtn.innerHTML = isCollapsed ? 'Show logs &#9660;' : 'Hide logs &#9650;';
    }

    toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleCollapse();
    });

    header.addEventListener('click', toggleCollapse);

    header.appendChild(titleText);
    header.appendChild(toggleBtn);
    card.appendChild(header);
    card.appendChild(body);

    return card;
}

// Modal Logic
const settingsModal = document.getElementById('settingsModal');
const settingsBtn = document.getElementById('settingsBtn');
const closeSettings = document.getElementById('closeSettings');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');

function openSettings() {
    settingsModal.style.display = 'flex';
    updateSettingsGithubUI();
}

function saveAndCloseSettings() {
    localStorage.setItem("caesarion_apiUrl", document.getElementById('apiUrl').value);
    localStorage.setItem("caesarion_apiKey", document.getElementById('apiKey').value);
    localStorage.setItem("caesarion_model", document.getElementById('model').value);
    settingsModal.style.display = 'none';
}

settingsBtn.addEventListener('click', openSettings);
closeSettings.addEventListener('click', saveAndCloseSettings);
if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener('click', saveAndCloseSettings);
}

window.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
        saveAndCloseSettings();
    }
    if (e.target === githubModal) {
        closeGithub();
    }
});

window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (settingsModal.style.display === 'flex') saveAndCloseSettings();
        if (githubModal.style.display === 'flex') closeGithub();
    }
});

// View Mode Switching
function setViewMode(mode) {
    currentViewMode = mode;
    localStorage.setItem("caesarion_viewMode", mode);

    if (mode === 'split') {
        appContainer.classList.add('mode-split');
        viewEditorSplitBtn.classList.add('active');
        viewChatOnlyBtn.classList.remove('active');
        if (chatColumnTitle) chatColumnTitle.textContent = 'Agent Assistant';
    } else {
        appContainer.classList.remove('mode-split');
        viewChatOnlyBtn.classList.add('active');
        viewEditorSplitBtn.classList.remove('active');
        if (chatColumnTitle) chatColumnTitle.textContent = 'Chat Log';
    }
}

viewChatOnlyBtn.addEventListener('click', () => setViewMode('chat'));
viewEditorSplitBtn.addEventListener('click', () => setViewMode('split'));

// -------------------------------------------------------------
// GITHUB INTEGRATION
// -------------------------------------------------------------

function initGitHubSession() {
    const cachedToken = localStorage.getItem('caesarion_github_token');
    const cachedUser = localStorage.getItem('caesarion_github_user');
    const cachedRepo = localStorage.getItem('caesarion_github_repo');
    const cachedBaseBranch = localStorage.getItem('caesarion_github_baseBranch');

    if (cachedToken) {
        githubState.token = cachedToken;
        if (cachedUser) {
            try { githubState.user = JSON.parse(cachedUser); } catch(e){}
        }
        if (cachedRepo) {
            try { githubState.activeRepo = JSON.parse(cachedRepo); } catch(e){}
        }
        if (cachedBaseBranch) {
            githubState.baseBranch = cachedBaseBranch;
        }

        // Verify token in background
        verifyGitHubToken(cachedToken);
        if (githubState.activeRepo) {
            startAutoSync();
        }
    }
    updateSettingsGithubUI();
    updatePrButtonState();
}

function updateSettingsGithubUI() {
    if (githubState.token && githubState.user) {
        if (settingsGithubConnectBtn) settingsGithubConnectBtn.style.display = 'none';
        if (settingsGithubConnectedState) settingsGithubConnectedState.style.display = 'flex';
        if (settingsGithubUser) settingsGithubUser.textContent = `Connected as @${githubState.user.login}`;
    } else {
        if (settingsGithubConnectBtn) settingsGithubConnectBtn.style.display = 'flex';
        if (settingsGithubConnectedState) settingsGithubConnectedState.style.display = 'none';
    }
}

function updatePrButtonState() {
    if (createPrBtn) {
        if (githubState.token && githubState.activeRepo) {
            createPrBtn.style.display = 'inline-flex';
            createPrBtn.disabled = false;
            createPrBtn.title = `Create Pull Request for ${githubState.activeRepo.owner}/${githubState.activeRepo.repo}`;
        } else {
            createPrBtn.style.display = 'inline-flex';
            createPrBtn.disabled = true;
            createPrBtn.title = 'Connect a GitHub repository to create PRs';
        }
    }
}

function openGithubModal() {
    githubModal.style.display = 'flex';
    if (githubState.token) {
        showConnectedRepoView();
    } else {
        showUnconnectedAuthView();
    }
}

function closeGithub() {
    githubModal.style.display = 'none';
    if (githubState.devicePollTimer) {
        clearInterval(githubState.devicePollTimer);
        githubState.devicePollTimer = null;
    }
}

if (sidebarGithubBtn) sidebarGithubBtn.addEventListener('click', openGithubModal);
if (settingsGithubConnectBtn) {
    settingsGithubConnectBtn.addEventListener('click', () => {
        saveAndCloseSettings();
        openGithubModal();
    });
}
if (settingsGithubDisconnectBtn) {
    settingsGithubDisconnectBtn.addEventListener('click', disconnectGitHub);
}
if (closeGithubModal) closeGithubModal.addEventListener('click', closeGithub);

function showUnconnectedAuthView() {
    githubAuthView.style.display = 'flex';
    githubRepoView.style.display = 'none';
    githubModalFooter.style.display = 'none';
    deviceCodeBox.style.display = 'none';
    startGithubDeviceAuthBtn.style.display = 'inline-flex';
}

function showConnectedRepoView() {
    githubAuthView.style.display = 'none';
    githubRepoView.style.display = 'flex';
    githubModalFooter.style.display = 'flex';

    if (githubState.user) {
        githubUserName.textContent = githubState.user.name ? `${githubState.user.name} (@${githubState.user.login})` : `@${githubState.user.login}`;
        if (githubState.user.avatar_url) {
            githubUserAvatar.src = githubState.user.avatar_url;
            githubUserAvatar.style.display = 'inline-block';
        }
    }

    loadUserRepositories();
}

async function verifyGitHubToken(token) {
    try {
        const res = await fetch('/api/github/user', {
            headers: { 'Authorization': `token ${token}` }
        });
        if (res.ok) {
            const user = await res.json();
            githubState.user = user;
            localStorage.setItem('caesarion_github_user', JSON.stringify(user));
            updateSettingsGithubUI();
        } else {
            // Invalid token
            disconnectGitHub();
        }
    } catch (e) {
        console.error("Token verification failed:", e);
    }
}

// Device Flow Authorization
if (startGithubDeviceAuthBtn) {
    startGithubDeviceAuthBtn.addEventListener('click', async () => {
        try {
            startGithubDeviceAuthBtn.disabled = true;
            startGithubDeviceAuthBtn.textContent = 'Requesting authorization...';

            const res = await fetch('/api/github/device-code', { method: 'POST' });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Failed to start device authorization flow');
            }

            const data = await res.json();
            userCodeDisplay.textContent = data.user_code;
            verificationLink.href = data.verification_uri;
            deviceCodeBox.style.display = 'flex';
            startGithubDeviceAuthBtn.style.display = 'none';

            // Poll for authorization
            const interval = (data.interval || 5) * 1000;
            githubState.devicePollTimer = setInterval(async () => {
                try {
                    const pollRes = await fetch('/api/github/device-token', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ device_code: data.device_code })
                    });
                    const pollData = await pollRes.json();

                    if (pollData.access_token) {
                        clearInterval(githubState.devicePollTimer);
                        githubState.devicePollTimer = null;
                        devicePollStatus.textContent = 'Authorized! Loading your profile...';

                        githubState.token = pollData.access_token;
                        localStorage.setItem('caesarion_github_token', pollData.access_token);

                        await verifyGitHubToken(pollData.access_token);
                        showConnectedRepoView();
                    } else if (pollData.error === 'authorization_pending') {
                        devicePollStatus.textContent = 'Waiting for your approval on GitHub...';
                    } else if (pollData.error === 'slow_down') {
                        // Keep waiting
                    } else if (pollData.error) {
                        clearInterval(githubState.devicePollTimer);
                        githubState.devicePollTimer = null;
                        devicePollStatus.textContent = `Error: ${pollData.error_description || pollData.error}`;
                        startGithubDeviceAuthBtn.style.display = 'inline-flex';
                        startGithubDeviceAuthBtn.disabled = false;
                        startGithubDeviceAuthBtn.textContent = 'Connect with GitHub';
                    }
                } catch (e) {
                    console.error("Polling error:", e);
                }
            }, interval);

        } catch (err) {
            alert(`GitHub Auth Error: ${err.message}`);
            startGithubDeviceAuthBtn.disabled = false;
            startGithubDeviceAuthBtn.textContent = 'Connect with GitHub';
        }
    });
}

// PAT Connect Button
if (savePatBtn) {
    savePatBtn.addEventListener('click', async () => {
        const pat = githubPatInput.value.trim();
        if (!pat) {
            alert("Please enter a valid GitHub token.");
            return;
        }

        savePatBtn.disabled = true;
        savePatBtn.textContent = 'Verifying...';

        try {
            const res = await fetch('/api/github/user', {
                headers: { 'Authorization': `token ${pat}` }
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Invalid GitHub token');
            }

            const user = await res.json();
            githubState.token = pat;
            githubState.user = user;
            localStorage.setItem('caesarion_github_token', pat);
            localStorage.setItem('caesarion_github_user', JSON.stringify(user));

            githubPatInput.value = '';
            showConnectedRepoView();
            updateSettingsGithubUI();
        } catch (err) {
            alert(`Error connecting GitHub: ${err.message}`);
        } finally {
            savePatBtn.disabled = false;
            savePatBtn.textContent = 'Connect';
        }
    });
}

function disconnectGitHub() {
    githubState.token = null;
    githubState.user = null;
    githubState.activeRepo = null;
    githubState.baseBranch = null;
    localStorage.removeItem('caesarion_github_token');
    localStorage.removeItem('caesarion_github_user');
    localStorage.removeItem('caesarion_github_repo');
    localStorage.removeItem('caesarion_github_baseBranch');

    if (githubState.autoSyncTimer) {
        clearInterval(githubState.autoSyncTimer);
        githubState.autoSyncTimer = null;
    }

    updateSettingsGithubUI();
    updatePrButtonState();
    showUnconnectedAuthView();
    updateFileTree();
}

if (disconnectGithubBtn) disconnectGithubBtn.addEventListener('click', disconnectGitHub);

// List Repositories
async function loadUserRepositories() {
    githubRepoSelect.innerHTML = '<option value="">Loading repositories...</option>';
    githubRepoSelect.disabled = true;
    githubBranchGroup.style.display = 'none';
    repoSizeNotice.style.display = 'none';
    repoLoadError.style.display = 'none';
    loadRepoBtn.disabled = true;

    try {
        const res = await fetch('/api/github/repos', {
            headers: { 'Authorization': `token ${githubState.token}` }
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to list repositories');
        }

        const data = await res.json();
        githubRepoSelect.innerHTML = '<option value="">-- Choose a repository --</option>';

        if (data.repos && data.repos.length > 0) {
            data.repos.forEach(repo => {
                const opt = document.createElement('option');
                opt.value = JSON.stringify({
                    owner: repo.owner,
                    repo: repo.name,
                    defaultBranch: repo.default_branch,
                    size: repo.size,
                    fullName: repo.full_name
                });
                opt.textContent = `${repo.full_name} ${repo.private ? '(Private)' : ''}`;
                githubRepoSelect.appendChild(opt);
            });
            githubRepoSelect.disabled = false;
        } else {
            githubRepoSelect.innerHTML = '<option value="">No repositories found.</option>';
        }
    } catch (err) {
        githubRepoSelect.innerHTML = `<option value="">Error: ${err.message}</option>`;
    }
}

// Repo selection change -> Fetch branches & check size
githubRepoSelect.addEventListener('change', async () => {
    const selectedVal = githubRepoSelect.value;
    repoLoadError.style.display = 'none';
    loadRepoBtn.disabled = true;

    if (!selectedVal) {
        githubBranchGroup.style.display = 'none';
        repoSizeNotice.style.display = 'none';
        return;
    }

    const repoInfo = JSON.parse(selectedVal);
    const sizeMB = ((repoInfo.size || 0) / 1024).toFixed(1);

    // 50MB Size Check: repoInfo.size is in KB (50MB = 51200KB)
    if (repoInfo.size > 51200) {
        repoSizeNotice.style.display = 'none';
        repoLoadError.textContent = `Error: Larger repositories are not yet supported. This repository is ${sizeMB}MB (maximum repo size is 50MB).`;
        repoLoadError.style.display = 'block';
        githubBranchGroup.style.display = 'none';
        loadRepoBtn.disabled = true;
        return;
    }

    repoSizeNotice.textContent = `Repository size: ~${sizeMB}MB (Limit: 50MB)`;
    repoSizeNotice.style.display = 'block';

    // Fetch branches for repo
    githubBranchSelect.innerHTML = '<option value="">Loading branches...</option>';
    githubBranchGroup.style.display = 'block';
    githubBranchSelect.disabled = true;

    try {
        const res = await fetch(`/api/github/branches?owner=${encodeURIComponent(repoInfo.owner)}&repo=${encodeURIComponent(repoInfo.repo)}`, {
            headers: { 'Authorization': `token ${githubState.token}` }
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to fetch branches');
        }

        const data = await res.json();
        githubBranchSelect.innerHTML = '<option value="">-- Choose a branch --</option>';

        if (data.branches && data.branches.length > 0) {
            data.branches.forEach(branch => {
                const opt = document.createElement('option');
                opt.value = branch.name;
                opt.textContent = branch.name === repoInfo.defaultBranch ? `${branch.name} (default)` : branch.name;
                if (branch.name === repoInfo.defaultBranch) {
                    opt.selected = true;
                }
                githubBranchSelect.appendChild(opt);
            });
            githubBranchSelect.disabled = false;
            loadRepoBtn.disabled = !githubBranchSelect.value;
        }
    } catch (err) {
        repoLoadError.textContent = `Failed to load branches: ${err.message}`;
        repoLoadError.style.display = 'block';
    }
});

githubBranchSelect.addEventListener('change', () => {
    loadRepoBtn.disabled = !githubBranchSelect.value;
});

// Load Repo into Workspace Button
if (loadRepoBtn) {
    loadRepoBtn.addEventListener('click', async () => {
        const repoVal = githubRepoSelect.value;
        const branchVal = githubBranchSelect.value;
        if (!repoVal || !branchVal) return;

        const repoInfo = JSON.parse(repoVal);

        loadRepoBtn.disabled = true;
        loadRepoBtn.textContent = 'Loading repository...';
        repoLoadError.style.display = 'none';

        try {
            const res = await fetch('/api/github/load-repo', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    owner: repoInfo.owner,
                    repo: repoInfo.repo,
                    branch: branchVal,
                    token: githubState.token
                })
            });

            const data = await res.json();
            if (!res.ok || data.error) {
                throw new Error(data.error || 'Failed to load repository into workspace');
            }

            // Save active repo session
            githubState.activeRepo = repoInfo;
            githubState.baseBranch = branchVal;
            localStorage.setItem('caesarion_github_repo', JSON.stringify(repoInfo));
            localStorage.setItem('caesarion_github_baseBranch', branchVal);

            closeGithub();
            updatePrButtonState();
            await updateFileTree();
            startAutoSync();

            alert(`Repository ${repoInfo.fullName} (${branchVal}) successfully loaded! Changes will sync to caesarion-branch every 30s.`);
        } catch (err) {
            repoLoadError.textContent = err.message;
            repoLoadError.style.display = 'block';
        } finally {
            loadRepoBtn.disabled = false;
            loadRepoBtn.textContent = 'Load In';
        }
    });
}

// -------------------------------------------------------------
// AUTO-SYNC WORKSPACE DIFFS EVERY 30 SECONDS
// -------------------------------------------------------------
function startAutoSync() {
    if (githubState.autoSyncTimer) {
        clearInterval(githubState.autoSyncTimer);
    }

    if (branchSyncStatus) {
        branchSyncStatus.textContent = 'Branch synched';
        branchSyncStatus.style.color = 'var(--text-dim)';
    }

    githubState.autoSyncTimer = setInterval(async () => {
        if (!githubState.token || !githubState.activeRepo) return;

        try {
            const res = await fetch('/api/github/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    owner: githubState.activeRepo.owner,
                    repo: githubState.activeRepo.repo,
                    branch: githubState.caesarionBranch,
                    token: githubState.token
                })
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Sync failed');
            }

            const data = await res.json();
            if (branchSyncStatus) {
                branchSyncStatus.textContent = 'Branch synched';
                branchSyncStatus.style.color = 'var(--success)';
                setTimeout(() => {
                    if (branchSyncStatus) branchSyncStatus.style.color = 'var(--text-dim)';
                }, 3000);
            }
        } catch (e) {
            console.error("Auto-sync error:", e.message);
            if (branchSyncStatus) {
                branchSyncStatus.textContent = 'Error synching branch';
                branchSyncStatus.style.color = 'var(--danger)';
            }
        }
    }, 30000); // 30 seconds
}

// -------------------------------------------------------------
// CREATE PULL REQUEST BUTTON
// -------------------------------------------------------------
if (createPrBtn) {
    createPrBtn.addEventListener('click', async () => {
        if (!githubState.token || !githubState.activeRepo) {
            openGithubModal();
            return;
        }

        const apiUrl = document.getElementById('apiUrl').value;
        const apiKey = document.getElementById('apiKey').value;
        const model = document.getElementById('model').value;

        createPrBtn.disabled = true;
        createPrBtn.innerHTML = `
            <svg class="spinner" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1s linear infinite;"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>
            Creating PR...
        `;

        try {
            const res = await fetch('/api/github/create-pr', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    owner: githubState.activeRepo.owner,
                    repo: githubState.activeRepo.repo,
                    headBranch: githubState.caesarionBranch,
                    baseBranch: githubState.baseBranch || 'main',
                    token: githubState.token,
                    apiUrl,
                    apiKey,
                    model
                })
            });

            const data = await res.json();
            if (!res.ok || data.error) {
                throw new Error(data.error || 'Failed to create Pull Request');
            }

            if (branchSyncStatus) {
                branchSyncStatus.textContent = 'Branch synched';
                branchSyncStatus.style.color = 'var(--success)';
            }

            // Redirect user directly to the PR page on GitHub
            if (data.prUrl) {
                window.open(data.prUrl, '_blank') || (window.location.href = data.prUrl);
            }
        } catch (err) {
            alert(`Error creating Pull Request: ${err.message}`);
        } finally {
            createPrBtn.disabled = false;
            createPrBtn.innerHTML = `
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" y1="9" x2="6" y2="21"/></svg>
                Create PR
            `;
        }
    });
}

// File Tree Polling & Selection
let treeInterval = null;
async function updateFileTree() {
    try {
        const res = await fetch('/api/files');
        const html = await res.text();
        const treeElem = document.getElementById('fileTree');
        if (treeElem) {
            treeElem.innerHTML = html;
            if (currentSelectedFile) {
                const activeLink = treeElem.querySelector(`[data-path="${CSS.escape(currentSelectedFile)}"]`);
                if (activeLink) activeLink.classList.add('active');
            // Check if workspace is empty
            const isWorkspaceEmpty = !html.trim() || html.includes('Workspace is empty.') || html.includes('(empty directory)');
            if (isWorkspaceEmpty) {
                treeElem.innerHTML = `
                    <div class="empty-filesystem-state" style="padding: 24px 12px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 12px; color: var(--text-muted); font-family: var(--font-sans);">
                        <div style="width: 40px; height: 40px; border-radius: 50%; background: var(--bg-surface-elevated); display: flex; align-items: center; justify-content: center; border: 1px solid var(--border-subtle); color: var(--text-main);">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>
                        </div>
                        <div style="font-size: 0.88rem; font-weight: 500; color: var(--text-main); line-height: 1.4;">
                            Chat to Get Started Or Initiate a remote repository session
                        </div>
                        <button id="emptyWsConnectGithubBtn" type="button" style="background-color: var(--primary); color: #ffffff; padding: 7px 12px; font-size: 0.8rem; font-weight: 500; border-radius: var(--radius-sm); margin-top: 4px;">
                            Connect GitHub
                        </button>
                    </div>
                `;
                const emptyBtn = document.getElementById('emptyWsConnectGithubBtn');
                if (emptyBtn) {
                    emptyBtn.addEventListener('click', openGithubModal);
                }
            } else {
                treeElem.innerHTML = html;
                if (currentSelectedFile) {
                    const activeLink = treeElem.querySelector(`[data-path="${CSS.escape(currentSelectedFile)}"]`);
                    if (activeLink) {
                        activeLink.classList.add('active');
                    }
                }
            }
        }
    } catch (e) {
        const treeElem = document.getElementById('fileTree');
        if (treeElem) treeElem.innerHTML = '<span style="color: #ef4444;">Failed to load file tree.</span>';
    }
}

document.getElementById('fileTree').addEventListener('click', async (e) => {
    if (e.target.closest('#emptyWsConnectGithubBtn')) return;
    const fileLink = e.target.closest('.file-item') || (e.target.tagName === 'A' ? e.target : null);
    if (!fileLink) return;

    e.preventDefault();
    const filePath = fileLink.getAttribute('data-path') || fileLink.textContent.trim();
    if (!filePath) return;

    await openFileInEditor(filePath);
});

async function openFileInEditor(filePath) {
    try {
        const res = await fetch(`/api/file?file=${encodeURIComponent(filePath)}`);
        if (!res.ok) throw new Error('Failed to read file');

        const data = await res.json();
        currentSelectedFile = filePath;

        if (currentViewMode !== 'split') {
            setViewMode('split');
        }

        document.querySelectorAll('#fileTree .file-item').forEach(el => {
            if (el.getAttribute('data-path') === filePath) el.classList.add('active');
            else el.classList.remove('active');
        });

        editorFilePath.textContent = filePath;
        editorTextarea.value = data.content;
        editorTextarea.disabled = false;
        saveFileBtn.disabled = false;
        editorEmptyState.classList.add('hidden');
        editorTextarea.focus();
    } catch (err) {
        alert(`Error opening file: ${err.message}`);
    }
}

async function saveCurrentFile() {
    if (!currentSelectedFile) return;

    const content = editorTextarea.value;
    saveFileBtn.disabled = true;

    try {
        const res = await fetch('/api/file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file: currentSelectedFile, content })
        });

        if (!res.ok) throw new Error('Failed to save file');

        editorStatusMsg.classList.add('show');
        setTimeout(() => editorStatusMsg.classList.remove('show'), 2000);
    } catch (err) {
        alert(`Error saving file: ${err.message}`);
    } finally {
        saveFileBtn.disabled = false;
    }
}

saveFileBtn.addEventListener('click', saveCurrentFile);

editorTextarea.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveCurrentFile();
    }
});

downloadZipBtn.addEventListener('click', () => {
    window.location.href = '/api/download-zip';
});

// Reset Session & Workspace
function removeEmptyState() {
    const emptyState = document.getElementById('emptyLogs');
    if (emptyState) {
        emptyState.remove();
    }
}

function showEmptyStateIfNeeded() {
    const logsDiv = document.getElementById('logs');
    if (!logsDiv.hasChildNodes() || logsDiv.children.length === 0) {
        logsDiv.innerHTML = `
            <div class="empty-state" id="emptyLogs">
                <div class="empty-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                </div>
                <h3>Chat to Get Started Or Initiate a remote repository session</h3>
                <p>Caesarion can run commands, inspect and write files, formulate plans, and autonomously solve problems in its workspace.</p>
                <button id="emptyChatConnectGithubBtn" type="button" style="background-color: var(--primary); color: #ffffff; padding: 8px 14px; font-size: 0.85rem; font-weight: 500; border-radius: var(--radius-sm); margin-top: 6px;">
                    Connect GitHub
                </button>
            </div>
        `;
        const chatEmptyBtn = document.getElementById('emptyChatConnectGithubBtn');
        if (chatEmptyBtn) {
            chatEmptyBtn.addEventListener('click', openGithubModal);
        }
    }
}

// Reset Session
document.getElementById('resetBtn').addEventListener('click', async () => {
    if (!confirm("Are you sure you want to reset all tasks, session, and workspace?")) return;
    try {
        await fetch('/api/reset', { method: 'POST' });
        logsDiv.innerHTML = '';
        currentSelectedTaskId = null;
        await loadTasks();
        showTaskCreator();
        await updateFileTree();
        alert("Session, tasks and workspace reset successfully.");
    } catch (e) {
        alert("Error resetting: " + e.message);
    }
});

// Chat Send Message in Editor View
async function handleSendChatMessage() {
    const apiUrl = document.getElementById('apiUrl').value;
    const apiKey = document.getElementById('apiKey').value;
    const model = document.getElementById('model').value;
    const task = taskInput.value.trim();

    if (!apiUrl || !apiKey || !model || !task) {
        alert("Please fill in API settings and task prompt.");
        return;
    }

    removeEmptyState();
    const userP = document.createElement('div');
    userP.className = 'user-msg';
    userP.textContent = task;
    logsDiv.appendChild(userP);
    taskInput.value = '';

    startBtn.disabled = true;
    startBtn.textContent = 'Running...';
    logUserMessage(task);
    taskInput.value = '';

    currentBackendCard = null;
    currentBackendBody = null;
    currentUserMsgDiv = null;
    modifiedFilesSet.clear();

    startBtn.disabled = true;
    startBtn.innerHTML = `
        <svg class="spinner" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1s linear infinite;"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>
        Running...
    `;

    treeInterval = setInterval(updateFileTree, 2000);
    const logsDiv = document.getElementById('logs');

    function ensureBackendCard() {
        if (!currentBackendCard) {
            removeEmptyState();
            currentBackendCard = createBackendCard([]);
            currentBackendBody = currentBackendCard.querySelector('.backend-body');
            logsDiv.appendChild(currentBackendCard);
        }
        return currentBackendBody;
    }

    try {
        const response = await fetch('/api/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiUrl, apiKey, model, task })
        });

        if (!response.body) throw new Error("No response body.");

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = '';
        let bCard = null;
        let bBody = null;
        let userReplyDiv = null;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            let parts = buffer.split('\n\n');
            buffer = parts.pop();

            for (let eventStr of parts) {
                if (eventStr.startsWith('data: ')) {
                    try {
                        const event = JSON.parse(eventStr.substring(6));
                        if (event.type === 'user_reply') {
                            if (!userReplyDiv) {
                                userReplyDiv = document.createElement('div');
                                userReplyDiv.className = 'agent-msg';
                                logsDiv.appendChild(userReplyDiv);
                            }
                            userReplyDiv.textContent += event.message + '\n';
                        } else if (event.message) {
                            if (!bCard) {
                                bCard = createBackendCard([]);
                                bBody = bCard.querySelector('.backend-body');
                                logsDiv.appendChild(bCard);
                            }
                            bBody.textContent += (event.message || '') + '\n';
                            await typewriter.add(currentUserMsgDiv, event.message + '\n\n', 25, false);
                        } else if (event.type === 'backend_log' || event.type === 'tool_call' || event.type === 'tool_result' || event.type === 'iteration_start') {
                            const bBody = ensureBackendCard();
                            const line = (event.message || '') + '\n';
                            await typewriter.add(bBody, line, 12, true);
                        } else if (event.type === 'turn_complete') {
                            if (event.modifiedFiles && Array.isArray(event.modifiedFiles)) {
                                event.modifiedFiles.forEach(f => modifiedFilesSet.add(f));
                            }
                        } else if (event.type === 'log') {
                            const bBody = ensureBackendCard();
                            await typewriter.add(bBody, event.message + '\n', 12, true);
                        } else if (event.type === 'error') {
                            const bBody = ensureBackendCard();
                            await typewriter.add(bBody, `Error: ${event.message}\n`, 12, true);
                        }
                    } catch (e) {}
                }
            }
        }
    } catch (err) {
        const errDiv = document.createElement('div');
        errDiv.className = 'agent-msg';
        errDiv.style.color = '#ef4444';
        errDiv.textContent = `Error: ${err.message}`;
        logsDiv.appendChild(errDiv);
    } finally {
        if (currentBackendCard) {
            const filesList = Array.from(modifiedFilesSet);
            const summaryTag = currentBackendCard.querySelector('.backend-summary-tag');
            if (summaryTag) {
                if (filesList.length > 0) {
                    summaryTag.textContent = `${filesList.length} file${filesList.length > 1 ? 's' : ''} modified (${filesList.join(', ')})`;
                } else {
                    summaryTag.textContent = 'Execution finished';
                }
            }
            currentBackendCard.classList.add('collapsed');
            const toggleBtn = currentBackendCard.querySelector('.backend-toggle-btn');
            if (toggleBtn) {
                toggleBtn.innerHTML = 'Show logs &#9660;';
            }
        }

        currentBackendCard = null;
        currentBackendBody = null;
        currentUserMsgDiv = null;

        startBtn.disabled = false;
        startBtn.innerHTML = `
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            Send
        `;
        if (treeInterval) clearInterval(treeInterval);
        updateFileTree();
    }
}

startBtn.addEventListener('click', handleSendChatMessage);
taskInput.addEventListener('keydown', (e) => {
document.getElementById('startBtn').addEventListener('click', handleSendMessage);

document.getElementById('task').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendChatMessage();
    }
});

function removeEmptyState() {
    const emptyState = document.getElementById('emptyLogs');
    if (emptyState) emptyState.remove();
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Settings modal
const settingsModal = document.getElementById('settingsModal');
const settingsBtn = document.getElementById('settingsBtn');
const closeSettings = document.getElementById('closeSettings');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');

function openSettings() {
    settingsModal.style.display = 'flex';
}

function saveAndCloseSettings() {
    localStorage.setItem("caesarion_apiUrl", document.getElementById('apiUrl').value);
    localStorage.setItem("caesarion_apiKey", document.getElementById('apiKey').value);
    localStorage.setItem("caesarion_model", document.getElementById('model').value);
    settingsModal.style.display = 'none';
}

settingsBtn.addEventListener('click', openSettings);
closeSettings.addEventListener('click', saveAndCloseSettings);
saveSettingsBtn.addEventListener('click', saveAndCloseSettings);
window.addEventListener('click', (e) => {
    if (e.target === settingsModal) saveAndCloseSettings();
    if (e.target === approvalModal) closeApprovalModalWindow();
});
