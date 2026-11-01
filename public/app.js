// State variables
let currentSelectedFile = null;
let currentViewMode = 'chat'; // 'chat' or 'split'

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
const chatColumnTitle = document.getElementById('chatColumnTitle');

// Load cached credentials and restore chat history on page load
document.addEventListener("DOMContentLoaded", async () => {
    const cachedApiUrl = localStorage.getItem("caesarion_apiUrl");
    const cachedApiKey = localStorage.getItem("caesarion_apiKey");
    const cachedModel = localStorage.getItem("caesarion_model");
    const cachedViewMode = localStorage.getItem("caesarion_viewMode");

    if (cachedApiUrl) document.getElementById('apiUrl').value = cachedApiUrl;
    if (cachedApiKey) document.getElementById('apiKey').value = cachedApiKey;
    if (cachedModel) document.getElementById('model').value = cachedModel;

    if (cachedViewMode === 'split') {
        setViewMode('split');
    } else {
        setViewMode('chat');
    }

    await loadChatHistory();
    updateFileTree();
});

// Typewriter rendering queue for smooth, paced output
class TypewriterQueue {
    constructor() {
        this.queue = [];
        this.isRunning = false;
    }

    add(targetElem, text, speedMs = 20, isBackend = false, onComplete = null) {
        return new Promise((resolve) => {
            this.queue.push({
                targetElem,
                text,
                speedMs,
                isBackend,
                onComplete: () => {
                    if (onComplete) onComplete();
                    resolve();
                }
            });
            if (!this.isRunning) {
                this.processNext();
            }
        });
    }

    async processNext() {
        if (this.queue.length === 0) {
            this.isRunning = false;
            return;
        }

        this.isRunning = true;
        const item = this.queue.shift();
        const { targetElem, text, speedMs, onComplete } = item;

        targetElem.classList.add('cursor-blink');

        // Type character by character or small chunks for high responsiveness
        const chunkSize = speedMs < 15 ? 3 : 1;
        let index = 0;

        await new Promise((resolve) => {
            const timer = setInterval(() => {
                if (index < text.length) {
                    const chunk = text.slice(index, index + chunkSize);
                    targetElem.textContent += chunk;
                    index += chunkSize;
                    scrollChatToBottom();
                } else {
                    clearInterval(timer);
                    targetElem.classList.remove('cursor-blink');
                    resolve();
                }
            }, Math.max(5, speedMs));
        });

        if (onComplete) onComplete();
        this.processNext();
    }
}

const typewriter = new TypewriterQueue();

function scrollChatToBottom(force = false) {
    const logsDiv = document.getElementById('logs');
    if (!logsDiv) return;
    // Auto-scroll if user is near bottom or force is true
    const threshold = 120;
    const isNearBottom = (logsDiv.scrollHeight - logsDiv.scrollTop - logsDiv.clientHeight) < threshold;
    if (force || isNearBottom) {
        logsDiv.scrollTop = logsDiv.scrollHeight;
    }
}

