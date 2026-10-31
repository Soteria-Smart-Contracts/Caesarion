// Load cached credentials on page load
document.addEventListener("DOMContentLoaded", () => {
    const cachedApiUrl = localStorage.getItem("caesarion_apiUrl");
    const cachedApiKey = localStorage.getItem("caesarion_apiKey");
    const cachedModel = localStorage.getItem("caesarion_model");

    if (cachedApiUrl) document.getElementById('apiUrl').value = cachedApiUrl;
    if (cachedApiKey) document.getElementById('apiKey').value = cachedApiKey;
    if (cachedModel) document.getElementById('model').value = cachedModel;

    updateFileTree();
});

// Modal Logic
const settingsModal = document.getElementById('settingsModal');
document.getElementById('settingsBtn').addEventListener('click', () => settingsModal.style.display = 'flex');
document.getElementById('closeSettings').addEventListener('click', () => {
    // Save to local storage cache on modal close
    localStorage.setItem("caesarion_apiUrl", document.getElementById('apiUrl').value);
    localStorage.setItem("caesarion_apiKey", document.getElementById('apiKey').value);
    localStorage.setItem("caesarion_model", document.getElementById('model').value);
    settingsModal.style.display = 'none';
});

// File Tree Polling
let treeInterval = null;
async function updateFileTree() {
    try {
        const res = await fetch('/api/files');
        const html = await res.text();
        document.getElementById('fileTree').innerHTML = html;
    } catch (e) {
        document.getElementById('fileTree').innerHTML = "Failed to load file tree.";
    }
}

// Reset Session
document.getElementById('resetBtn').addEventListener('click', async () => {
    if (!confirm("Are you sure you want to reset the session and wipe the workspace?")) return;
    try {
        await fetch('/api/reset', { method: 'POST' });
        document.getElementById('logs').innerHTML = '';
        await updateFileTree();
        alert("Session and workspace reset successfully.");
    } catch (e) {
        alert("Error resetting session: " + e.message);
    }
});

function logUserMessage(message) {
    const logsDiv = document.getElementById('logs');
    const p = document.createElement('div');
    p.className = 'user-msg';
    p.textContent = message;
    logsDiv.appendChild(p);
    logsDiv.scrollTop = logsDiv.scrollHeight;
}

let currentAgentMsgDiv = null;

function logAgentMessage(message) {
    const logsDiv = document.getElementById('logs');
    if (!currentAgentMsgDiv) {
        currentAgentMsgDiv = document.createElement('div');
        currentAgentMsgDiv.className = 'agent-msg';
        logsDiv.appendChild(currentAgentMsgDiv);
    }
    currentAgentMsgDiv.textContent += message + '\n';
    logsDiv.scrollTop = logsDiv.scrollHeight;
}

document.getElementById('startBtn').addEventListener('click', async () => {
    const apiUrl = document.getElementById('apiUrl').value;
    const apiKey = document.getElementById('apiKey').value;
    const model = document.getElementById('model').value;
    const taskInput = document.getElementById('task');
    const task = taskInput.value;
    const startBtn = document.getElementById('startBtn');

    if (!apiUrl || !apiKey || !model || !task) {
        alert("Please fill in all required fields (URL, API Key, Model, Task).");
        return;
    }

    logUserMessage(task);
    taskInput.value = ''; // clear input
    currentAgentMsgDiv = null; // start a new block for the agent's response

    startBtn.disabled = true;
    startBtn.textContent = "Running...";

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
        startBtn.textContent = "Send";
        if (treeInterval) clearInterval(treeInterval);
        updateFileTree(); // Final sync
    }
});
