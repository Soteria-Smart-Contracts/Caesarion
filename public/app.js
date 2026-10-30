document.getElementById('startBtn').addEventListener('click', async () => {
    const apiUrl = document.getElementById('apiUrl').value;
    const apiKey = document.getElementById('apiKey').value;
    const model = document.getElementById('model').value;
    const githubToken = document.getElementById('githubToken').value;
    const task = document.getElementById('task').value;
    const logsDiv = document.getElementById('logs');
    const startBtn = document.getElementById('startBtn');

    if (!apiUrl || !apiKey || !model || !task) {
        alert("Please fill in all required fields (URL, API Key, Model, Task).");
        return;
    }

    logsDiv.innerHTML = '';
    log("Starting task...");
    startBtn.disabled = true;

    try {
        const response = await fetch('/api/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiUrl, apiKey, model, githubToken, task })
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
                            log(data.message);
                        } else if (data.type === 'error') {
                            log(`Error: ${data.message}`);
                        }
                    } catch (e) {
                        console.error("Parse error", e, event);
                    }
                }
            }
        }
    } catch (error) {
        log(`Fatal Error: ${error.message}`);
    } finally {
        log("Task completed or connection closed.");
        startBtn.disabled = false;
    }

    function log(message) {
        const p = document.createElement('div');
        p.textContent = message;
        logsDiv.appendChild(p);
        logsDiv.scrollTop = logsDiv.scrollHeight;
    }
});
