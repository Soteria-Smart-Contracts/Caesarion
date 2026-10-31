// Load cached credentials and restore chat history on page load
document.addEventListener("DOMContentLoaded", async () => {
    const cachedApiUrl = localStorage.getItem("caesarion_apiUrl");
    const cachedApiKey = localStorage.getItem("caesarion_apiKey");
    const cachedModel = localStorage.getItem("caesarion_model");

    if (cachedApiUrl) document.getElementById('apiUrl').value = cachedApiUrl;
    if (cachedApiKey) document.getElementById('apiKey').value = cachedApiKey;
    if (cachedModel) document.getElementById('model').value = cachedModel;

    await loadChatHistory();
    updateFileTree();
});

function renderChatMessages(history) {
    if (!history || history.length === 0) {
        showEmptyStateIfNeeded();
        return;
    }
    removeEmptyState();
    const logsDiv = document.getElementById('logs');
    logsDiv.innerHTML = '';
    for (const item of history) {
        if (item.role === 'user') {
            const p = document.createElement('div');
            p.className = 'user-msg';
            p.textContent = item.content;
            logsDiv.appendChild(p);
        } else if (item.role === 'agent') {
            const div = document.createElement('div');
            div.className = 'agent-msg';
            div.textContent = item.content;
            logsDiv.appendChild(div);
        }
    }
    logsDiv.scrollTop = logsDiv.scrollHeight;
}

async function loadChatHistory() {
    // 1. Instantly restore from localStorage cache if present to prevent any flash or race on reload
    const cachedHistoryStr = localStorage.getItem("caesarion_chat_history");
    if (cachedHistoryStr) {
        try {
            const cachedHistory = JSON.parse(cachedHistoryStr);
            if (Array.isArray(cachedHistory) && cachedHistory.length > 0) {
                renderChatMessages(cachedHistory);
            }
        } catch (e) {
            console.error("Error reading cached history:", e);
        }
    }

    // 2. Fetch authoritative chat history from server
    try {
        const res = await fetch('/api/history');
        if (!res.ok) return;
        const data = await res.json();
        if (data.history && data.history.length > 0) {
            localStorage.setItem("caesarion_chat_history", JSON.stringify(data.history));
            renderChatMessages(data.history);
        } else if (!cachedHistoryStr) {
            showEmptyStateIfNeeded();
        }
    } catch (e) {
        console.error("Failed to load chat history from server:", e);
    }
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

// File Tree Polling
let treeInterval = null;
async function updateFileTree() {
    try {
        const res = await fetch('/api/files');
        const html = await res.text();
        const treeElem = document.getElementById('fileTree');
        if (treeElem) {
            treeElem.innerHTML = html;
        }
    } catch (e) {
        const treeElem = document.getElementById('fileTree');
        if (treeElem) {
            treeElem.innerHTML = '<span style="color: #ef4444;">Failed to load file tree.</span>';
        }
    }
}

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
        localStorage.removeItem("caesarion_chat_history");
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

let currentAgentMsgDiv = null;

function logAgentMessage(message) {
    removeEmptyState();
    const logsDiv = document.getElementById('logs');
    if (!currentAgentMsgDiv) {
        currentAgentMsgDiv = document.createElement('div');
        currentAgentMsgDiv.className = 'agent-msg';
        logsDiv.appendChild(currentAgentMsgDiv);
    }
    currentAgentMsgDiv.textContent += message + '\n';
    logsDiv.scrollTop = logsDiv.scrollHeight;
}

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
    currentAgentMsgDiv = null; // start a new block for the agent's response

    startBtn.disabled = true;
    startBtn.innerHTML = `
        <svg class="spinner" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1s linear infinite;"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>
        Running...
    `;

    // Start fast polling for UI updates
    treeInterval = setInterval(updateFileTree, 2000);

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

            for (let event of parts) {
                if (event.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(event.substring(6));
                        if (data.type === 'log') {
                            logAgentMessage(data.message);
                        } else if (data.type === 'error') {
                            logAgentMessage(`Error: ${data.message}`);
                        }
                    } catch (e) {
                        console.error("Parse error", e, event);
                    }
                }
            }
        }
    } catch (error) {
        logAgentMessage(`Fatal Error: ${error.message}`);
    } finally {
        logAgentMessage("--- Task completed or waiting for user input ---");
        currentAgentMsgDiv = null; // reset for next interaction
        startBtn.disabled = false;
        startBtn.innerHTML = `
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            Send
        `;
        if (treeInterval) clearInterval(treeInterval);
        // Sync chat history from server and update local cache
        try {
            const histRes = await fetch('/api/history');
            if (histRes.ok) {
                const histData = await histRes.json();
                if (histData.history) {
                    localStorage.setItem("caesarion_chat_history", JSON.stringify(histData.history));
                }
            }
        } catch (_) {}
        updateFileTree(); // Final sync
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