async function loadChatHistory() {
    try {
        const res = await fetch('/api/history');
        if (!res.ok) return;
        const data = await res.json();
        if (data.history && data.history.length > 0) {
            removeEmptyState();
            const logsDiv = document.getElementById('logs');
            logsDiv.innerHTML = '';
            for (const item of data.history) {
                if (item.role === 'user') {
                    const p = document.createElement('div');
                    p.className = 'user-msg';
                    p.textContent = item.content;
                    logsDiv.appendChild(p);
                } else if (item.role === 'agent') {
                    // Check if structured history with backend logs & modified files
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
        } else {
            showEmptyStateIfNeeded();
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

    const titleGroup = document.createElement('div');
    titleGroup.className = 'backend-header-title';

    const titleText = document.createElement('span');
    titleText.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -2px; margin-right: 4px;"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
        Backend Execution
    `;
    titleGroup.appendChild(titleText);

    const summaryTag = document.createElement('span');
    summaryTag.className = 'backend-summary-tag';
    if (modifiedFiles.length > 0) {
        summaryTag.textContent = `${modifiedFiles.length} file${modifiedFiles.length > 1 ? 's' : ''} modified (${modifiedFiles.join(', ')})`;
    } else {
        summaryTag.textContent = 'Running tasks';
    }
    titleGroup.appendChild(summaryTag);

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

    header.addEventListener('click', () => {
        toggleCollapse();
    });

    header.appendChild(titleGroup);
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
}

function saveAndCloseSettings() {
    // Save to local storage cache on modal close
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

// Close modal if user clicks on backdrop
window.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
        saveAndCloseSettings();
    }
});

// Close modal on Escape key
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && settingsModal.style.display === 'flex') {
        saveAndCloseSettings();
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

// File Tree Polling & Selection
let treeInterval = null;
async function updateFileTree() {
    try {
        const res = await fetch('/api/files');
        const html = await res.text();
        const treeElem = document.getElementById('fileTree');
        if (treeElem) {
            treeElem.innerHTML = html;

            // Highlight currently selected file if present
            if (currentSelectedFile) {
                const activeLink = treeElem.querySelector(`[data-path="${CSS.escape(currentSelectedFile)}"]`);
                if (activeLink) {
                    activeLink.classList.add('active');
                }
            }
        }
    } catch (e) {
        const treeElem = document.getElementById('fileTree');
        if (treeElem) {
            treeElem.innerHTML = '<span style="color: #ef4444;">Failed to load file tree.</span>';
        }
    }
}

// Handle File Tree Clicks (delegated)
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
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: 'Failed to read file' }));
            throw new Error(err.error || 'Failed to read file');
        }

        const data = await res.json();
        currentSelectedFile = filePath;

        // Switch to editor split view if currently in chat-only view
        if (currentViewMode !== 'split') {
            setViewMode('split');
        }

        // Update active highlight in file tree
        document.querySelectorAll('#fileTree .file-item').forEach(el => {
            if (el.getAttribute('data-path') === filePath) {
                el.classList.add('active');
            } else {
                el.classList.remove('active');
            }
        });

        // Populate editor
        editorFilePath.textContent = filePath;
        editorTextarea.value = data.content;
        editorTextarea.disabled = false;
        saveFileBtn.disabled = false;
        editorEmptyState.classList.add('hidden');
        editorTextarea.focus();
    } catch (err) {
        alert(`Error opening file "${filePath}": ${err.message}`);
    }
}

// Save File Functionality
async function saveCurrentFile() {
    if (!currentSelectedFile) return;

    const content = editorTextarea.value;
    saveFileBtn.disabled = true;
    saveFileBtn.textContent = 'Saving...';

    try {
        const res = await fetch('/api/file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file: currentSelectedFile, content })
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: 'Failed to save file' }));
            throw new Error(err.error || 'Failed to save file');
        }

        // Show saved indicator briefly
        editorStatusMsg.classList.add('show');
        setTimeout(() => {
            editorStatusMsg.classList.remove('show');
        }, 2000);
    } catch (err) {
        alert(`Error saving file: ${err.message}`);
    } finally {
        saveFileBtn.disabled = false;
        saveFileBtn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            Save
        `;
    }
}

saveFileBtn.addEventListener('click', saveCurrentFile);

// Save shortcut: Ctrl+S or Cmd+S inside editor
editorTextarea.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveCurrentFile();
    }
});

