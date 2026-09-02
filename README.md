# Minfy IDE

A browser-first intelligent development environment built for local-first software engineering.

## Architecture

```
minfy-ide/
├── apps/
│   ├── runtime/       # Node.js local runtime & WebSocket terminal server (bound to 127.0.0.1)
│   └── web/           # React + Monaco Editor + xterm.js Web IDE UI
├── packages/
│   └── shared/        # Shared TypeScript types & API definitions
├── cli/               # `minfy` CLI executable
├── sample-project/    # Sample workspace for manual verification
├── package.json
└── README.md
```

## Getting Started

### 1. Installation & Build

```bash
npm install
npm run build
npm link --workspace=@minfy/cli
```

### 2. Launching Minfy IDE

Navigate to any local project and run:

```bash
cd /path/to/my-project
minfy .
```

Or open a specific path:

```bash
minfy C:\projects\my-app
```

The Minfy local runtime starts automatically on `http://127.0.0.1:4560` and opens your default browser with the active workspace loaded.

## Milestone 1 Features

- **Explorer**: Lazy-loaded directory tree, folder expansion/collapse, file icons, and inline file/folder creation.
- **Code Editor**: Monaco Editor integration with syntax detection, dirty indicator (`●`), and `Ctrl+S` / `Cmd+S` keyboard shortcuts.
- **Integrated Terminal**: Live terminal sessions via WebSocket streaming (`xterm.js`) executing with `cwd` set strictly to the active workspace root.
- **Path Security**: All filesystem operations are validated to prevent directory traversal outside the workspace boundary.
- **Binary & Large File Protection**: Detects binary files and limits files above 2MB from freezing the browser.

## Running Tests

```bash
npm test
```
