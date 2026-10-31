const { read_file, write_file, list_files, file_system_tools } = require('./tools/file_system');
const { run_bash, bash_tools } = require('./tools/bash');

class Agent {
    constructor(apiUrl, apiKey, model) {
        this.apiUrl = apiUrl.replace(/\/+$/, '');
        this.apiKey = apiKey;
        this.model = model;
        this.messages = [];
        this.tools = [...file_system_tools, ...bash_tools];

        this.tool_functions = {
            read_file,
            write_file,
            list_files,
            run_bash
        };
    }

    setupSystemPrompt() {
        if (this.messages.length > 0 && this.messages[0].role === "system") {
            return; // System prompt already set
        }

        const systemPrompt = `You are Caesarion, an autonomous software engineering agent.
Your predecessor Jules created you. You are responsible for completing coding tasks by interacting with the file system and running bash commands.

You are running in a Virtual VM workspace. All file paths you provide to your tools are automatically relative to a writable workspace directory in /tmp. Use relative paths (e.g. 'src/index.js' or '.') when reading/writing/listing files, or running bash scripts.

You have access to a set of tools to read and write files and execute shell commands. Use them to explore the environment, plan your steps, and execute code changes.

Always write out the thought process before making a tool call.`;
        this.messages.unshift({ role: "system", content: systemPrompt });
    }

    async chatCompletion(messages, tools) {
        const url = `${this.apiUrl}/chat/completions`;
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
        };

        const body = {
            model: this.model,
            messages,
            temperature: 0.7,
        };

        if (tools && tools.length > 0) {
            body.tools = tools;
            body.tool_choice = "auto";
        }

        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`API Error ${response.status}: ${err}`);
        }

        const data = await response.json();
        return data.choices[0].message;
    }

    async *run(task) {
        this.setupSystemPrompt();
        this.messages.push({ role: "user", content: task });

        yield `Starting task: ${task}\n`;

        const maxIterations = 20;
        for (let i = 0; i < maxIterations; i++) {
            yield `\n--- Iteration ${i + 1} ---\n`;

            try {
                const message = await this.chatCompletion(this.messages, this.tools);

                const content = message.content;
                const toolCalls = message.tool_calls;

                if (content) {
                    yield `Caesarion: ${content}\n`;
                }

                // Add the assistant message to history
                const assistantMsg = { role: "assistant" };
                if (content) assistantMsg.content = content;
                if (toolCalls) assistantMsg.tool_calls = toolCalls;
                this.messages.push(assistantMsg);

                if (!toolCalls || toolCalls.length === 0) {
                    yield "Task complete or waiting for user.\n";
                    break;
                }

                for (const toolCall of toolCalls) {
                    const functionName = toolCall.function.name;
                    const args = JSON.parse(toolCall.function.arguments || "{}");

                    yield `Calling tool: ${functionName}(${JSON.stringify(args)})\n`;

                    const func = this.tool_functions[functionName];
                    let result;
                    if (func) {
                        try {
                            // Execute tool (could be async)
                            result = await Promise.resolve(func(args));
                        } catch (e) {
                            result = `Error: ${e.message}`;
                        }
                    } else {
                        result = `Error: Tool ${functionName} not found.`;
                    }

                    yield `Tool Result: ${result}\n`;

                    this.messages.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        name: functionName,
                        content: String(result)
                    });
                }
            } catch (error) {
                yield `Error during execution: ${error.message}\n`;
                break;
            }
        }
    }
}

module.exports = { Agent };