// Download Zip of all files
downloadZipBtn.addEventListener('click', () => {
    window.location.href = '/api/download-zip';
});

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
                <h3>Start an engineering task</h3>
                <p>Caesarion can run commands, inspect and write files, formulate plans, and autonomously solve problems in its workspace.</p>
            </div>
        `;
    }
}

// Reset Session
document.getElementById('resetBtn').addEventListener('click', async () => {
    if (!confirm("Are you sure you want to reset the session and wipe the workspace?")) return;
    try {
        await fetch('/api/reset', { method: 'POST' });
        document.getElementById('logs').innerHTML = '';
        showEmptyStateIfNeeded();
        await updateFileTree();
        alert("Session and workspace reset successfully.");
    } catch (e) {
        alert("Error resetting session: " + e.message);
    }
});

function logUserMessage(message) {
    removeEmptyState();
    const logsDiv = document.getElementById('logs');
    const p = document.createElement('div');
    p.className = 'user-msg';
    p.textContent = message;
    logsDiv.appendChild(p);
    logsDiv.scrollTop = logsDiv.scrollHeight;
}

let currentBackendCard = null;
let currentBackendBody = null;
let currentUserMsgDiv = null;
let modifiedFilesSet = new Set();

async function handleSendMessage() {
    const apiUrl = document.getElementById('apiUrl').value;
    const apiKey = document.getElementById('apiKey').value;
    const model = document.getElementById('model').value;
    const taskInput = document.getElementById('task');
    const task = taskInput.value.trim();
    const startBtn = document.getElementById('startBtn');

    if (!apiUrl || !apiKey || !model || !task) {
        alert("Please fill in all required fields (URL, API Key, Model, Task).");
        return;
    }

    logUserMessage(task);
    taskInput.value = ''; // clear input

    currentBackendCard = null;
    currentBackendBody = null;
    currentUserMsgDiv = null;
    modifiedFilesSet.clear();

    startBtn.disabled = true;
    startBtn.innerHTML = `
        <svg class="spinner" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1s linear infinite;"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>
        Running...
    `;

    // Start fast polling for UI updates
    treeInterval = setInterval(updateFileTree, 2000);

    const logsDiv = document.getElementById('logs');

    function ensureBackendCard() {
        if (!currentBackendCard) {
            removeEmptyState();
            currentBackendCard = createBackendCard([]);
            currentBackendBody = currentBackendCard.querySelector('.backend-body');
            logsDiv.appendChild(currentBackendCard);
            scrollChatToBottom(true);
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

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            let parts = buffer.split('\n\n');
            // The last part might be incomplete, so keep it in the buffer
            buffer = parts.pop();

            for (let eventStr of parts) {
                if (eventStr.startsWith('data: ')) {
                    try {
                        const event = JSON.parse(eventStr.substring(6));

                        if (event.type === 'tool_call' && event.tool === 'write_file' && event.args && event.args.filepath) {
                            modifiedFilesSet.add(event.args.filepath);
                        }

                        if (event.type === 'user_reply') {
                            removeEmptyState();
                            if (!currentUserMsgDiv) {
                                currentUserMsgDiv = document.createElement('div');
                                currentUserMsgDiv.className = 'agent-msg';
                                logsDiv.appendChild(currentUserMsgDiv);
                            }
                            // Typewriter for human user reply: 25ms per step
                            await typewriter.add(currentUserMsgDiv, event.message + '\n\n', 25, false);
                        } else if (event.type === 'backend_log' || event.type === 'tool_call' || event.type === 'tool_result' || event.type === 'iteration_start') {
                            const bBody = ensureBackendCard();
                            const line = (event.message || '') + '\n';
                            // Typewriter for backend: 2x speed (12ms)
                            await typewriter.add(bBody, line, 12, true);
                        } else if (event.type === 'turn_complete') {
                            if (event.modifiedFiles && Array.isArray(event.modifiedFiles)) {
                                event.modifiedFiles.forEach(f => modifiedFilesSet.add(f));
                            }
                        } else if (event.type === 'log') {
                            // Legacy log compatibility
                            const bBody = ensureBackendCard();
                            await typewriter.add(bBody, event.message + '\n', 12, true);
                        } else if (event.type === 'error') {
                            const bBody = ensureBackendCard();
                            await typewriter.add(bBody, `Error: ${event.message}\n`, 12, true);
                        }
                    } catch (e) {
                        console.error("Parse error", e, eventStr);
                    }
                }
            }
        }
    } catch (error) {
        const bBody = ensureBackendCard();
        await typewriter.add(bBody, `Fatal Error: ${error.message}\n`, 12, true);
    } finally {
        // Once iterations are done, collapse the backend card and update the summary tag
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
            // Collapse backend card
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
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            Send
        `;
        if (treeInterval) clearInterval(treeInterval);
        updateFileTree(); // Final sync
        scrollChatToBottom(true);
    }
}

document.getElementById('startBtn').addEventListener('click', handleSendMessage);

// Send message on Enter key (without Shift)
document.getElementById('task').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
    }
});
