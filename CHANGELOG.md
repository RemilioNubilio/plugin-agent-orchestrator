# Changelog

## 0.2.0

### Features

- **Repo context in coordinator prompts**: Tasks carry a `repo` field through the coordinator. Prompts include repository context and the LLM is guided to escalate when repo info is missing.
- **Repo resolution fallback**: `getLastUsedRepo()` handles "in the same repo" style requests where the LLM omits the repo param.
- **Out-of-scope access handling**: Agents referencing paths outside their workspace are declined and redirected instead of escalated. Detects sensitive roots (`/etc`, `/tmp`, `/var`, `/root`, etc.), `~/` paths, and filters out URL false positives.
- **Postinstall script**: `ensure-node-pty.mjs` rebuilds the native addon when bun skips node-gyp during install.

### Fixes

- **Stop session lifecycle**: Status guard allows stopped/error events through so the frontend receives them. In-flight LLM decisions are cleared on stop, preventing zombie responses to dead sessions.
- **Stall auto-response suppression**: Coordinator-managed sessions suppress the PTY worker's stall `suggestedResponse`, so only the coordinator decides how to respond to blocked agents.
- **TSC type errors**: Cast `runtime.services` for SWARM_COORDINATOR registration. Added null safety on `ptyService.stopSession`.
- **Env allowlist**: Added `TERM` and `TZ` to spawned agent environments for proper terminal detection and timezone consistency.

### Docs

- Added prerequisites section documenting required CLI agents and API keys.

### Chores

- Added `dist/` to `.gitignore` — built during npm publish only.
- Updated `git-workspace-service` to 0.4.4.

## 0.1.0

Initial release — PTY session management, git workspace provisioning, swarm coordinator with LLM-driven autonomous decision loop, multi-agent support (Claude Code, Codex, Gemini CLI, Aider).
