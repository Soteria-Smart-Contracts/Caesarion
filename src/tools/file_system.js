const fs = require('fs');
const path = require('path');
const os = require('os');

// Virtual VM Workspace for serverless environments (like Vercel) where only /tmp is writable
const WORKSPACE = path.join(os.tmpdir(), 'caesarion_workspace');

// Ensure workspace exists
if (!fs.existsSync(WORKSPACE)) {
    fs.mkdirSync(WORKSPACE, { recursive: true });
}

function resolvePath(p) {
    if (path.isAbsolute(p)) return p;
    return path.join(WORKSPACE, p);
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

function get_workspace_tree(dir = WORKSPACE, prefix = '') {
    if (!fs.existsSync(dir)) return "Workspace is empty.";

    let result = '';
    const files = fs.readdirSync(dir);

    files.forEach((file, index) => {
        const fullPath = path.join(dir, file);
        const isLast = index === files.length - 1;
        const stat = fs.statSync(fullPath);

        const marker = isLast ? '└── ' : '├── ';

        if (stat.isDirectory()) {
            result += `${prefix}${marker}${file}\n`;
            const nextPrefix = prefix + (isLast ? '    ' : '│   ');
            result += get_workspace_tree(fullPath, nextPrefix);
        } else {
            const relPath = path.relative(WORKSPACE, fullPath);
            const escapedPath = relPath.replace(/"/g, '&quot;');
            const fileItem = `<a href="#" class="file-item" data-path="${escapedPath}">${file}</a>`;
            result += `${prefix}${marker}${fileItem}\n`;
        }
    });

    return result || "(empty directory)";
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

module.exports = { read_file, write_file, list_files, file_system_tools, get_workspace_tree };
