# 🌱 seedling

**AI-powered GitHub issue generator and syncer** – turn your implementation plans and specs into trackable issues, automatically.

[![npm version](https://img.shields.io/npm/v/@elcoosp-ai/seedling.svg)](https://www.npmjs.com/package/@elcoosp-ai/seedling)
[![CI](https://github.com/elcoosp/elcoosp-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/elcoosp/elcoosp-ai/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

Seedling is a command‑line tool that helps you **generate GitHub issues from your project documentation** and **keep them in sync** as your plans evolve. It uses an LLM to break down an implementation plan into discrete, actionable issues, and then syncs those issues to GitHub – all while maintaining a local, version‑controllable representation of your issues as markdown files.

Seedling is designed for teams and individuals who want to treat their issue tracking as code. By keeping issues in markdown alongside your specs, you can review, edit, and version them just like any other source file.

## ✨ Features

- **🤖 AI‑powered generation** – Feed it your implementation plan and related specification documents; an LLM breaks them down into well‑structured issues with titles, descriptions, labels, and even assignees.
- **📝 Issues as code** – Each issue becomes a markdown file with YAML frontmatter, stored in your repository. Review, edit, and version them like any other code.
- **🔄 Idempotent sync** – The `sync` command creates, updates, or closes GitHub issues based on changes to your markdown files. A mapping file ensures no duplicates and that only changed files are synced.
- **🏷️ Smart labeling & assignment** – The LLM can suggest relevant labels (e.g., "backend", "frontend", "must", "should"). If you provide a team roster in your config, it will assign issues to the right people based on their role and expertise.
- **🔗 Traceability** – Generated issues include links back to the original spec sections, so you always know where a task came from.
- **🛡️ Resilient generation** – Issues are saved incrementally as they are generated. If a step fails (e.g., due to a quota limit or transient error), partial progress is preserved. Permanent errors (like session limits) abort the process immediately without useless retries.

## 📦 Installation

You can either install the package globally, or run it directly without installation using `npx`/`pnpx`.

```bash
# Install globally with npm
npm install -g @elcoosp-ai/seedling

# Install globally with pnpm
pnpm add -g @elcoosp-ai/seedling

# Run without installation (any of these)
npx @elcoosp-ai/seedling --help
pnpx @elcoosp-ai/seedling --help
```

## 🚀 Usage

After global installation, you can use the `seedling` command directly. If you prefer not to install, replace `seedling` in the examples below with `npx @elcoosp-ai/seedling` or `pnpx @elcoosp-ai/seedling`.

### Generate issues from a plan

```bash
# If installed globally
seedling gen [options]

# Without installation
pnpx @elcoosp-ai/seedling gen [options]
```

**Options:**

- `--plan <path>` – path to your implementation plan (markdown). If omitted, the path must be provided in the config file as `planPath`.
- `--specs <dir>` – directory containing specification documents (e.g., `archi.md`, `srs.md`). If omitted, the value from config (`specsDir`) or `./specs` will be used.
- `--out <dir>` – output directory for the generated issue files. If omitted, the value from config (`issuesDir`) or `./issues` will be used.
- `--config <path>` – path to a config file (default `./seedling.config.json`).
- `--model <model>` – LLM model to use (default from config or `glm-5:cloud`).
- `--temperature <number>` – LLM temperature (default from config or `0.2`).

**Example with all flags:**

```bash
seedling gen --plan ./docs/plan.md --specs ./docs/specs --out ./generated-issues
```

**Example using only config (no flags):**

```bash
seedling gen
```

If you are using a cloud‑based model (e.g., `glm-5:cloud`), you must set the `OLLAMA_API_KEY` environment variable to your API key. For local models (like `llama3.2`), no API key is required. You can set it in your terminal:

```bash
export OLLAMA_API_KEY=your-api-key-here
```

Or create a `.env` file in your project root with `OLLAMA_API_KEY=your-key`.

### Sync issues to GitHub

```bash
# Set your GitHub token (recommended)
export GITHUB_TOKEN=ghp_abc123

# Or create a .env file in your project root:
# GITHUB_TOKEN=ghp_abc123

# If installed globally
seedling sync --repo owner/repo [options]

# Without installation
pnpx @elcoosp-ai/seedling sync --repo owner/repo [options]
```

**Options:**

- `--repo` – repository in the format `owner/repo` **(required)**.
- `-t, --token <token>` – GitHub token (optional if `GITHUB_TOKEN` environment variable is set).
- `--dir <dir>` – directory containing issue markdown files (default `./issues`).
- `--mapping <file>` – path to the mapping file (default `./issues-mapping.json`).
- `--dry-run` – preview changes without actually calling the GitHub API.

**Example:**

```bash
seedling sync --repo elcoosp/skilldeck --dir ./docs/issues
```

You can store your GitHub token in a `.env` file to avoid typing it each time. The token is read from the environment, so it never appears in your command history.

## ⚙️ Configuration

Seedling can be configured via a `seedling.config.json` file in your project root. All options are optional, and command‑line flags override their corresponding config values.

```json
{
  "planPath": "./docs/plan.md",
  "specsDir": "./docs/specs",
  "issuesDir": "./docs/issues",
  "mappingFile": "./.issues-mapping.json",
  "github": {
    "owner": "myorg",
    "repo": "myrepo"
  },
  "llm": {
    "model": "gpt-4-turbo",
    "temperature": 0.2
  },
  "assignees": [
    {
      "username": "alice-dev",
      "role": "backend",
      "expertise": ["rust", "api"]
    },
    {
      "username": "bob-ui",
      "role": "frontend",
      "expertise": ["react", "typescript"]
    }
  ]
}
```

- `planPath` – default implementation plan path (used when `--plan` is not supplied).
- `specsDir` – default specs directory.
- `issuesDir` – default output directory for generated issues.
- `mappingFile` – default mapping file for sync.
- `github` – default repository owner/name (can be overridden by CLI flags).
- `llm` – default model and temperature.
- `assignees` – team roster for intelligent assignment; the LLM will match issues to members based on their role and expertise.

Command‑line flags always take precedence over the config file – use them for one‑off overrides.

## 📄 Issue File Format

Each generated issue is a markdown file with YAML frontmatter:

```markdown
---
id: 001-implement-agent-loop
title: Implement agent loop with ring buffer and debounce
labels: ["core", "performance", "must"]
assignees: ["alice-dev"]
priority: must
references: ["archi.md#42-tiered-streaming", "srs.md#req-func-012"]
state: open
createdAt: 2025-03-11T20:59:11.123Z
---

## Description

Implement the agent loop as described in the architecture document...
```

- The `id` field is used for mapping; it can be any unique string, but by default it's generated from the issue title.
- The `references` array contains relative links to sections in your spec files – they become clickable links in the GitHub issue body.

## 🧪 Development

```bash
# Clone the monorepo
git clone https://github.com/elcoosp/elcoosp-ai.git
cd elcoosp-ai

# Navigate to the seedling package
cd seedling

# Install dependencies
pnpm install

# Run tests
pnpm test

# Build the package
pnpm build
```

## 📝 License

[MIT](LICENSE)
