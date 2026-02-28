# @elizaos/plugin-agent-orchestrator

Orchestrate CLI-based coding agents (Claude Code, Codex, Gemini CLI, Aider, Pi) via PTY sessions and manage git workspaces for autonomous coding tasks.

Built for [Milady](https://github.com/milady-ai/milady), compatible with any [ElizaOS](https://github.com/elizaOS/eliza) agent.

## Features

- **PTY Session Management**: Spawn, control, and monitor coding agents running in pseudo-terminals
- **Git Workspace Provisioning**: Clone repos, create worktrees, manage branches
- **PR Workflow**: Commit changes, push to remote, create pull requests
- **Multi-Agent Support**: Claude Code, Codex, Gemini CLI, Aider, Pi, or generic shell

## Prerequisites

This plugin spawns CLI coding agents in PTY sessions. You need **at least one** of the following installed on your machine:

| Agent | Install | Docs |
|-------|---------|------|
| **Claude Code** | `npm install -g @anthropic-ai/claude-code` | [claude.ai/claude-code](https://claude.ai/claude-code) |
| **Codex** | `npm install -g @openai/codex` | [github.com/openai/codex](https://github.com/openai/codex) |
| **Gemini CLI** | `npm install -g @google/gemini-cli` | [github.com/google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli) |
| **Aider** | `pip install aider-chat` | [aider.chat](https://aider.chat) |

Each agent also requires its own API key (e.g., `ANTHROPIC_API_KEY` for Claude Code, `OPENAI_API_KEY` for Codex, `GOOGLE_GENERATIVE_AI_API_KEY` for Gemini). Set these in your environment or runtime settings.

The plugin auto-detects which agents are available at spawn time and will report if a requested agent isn't installed.

## Installation

```bash
npm install @elizaos/plugin-agent-orchestrator
```

The following peer dependencies will be installed automatically:

- `pty-manager` — PTY session management
- `git-workspace-service` — git workspace provisioning
- `coding-agent-adapters` — CLI agent adapter layer

## Usage

### Register the Plugin

```typescript
import { codingAgentPlugin } from "@elizaos/plugin-agent-orchestrator";

// Add to your Milady or ElizaOS agent configuration
const agent = {
  plugins: [codingAgentPlugin],
  // ... other config
};
```

### Actions

#### PTY Session Management

| Action | Description |
|--------|-------------|
| `SPAWN_CODING_AGENT` | Spawn a new coding agent session |
| `SEND_TO_CODING_AGENT` | Send input or keys to a running agent |
| `STOP_CODING_AGENT` | Terminate an agent session |
| `LIST_CODING_AGENTS` | List all active sessions |

#### Workspace Management

| Action | Description |
|--------|-------------|
| `PROVISION_WORKSPACE` | Clone a repo or create a worktree |
| `FINALIZE_WORKSPACE` | Commit, push, and optionally create PR |

### Example Conversation

```
User: Spawn Claude Code to fix the auth bug in src/auth.ts
Agent: Starting claude-code agent in /workspace...
       Session ID: abc123, Status: running

User: What coding agents are running?
Agent: Active sessions:
       1. claude-code (abc123...) - running
          Working in: /workspace

User: Tell it to accept the changes
Agent: Sent "y" to coding agent.

User: Create a PR for the fix
Agent: Workspace finalized!
       Commit: a1b2c3d4
       PR #42: https://github.com/user/repo/pull/42
```

## Services

### PTYService

Manages PTY sessions for coding agents.

```typescript
import { PTYService } from "@elizaos/plugin-agent-orchestrator";

// Access via runtime
const ptyService = runtime.getService("PTY_SERVICE") as PTYService;

// Spawn a session
const session = await ptyService.spawnSession({
  agentType: "claude-code",
  workdir: "/path/to/project",
  initialTask: "Fix the auth bug",
});

// Send input
await ptyService.sendToSession(session.id, "y");

// Check status
const info = ptyService.getSession(session.id);
console.log(info.status); // "running" | "blocked" | "completed"

// Stop session
await ptyService.stopSession(session.id);
```

### CodingWorkspaceService

Manages git workspaces for coding tasks.

```typescript
import { CodingWorkspaceService } from "@elizaos/plugin-agent-orchestrator";

// Access via runtime
const workspaceService = runtime.getService("CODING_WORKSPACE_SERVICE");

// Clone a repo
const workspace = await workspaceService.provisionWorkspace({
  repoUrl: "https://github.com/user/repo.git",
  branch: "feature/my-feature",
});

// Create worktree for parallel work
const worktree = await workspaceService.provisionWorkspace({
  useWorktree: true,
  parentWorkspaceId: workspace.id,
  branch: "bugfix/issue-123",
});

// Commit and push
await workspaceService.commit(workspace.id, {
  message: "fix: resolve auth issue",
  all: true,
});
await workspaceService.push(workspace.id, { setUpstream: true });

// Create PR
const pr = await workspaceService.createPR(workspace.id, {
  title: "Fix auth issue",
  body: "Resolves #123",
});
```

## Configuration

Configure via runtime settings:

```typescript
// PTY Service config
runtime.setSetting("PTY_SERVICE_CONFIG", {
  maxSessions: 5,
  idleTimeoutMs: 30 * 60 * 1000,
  debug: true,
});

// Workspace Service config
runtime.setSetting("CODING_WORKSPACE_CONFIG", {
  baseDir: "~/.milady/workspaces",
  credentials: {
    github: { token: process.env.GITHUB_TOKEN },
  },
  debug: true,
});
```

## Dependencies

- `pty-manager` - PTY session management with stall detection and auto-response
- `coding-agent-adapters` - Adapter layer for Claude Code, Codex, Gemini CLI, Aider CLIs
- `git-workspace-service` - Git workspace provisioning, credential management, and PR creation
- `pty-console` - Terminal bridge for xterm.js frontend integration

## License

MIT
