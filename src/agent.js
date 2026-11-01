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

Always separate what is intended for the backend execution process and what is intended for the human user:
- Backend thoughts, planning steps, and tool execution explanations should be written clearly before tool calls.
- When you are addressing the user directly (such as giving your final answer, status updates, or questions), prefix your user message with "To User:" or provide a clear conversational response.`;
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

        const maxIterations = 20;
        const modifiedFiles = new Set();
        let totalToolCalls = 0;

        yield {
            type: 'turn_start',
            message: 'Starting task execution...'
        };

        for (let i = 0; i < maxIterations; i++) {
            yield {
                type: 'iteration_start',
                iteration: i + 1,
                message: `--- Iteration ${i + 1} ---`
            };

            try {
                const message = await this.chatCompletion(this.messages, this.tools);

                const content = message.content;
                const toolCalls = message.tool_calls;

                if (content) {
                    // Check if content has "To User:" or is final message when no tool calls
                    const hasToolCalls = Array.isArray(toolCalls) && toolCalls.length > 0;
                    if (!hasToolCalls) {
                        // User-facing final reply
                        yield {
                            type: 'user_reply',
                            message: content
                        };
                    } else {
                        // Backend reasoning or thought before tool call
                        yield {
                            type: 'backend_log',
                            message: `Thought: ${content}`
                        };
                    }
                }

                // Add the assistant message to history
                const assistantMsg = { role: "assistant" };
                if (content) assistantMsg.content = content;
                if (toolCalls) assistantMsg.tool_calls = toolCalls;
                this.messages.push(assistantMsg);

                if (!toolCalls || toolCalls.length === 0) {
                    yield {
                        type: 'iteration_complete',
                        iteration: i + 1,
                        message: 'Iteration completed.'
                    };
                    break;
                }

                for (const toolCall of toolCalls) {
                    totalToolCalls++;
                    const functionName = toolCall.function.name;
                    const args = JSON.parse(toolCall.function.arguments || "{}");

                    if (functionName === 'write_file' && args.filepath) {
                        modifiedFiles.add(args.filepath);
                    }

                    yield {
                        type: 'tool_call',
                        tool: functionName,
                        args,
                        message: `Calling tool: ${functionName}(${JSON.stringify(args)})`
                    };

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

                    yield {
                        type: 'tool_result',
                        tool: functionName,
                        result: String(result),
                        message: `Tool Result: ${result}`
                    };

                    this.messages.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        name: functionName,
                        content: String(result)
                    });
                }

                yield {
                    type: 'iteration_complete',
                    iteration: i + 1,
                    message: `Completed iteration ${i + 1}.`
                };
            } catch (error) {
                yield {
                    type: 'error',
                    message: `Error during execution: ${error.message}`
                };
                break;
            }
        }

        yield {
            type: 'turn_complete',
            modifiedFiles: Array.from(modifiedFiles),
            totalToolCalls,
            message: '--- Task completed or waiting for user input ---'
        };
    }
}

module.exports = { Agent };
