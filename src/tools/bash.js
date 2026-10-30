const { execSync } = require('child_process');

function run_bash({ command }) {
    try {
        const output = execSync(command, { encoding: 'utf-8', timeout: 120000 });
        return output || "Command executed successfully with no output.";
    } catch (error) {
        let errStr = `Error executing command: ${error.message}`;
        if (error.stdout) errStr += `\nSTDOUT: ${error.stdout}`;
        if (error.stderr) errStr += `\nSTDERR: ${error.stderr}`;
        return errStr;
    }
}

const bash_tools = [
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

module.exports = { run_bash, bash_tools };
