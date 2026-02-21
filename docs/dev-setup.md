# Developer Setup Guide

This guide will help you set up the CodeRAG development environment on your local machine.

## Prerequisites

| Tool | Version | Required | Notes |
|---|---|---|---|
| Node.js | 22+ | Yes | Node 22 LTS (upgraded from original Node 20 target). Use [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm) for version management |
| pnpm | 9+ | Yes | Installed via corepack (bundled with Node.js) |
| Git | 2.30+ | Yes | |
| Ollama | latest | Optional | Required only for local embedding/enrichment features. See [Ollama Setup](ollama-setup.md) |

## Quick Start

### 1. Clone the Repository

```bash
git clone https://dev.azure.com/momc-pl/CodeRAG/_git/CodeRAG
cd CodeRAG
```

### 2. Set Node.js Version

If you use nvm:

```bash
nvm install
nvm use
```

If you use fnm:

```bash
fnm install
fnm use
```

Both tools will read the `.nvmrc` file and switch to Node.js 22.

### 3. Enable pnpm via Corepack

```bash
corepack enable
corepack prepare pnpm@9 --activate
```

### 4. Install Dependencies

```bash
pnpm install
```

### 5. Build

```bash
pnpm build
```

### 6. Run Tests

```bash
pnpm test
```

### 7. Lint

```bash
pnpm lint
```

## Project Structure

```
CodeRAG/
├── packages/
│   ├── core/           # Core library: indexing, embedding, search, enrichment
│   ├── cli/            # CLI interface for CodeRAG
│   ├── mcp-server/     # MCP server for IDE integration
│   └── benchmarks/     # Performance benchmarks and evaluation
├── docs/               # Documentation
│   ├── dev-setup.md    # This file
│   └── ollama-setup.md # Ollama installation & config guide
├── scripts/            # Utility scripts
│   └── verify-ollama.sh # Ollama setup verification
├── .claude/            # Claude Code agent configuration
├── azure-pipelines.yml # CI/CD pipeline definition
├── pnpm-workspace.yaml # pnpm workspace configuration
├── .nvmrc              # Node.js version specification
├── .editorconfig       # Editor configuration
└── .gitignore          # Git ignore rules
```

## Local Ollama Setup (Optional)

If you want to work with embedding or NL enrichment features locally, you need Ollama running with the required models. See the [Ollama Setup Guide](ollama-setup.md) for full instructions.

Quick version:

```bash
# Install (macOS)
brew install ollama

# Start the service
ollama serve

# Pull required models
ollama pull nomic-embed-text
ollama pull qwen2.5-coder:7b

# Verify setup
./scripts/verify-ollama.sh
```

## IDE Setup

### Visual Studio Code (Recommended)

#### Recommended Extensions

Install the following extensions for the best development experience:

- **ESLint** (`dbaeumer.vscode-eslint`) -- Linting integration
- **Prettier** (`esbenp.prettier-vscode`) -- Code formatting
- **EditorConfig** (`editorconfig.editorconfig`) -- Applies `.editorconfig` settings
- **TypeScript Importer** (`pmneo.tsimporter`) -- Auto-import for TypeScript

#### Workspace Settings

Create or update `.vscode/settings.json`:

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit"
  },
  "typescript.tsdk": "node_modules/typescript/lib"
}
```

### Other IDEs

Ensure your IDE supports:

- **EditorConfig** -- the `.editorconfig` file enforces consistent formatting
- **TypeScript** -- the project uses TypeScript throughout
- **ESLint** -- for linting feedback in the editor

## Common Tasks

| Task | Command |
|---|---|
| Install dependencies | `pnpm install` |
| Build all packages | `pnpm build` |
| Run tests | `pnpm test` |
| Lint code | `pnpm lint` |
| Format code | `pnpm format` |
| Clean build artifacts | `pnpm clean` |

## CI/CD Pipeline

The project uses Azure Pipelines for continuous integration. The pipeline runs automatically on:

- Pushes to `main`
- Pull requests targeting `main`

The pipeline executes: dependency installation, linting, testing, and building. See `azure-pipelines.yml` for the full configuration.

## Getting Help

- Check existing documentation in the `docs/` directory
- Review the backlog and project documentation in `CodeRAG_Backlog_i_Prompty.md`
- Contact the team lead for access or permissions issues
