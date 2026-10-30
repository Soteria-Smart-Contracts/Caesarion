# Caesarion

Caesarion is an autonomous software engineering agent, built as the successor to Jules. It is designed to connect to GitHub repositories, process tasks, and execute actions on codebases autonomously.

## Core Capabilities
- Executes bash commands for exploring code, running tests, and managing environments.
- Reads, writes, and manipulates files.
- Interacts with GitHub repositories (cloning, pull requests).
- Formulates execution plans and iterates through a thought-action-observation loop.

## Architecture
Caesarion consists of:
- **Agent**: The core loop that communicates with the LLM, processes thoughts, and calls tools.
- **LLM Interface**: Connects the agent to large language models.
- **Tools**: Pluggable capabilities such as file system access, bash execution, and GitHub integration.
