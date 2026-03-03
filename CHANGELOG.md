# Changelog

## 0.3.3

### Fixes

- **Duplicate SwarmCoordinator start**: ElizaOS may call `PTYService.start()` more than once during runtime initialization. Added a guard that checks if a coordinator is already registered on the runtime's services map before creating a new one, preventing duplicate "SwarmCoordinator started" log spam.

## 0.3.2

### Fixes

- **stopSession cleanup hardening**: Session existence check moved inside `try` so `finally` cleanup runs even when the manager already evicted the session (race with exit events). `unsubscribe()` guarded with inner `try/catch` so a throw from `.off()` on a destroyed PTY doesn't skip remaining state cleanup.
- **Out-of-scope force-kill**: Auto-approved out-of-scope access paths now use `force: true` when stopping the session, matching the behavior of other completion paths.

### Refactored

- **Deduplicated pty-init forwarding**: Extracted `forwardReadyAsTaskComplete()` helper, replacing duplicated `session_ready` → `task_complete` logic in both Bun and Node event paths.

## 0.3.1

### Fixes

- **Task completion detection**: `session_ready` → `task_complete` forwarding no longer blocked when `taskResponseMarkers` is consumed by adapter fast-path. Uses `hasTaskActivity` (decisions > 0) instead of marker existence, preventing multi-turn tasks from getting stuck.
- **Orphaned PTY processes**: `stopSession()` now accepts a `force` flag. Completed tasks, idle watchdog kills, and coding-task-helper completions use `SIGKILL` instead of `SIGTERM`, ensuring child processes exit immediately.
- **Coordinator prompt guidance**: Turn-complete and event-message prompts now recommend CLI tools (gh, curl, cat) over browser automation for verification, reducing delays from MCP tool permission prompts in headless environments.

### Added

- `hasTaskActivity` callback on `InitContext` — lets `pty-init` check if a session's task has had coordinator interaction (decisions > 0).
- Tests for `session_ready` → `task_complete` forwarding logic including exact reproduction of the multi-turn consumed-marker bug.

### Chores

- Added `*.tsbuildinfo` to `.gitignore`.

## 0.3.0

### Features

- **3-tier event triage**: Classifies coordinator events as routine (auto-resolved), creative (full Milaidy pipeline), or ambiguous (LLM fallback) using heuristic + LLM classification.
- **Startup grace period**: `tool_running` events during the first 10 seconds after task registration are suppressed from chat notifications to avoid noisy startup status lines.

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
