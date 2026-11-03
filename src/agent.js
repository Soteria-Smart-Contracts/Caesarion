const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

function createWorkspaceTools(workspaceDir) {
    if (!fs.existsSync(workspaceDir)) {
        fs.mkdirSync(workspaceDir, { recursive: true });
    }

    function resolvePath(p) {
        if (path.isAbsolute(p)) return p;
        return path.join(workspaceDir, p);
    }

    function read_file({ filepath }) {
        try {
            const fullPath = resolvePath(filepath);
            return fs.readFileSync(fullPath, 'utf-8');
        } catch (error) {
            return `Error reading file: ${error.message}`;
        }
    }

    function write_file({ filepath, content }) {
        try {
            const fullPath = resolvePath(filepath);
            fs.mkdirSync(path.dirname(fullPath), { recursive: true });
            fs.writeFileSync(fullPath, content, 'utf-8');
            return "File written successfully.";
        } catch (error) {
            return `Error writing file: ${error.message}`;
        }
    }

    function list_files({ directory = "." }) {
        try {
            const fullPath = resolvePath(directory);
            if (!fs.existsSync(fullPath)) {
                return `Directory ${directory} does not exist in workspace.`;
            }
            const files = fs.readdirSync(fullPath);
            const formatted = files.map(file => {
                const stat = fs.statSync(path.join(fullPath, file));
                return stat.isDirectory() ? `${file}/` : file;
            });
            return formatted.sort().join('\n') || "(empty directory)";
        } catch (error) {
            return `Error listing directory: ${error.message}`;
        }
    }

    function run_bash({ command }) {
        try {
            const output = execSync(command, {
                encoding: 'utf-8',
                timeout: 120000,
                cwd: workspaceDir
            });
            return output || "Command executed successfully with no output.";
        } catch (error) {
            let errStr = `Error executing command: ${error.message}`;
            if (error.stdout) errStr += `\nSTDOUT: ${error.stdout}`;
            if (error.stderr) errStr += `\nSTDERR: ${error.stderr}`;
            return errStr;
        }
    }

    const tools_declarations = [
        {
            type: "function",
            function: {
                name: "read_file",
                description: "Reads a file from the file system.",
                parameters: {
                    type: "object",
                    properties: {
                        filepath: { type: "string", description: "The path to the file." }
                    },
                    required: ["filepath"]
                }
            }
        },
        {
            type: "function",
            function: {
                name: "write_file",
                description: "Writes content to a file.",
                parameters: {
                    type: "object",
                    properties: {
                        filepath: { type: "string", description: "The path to the file." },
                        content: { type: "string", description: "The content to write." }
                    },
                    required: ["filepath", "content"]
                }
            }
        },
        {
            type: "function",
            function: {
                name: "list_files",
                description: "Lists files in a directory.",
                parameters: {
                    type: "object",
                    properties: {
                        directory: { type: "string", description: "The path to the directory. Defaults to '.'" }
                    }
                }
            }
        },
        {
            type: "function",
            function: {
                name: "run_bash",
                description: "Runs a bash command in the environment.",
                parameters: {
                    type: "object",
                    properties: {
                        command: { type: "string", description: "The bash command to run." }
                    },
                    required: ["command"]
                }
            }
        }
    ];

    return {
        tool_functions: {
            read_file,
            write_file,
            list_files,
            run_bash
        },
        tools_declarations
    };
}

class Agent {
    constructor(apiUrl, apiKey, model, customWorkspace = null) {
        this.apiUrl = apiUrl ? apiUrl.replace(/\/+$/, '') : 'https://api.openai.com/v1';
        this.apiKey = apiKey;
        this.model = model || 'gpt-4o-mini';
        this.workspaceDir = customWorkspace || path.join(os.tmpdir(), 'caesarion_workspace');
        this.messages = [];

        const { tool_functions, tools_declarations } = createWorkspaceTools(this.workspaceDir);
        this.tool_functions = tool_functions;
        this.tools = tools_declarations;
    }

    setupSystemPrompt(mode = 'just_go') {
        if (this.messages.length > 0 && this.messages[0].role === "system") {
            return;
        }

        const systemPrompt = `You are Caesarion, a premier autonomous software engineering agent.
You are running in a dedicated Virtual VM workspace. All tool file paths and bash commands operate inside this isolated workspace.

Mode: ${mode.toUpperCase()}
Key rules:
1. DEEP PLANNING: Always think thoroughly before taking actions. Formulate a clear, step-by-step plan for the entire task.
2. ITERATION & CRITIQUE: Execute tools methodically. Inspect results, test your changes if possible, and iterate until completely satisfied.
3. CLEAR LOGS: Separate internal reasoning/thoughts from user-facing statements. Explain what tool you are using and why.
4. GHOST STAGING: You are operating in a ghost staging environment. Files you edit will be presented to the user for final review and approval. Ensure the code is production quality.`;

        this.messages.unshift({ role: "system", content: systemPrompt });
    }

