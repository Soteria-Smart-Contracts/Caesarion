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
const downloadZipBtn = document.getElementById('downloadZipBtn');
const editorFilePath = document.getElementById('editorFilePath');
const editorTextarea = document.getElementById('editorTextarea');
const editorEmptyState = document.getElementById('editorEmptyState');
const saveFileBtn = document.getElementById('saveFileBtn');
const editorStatusMsg = document.getElementById('editorStatusMsg');
const startBtn = document.getElementById('startBtn');
const taskInput = document.getElementById('task');
const logsDiv = document.getElementById('logs');

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
            }
        }
    } catch (e) {
        const treeElem = document.getElementById('fileTree');
        if (treeElem) treeElem.innerHTML = '<span style="color: #ef4444;">Failed to load file tree.</span>';
    }
}

document.getElementById('fileTree').addEventListener('click', async (e) => {
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
        startBtn.disabled = false;
        startBtn.innerHTML = `
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            Send
        `;
        updateFileTree();
    }
}

startBtn.addEventListener('click', handleSendChatMessage);
taskInput.addEventListener('keydown', (e) => {
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
