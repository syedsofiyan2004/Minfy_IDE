# Minfy IDE

A browser-first, local-first intelligent development environment with native enterprise AI capacity, Monaco Editor, integrated terminal, Git source control, and project intelligence.

---

## Architecture Overview

```
Minfy_IDE/
├── apps/
│   ├── runtime/       # Node.js local daemon (Express + WebSocket terminal server bound to 127.0.0.1:4560)
│   └── web/           # React + Monaco Editor + xterm.js production frontend
├── packages/
│   └── shared/        # Universal TypeScript types, API contracts & pure state helpers
├── cli/               # Global `minfy` executable CLI binary
├── package.json       # Root monorepo orchestrator with sequential build order
└── README.md
```

---

## Prerequisites

- **Node.js**: `v20.0.0` or later (tested on Node v20, v22, v26)
- **npm**: `v10.0.0` or later
- **Operating System**: Windows 10/11, macOS, or Linux
- **Optional Tools**:
  - `git`: For built-in Git working tree and source control tracking
  - `ollama`: For local offline inference
  - `@openai/codex`: For official OpenAI Codex App Server subscription integration
  - AWS CLI / IAM credentials: For AWS Bedrock foundation models

---

## Installation

Clone the repository and install all workspace dependencies from the root:

```bash
git clone https://github.com/syedsofiyan2004/Minfy_IDE.git
cd Minfy_IDE
npm install
```

---

## Build

Compile all packages and apps in strict dependency order (`@minfy/shared` → `@minfy/runtime` → `@minfy/web` → `@minfy/cli`):

```bash
npm run build
```

Link the CLI globally onto your system PATH:

```bash
npm link
```

*(On Windows, if a previous link exists, use `npm link --force`)*

---

## Run Minfy Locally

Leave the Minfy IDE repository, navigate to any real project directory on your machine, and launch Minfy:

```bash
cd C:\Projects\my-project
minfy .
```

Or target any directory path directly:

```bash
minfy C:\Projects\my-project
```

### What happens automatically:
1. **Runtime Verification**: The CLI inspects `127.0.0.1:4560`. If not running, it starts the background Minfy runtime daemon.
2. **Authentication**: Generates a cryptographic capability token stored in `~/.minfy/runtime-state.json`.
3. **Workspace Registration**: Authenticates with the runtime to securely register the selected folder as the active workspace.
4. **Browser Launch**: Automatically opens your default browser at `http://127.0.0.1:4560/?workspaceId=<id>#runtimeToken=<token>`.
5. **URL Sanitization**: The frontend immediately consumes the token from the URL hash fragment into `sessionStorage` and scrubs the URL bar.

---

## Development Mode

To run live development services with hot reloading:

```bash
# Terminal 1: Run runtime daemon with tsx watcher
npm run dev:runtime

# Terminal 2: Run Vite frontend development server
npm run dev:web
```

---

## Testing

Run the automated unit and packaging integration test suite:

```bash
npm test
```

Currently passes **180 automated tests across 33 test suites**.

---

## AI Providers

Minfy IDE provides native multi-provider AI capacity with no hard vendor lock-in:

| Provider | Type | Description |
| :--- | :--- | :--- |
| **Ollama** | Local | Offline local models (e.g. `llama3.2`, `qwen2.5-coder`). Gracefully shows offline if Ollama is not running. |
| **OpenRouter** | Cloud | 300+ models with bearer-auth key stored in OS Credential Store (Windows DPAPI / macOS Keychain / Linux Secret Service). |
| **AWS Bedrock** | Cloud | Native AWS ConverseStream SDK integration with IAM profiles, STS role assumption, inference profiles, and GovCloud support. |
| **OpenAI Codex** | Subscription | Official local Codex App Server integration with ChatGPT Account authorization (`initialize` → `account/read` protocol). Starts lazily only when selected. |
| **Custom Providers** | Custom | Any OpenAI-compatible endpoint defined via declarative JSON manifest in `~/.minfy/providers/`. |

---

## Troubleshooting & Diagnostics

### Run Environment Doctor
Inspect runtime status, port availability, web assets, and CLI presence:

```bash
minfy doctor
```

### Restart Runtime Daemon
To terminate a running runtime instance and start fresh:

```bash
minfy --restart-runtime
```

### Port Conflict Protection
If port `4560` is occupied by another process, Minfy will **never** forcefully terminate unknown processes. Either stop the conflicting process or run `minfy --restart-runtime` if it was an earlier Minfy process.

---

## Security Guarantees

- **Workspace Sandboxing**: Strict realpath resolution prevents path traversal (`..` escape) or deletion of root.
- **Localhost Defense**: Validates both `Host` and `Origin` headers to protect against DNS rebinding and cross-origin attacks.
- **Single-Use Terminal Tickets**: Integrated terminal WebSockets require short-lived, single-use cryptographic tickets.
- **Privacy Boundary**: Token, credential, and AWS account identity metadata are strictly isolated and never exposed in browser URLs, query parameters, or console output.