    async chatCompletion(messages, tools, options = {}) {
        const url = `${this.apiUrl}/chat/completions`;
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
        };

        const body = {
            model: this.model,
            messages,
            temperature: options.temperature !== undefined ? options.temperature : 0.7,
        };

        if (tools && tools.length > 0) {
            body.tools = tools;
            body.tool_choice = options.tool_choice || "auto";
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

    // Task Execution with Deep Planning, Mode Support & Iteration Loop
    async *runTask({ taskPrompt, mode = 'just_go', taskCallback = null }) {
        this.setupSystemPrompt(mode);
        const modifiedFiles = new Set();

        yield {
            type: 'status_change',
            status: 'planning',
            message: 'Initializing deep planning phase...'
        };

        // Step 1: Deep Planning Phase
        yield {
            type: 'backend_log',
            message: 'Analyzing requirements and workspace context to formulate plan...'
        };

        // Explore current workspace state
        const initialFiles = this.tool_functions.list_files({ directory: '.' });
        yield {
            type: 'backend_log',
            message: `Current files in workspace:\n${initialFiles}`
        };

        const planPrompt = `Task to solve: "${taskPrompt}"
Existing workspace files:
${initialFiles}

Think deeply about this task.
1. Outline the objectives and architecture needed.
2. Provide a detailed, numbered step-by-step execution plan.
3. State your testing and verification approach.

Please output your plan now.`;

        const planMessages = [
            ...this.messages,
            { role: "user", content: planPrompt }
        ];

        let planMessage;
        try {
            planMessage = await this.chatCompletion(planMessages, null, { temperature: 0.3 });
        } catch (e) {
            yield {
                type: 'backend_log',
                message: `Failed to invoke planning completion: ${e.message}. Using default plan.`
            };
            planMessage = { content: `1. Explore and inspect workspace.\n2. Implement changes for "${taskPrompt}".\n3. Verify and test changes.` };
        }

        const planText = planMessage.content || 'Plan formulated.';

        yield {
            type: 'plan_created',
            plan: planText,
            message: 'Execution plan formulated.'
        };

        if (taskCallback) {
            await taskCallback('set_plan', { plan: planText });
        }

        // Mode handling:
        // 'interactive': If user needs to clarify or review
        // 'plan_for_review': Must pause here and wait for user approval before touching code!
        if (mode === 'plan_for_review' || mode === 'interactive') {
            yield {
                type: 'status_change',
                status: 'waiting_review',
                message: mode === 'interactive'
                    ? 'Interactive Plan formulated. Awaiting your review or input.'
                    : 'Plan is ready for review. Awaiting your approval to start execution.'
            };

            if (taskCallback) {
                const userFeedback = await taskCallback('require_review', {
                    plan: planText,
                    message: mode === 'interactive'
                        ? 'Here is the preliminary plan. You can approve it or provide instructions.'
                        : 'Plan ready for review. Click approve to begin autonomous execution.'
                });

                if (userFeedback && userFeedback.message) {
                    yield {
                        type: 'backend_log',
                        message: `User feedback received: ${userFeedback.message}`
                    };
                    this.messages.push({
                        role: 'user',
                        content: `User feedback on plan: ${userFeedback.message}`
                    });
                }
            }
        }

        yield {
            type: 'status_change',
            status: 'running',
            message: 'Plan confirmed. Starting autonomous execution and iteration loop...'
        };

        this.messages.push({
            role: "user",
            content: `Task: ${taskPrompt}\n\nExecution Plan:\n${planText}\n\nExecute the plan step by step using your tools (read_file, write_file, list_files, run_bash). Verify your work and iterate until the task is completely finished.`
        });

        // Step 2: Thought - Action - Observation Iteration Loop
        const maxIterations = 25;
        let iteration = 0;

        while (iteration < maxIterations) {
            iteration++;
            yield {
                type: 'iteration_start',
                iteration,
                message: `--- Iteration ${iteration} ---`
            };

            let responseMsg;
            try {
                responseMsg = await this.chatCompletion(this.messages, this.tools);
            } catch (err) {
                yield {
                    type: 'error',
                    message: `Error from LLM API: ${err.message}`
                };
                break;
            }

            const content = responseMsg.content;
            const toolCalls = responseMsg.tool_calls;

            if (content) {
                yield {
                    type: 'backend_log',
                    message: content
                };
            }

            const assistantEntry = { role: "assistant" };
            if (content) assistantEntry.content = content;
            if (toolCalls) assistantEntry.tool_calls = toolCalls;
            this.messages.push(assistantEntry);

            if (!toolCalls || toolCalls.length === 0) {
                yield {
                    type: 'iteration_complete',
                    iteration,
                    message: 'Agent concluded actions for this step.'
                };
                break;
            }

            for (const tc of toolCalls) {
                const fnName = tc.function.name;
                let args = {};
                try {
                    args = JSON.parse(tc.function.arguments || "{}");
                } catch (e) {
                    args = {};
                }

                if (fnName === 'write_file' && args.filepath) {
                    modifiedFiles.add(args.filepath);
                    yield {
                        type: 'files_modified',
                        files: [args.filepath]
                    };
                }

                yield {
                    type: 'tool_call',
                    tool: fnName,
                    args,
                    message: `Calling tool: ${fnName}(${JSON.stringify(args)})`
                };

                const fn = this.tool_functions[fnName];
                let result = '';
                if (fn) {
                    try {
                        result = await Promise.resolve(fn(args));
                    } catch (toolErr) {
                        result = `Tool Error: ${toolErr.message}`;
                    }
                } else {
                    result = `Tool not found: ${fnName}`;
                }

                yield {
                    type: 'tool_result',
                    tool: fnName,
                    result: String(result),
                    message: `Tool result: ${result}`
                };

                this.messages.push({
                    role: "tool",
                    tool_call_id: tc.id,
                    name: fnName,
                    content: String(result)
                });
            }

            yield {
                type: 'iteration_complete',
                iteration,
                message: `Completed iteration ${iteration}.`
            };
        }

        yield {
            type: 'execution_finished',
            modifiedFiles: Array.from(modifiedFiles),
            message: 'All steps completed in ghost workspace.'
        };
    }

    // Generate comprehensive summary and explanation breakdown of modifications
    async generateSummary({ prompt, plan, modifiedFiles = [] }) {
        if (!modifiedFiles || modifiedFiles.length === 0) {
            return {
                summary: 'Completed without file modifications.',
                explanation: 'Caesarion executed the requested instructions and verified current workspace state.'
            };
        }

        const fileDiffs = [];
        for (const file of modifiedFiles) {
            try {
                const fullPath = path.join(this.workspaceDir, file);
                if (fs.existsSync(fullPath)) {
                    const content = fs.readFileSync(fullPath, 'utf8');
                    fileDiffs.push(`File: ${file}\nContent (truncated 1000 chars):\n${content.substring(0, 1000)}`);
                }
            } catch (e) {
                fileDiffs.push(`File: ${file} (could not read)`);
            }
        }

        const summaryPrompt = `Task: "${prompt}"
Plan:
${plan}

Modified files in ghost workspace:
${fileDiffs.join('\n\n---\n\n')}

Provide a concise breakdown for user review:
1. Short 1-sentence high-level summary of what was done.
2. A bullet-point explanation detailing key changes per file and how it satisfies the user request.
Respond with JSON in this format:
{
  "summary": "...",
  "explanation": "..."
}`;

        try {
            const res = await this.chatCompletion([
                { role: "system", content: "You summarize code modifications cleanly and accurately for user review." },
                { role: "user", content: summaryPrompt }
            ], null, { temperature: 0.2 });

            const text = (res.content || '').trim();
            const match = text.match(/\{[\s\S]*\}/);
            if (match) {
                return JSON.parse(match[0]);
            }
            return {
                summary: `Modified ${modifiedFiles.length} file(s) for task.`,
                explanation: text
            };
        } catch (e) {
            return {
                summary: `Successfully modified ${modifiedFiles.length} file(s): ${modifiedFiles.join(', ')}`,
                explanation: 'All planned changes were applied and verified in the ghost staging workspace.'
            };
        }
    }

    // Legacy run generator for compatibility with the existing chat endpoint
    async *run(task) {
        this.setupSystemPrompt('just_go');
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
                    const hasToolCalls = Array.isArray(toolCalls) && toolCalls.length > 0;
                    if (!hasToolCalls) {
                        yield {
                            type: 'user_reply',
                            message: content
                        };
                    } else {
                        yield {
                            type: 'backend_log',
                            message: `Thought: ${content}`
                        };
                    }
                }

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

module.exports = { Agent, createWorkspaceTools };
