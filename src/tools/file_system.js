const fs = require('fs');
const path = require('path');

function read_file({ filepath }) {
    try {
        return fs.readFileSync(filepath, 'utf-8');
    } catch (error) {
        return `Error reading file: ${error.message}`;
    }
}

function write_file({ filepath, content }) {
    try {
        fs.mkdirSync(path.dirname(filepath), { recursive: true });
        fs.writeFileSync(filepath, content, 'utf-8');
        return "File written successfully.";
    } catch (error) {
        return `Error writing file: ${error.message}`;
    }
}

function list_files({ directory = "." }) {
    try {
        const files = fs.readdirSync(directory);
        const formatted = files.map(file => {
            const stat = fs.statSync(path.join(directory, file));
            return stat.isDirectory() ? `${file}/` : file;
        });
        return formatted.sort().join('\n');
    } catch (error) {
        return `Error listing directory: ${error.message}`;
    }
}

const file_system_tools = [
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
    }
];

module.exports = { read_file, write_file, list_files, file_system_tools };
