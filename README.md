# Caesarion

Caesarion is an autonomous software engineering agent, built as the successor to Jules. It is built entirely in Node.js and Vanilla JavaScript, avoiding heavy frameworks or Python dependencies. It is fully serverless-compatible, executing tasks in a Virtual VM workspace.

## Core Capabilities
- Executes bash commands for exploring code, running tests, and managing environments in a secure `/tmp` workspace.
- Reads, writes, and manipulates files in a localized Virtual VM workspace.
- Formulates execution plans and iterates through a thought-action-observation loop natively supporting OpenAI-compatible tool calling.

## Architecture
Caesarion consists of:
- **Agent Loop (`src/agent.js`)**: The core loop that communicates with the LLM via native fetch, processes thoughts, and executes local tools.
- **Tools (`src/tools/`)**: Pluggable JavaScript modules for file system access and bash execution, constrained to a Virtual VM workspace (`os.tmpdir()`).
- **Backend Server (`server.js`)**: A custom HTTP server that handles static file serving securely and proxies agent logs back to the frontend using Server-Sent Events (SSE).
- **Frontend (`public/`)**: A vanilla HTML/JS interface for inputting credentials, configuring the LLM, caching API details locally, and streaming agent execution logs.

## Getting Started
1. Run `npm init -y` (if package.json is missing dependencies, though none are required outside core Node.js).
2. Start the server: `node server.js`
3. Open `http://localhost:3000` in your browser.
