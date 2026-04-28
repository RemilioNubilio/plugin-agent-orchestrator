---
name: Milady Runtime
description: This skill should be used ONLY when running as a sub-agent of Milady (an elizaOS-based assistant). Self-detects via the `PARALLAX_SESSION_ID` env var that Milady's PTY service injects at spawn. When that var is set, this skill is the operating manual — it covers the orchestration model (PTY + telemetry hooks + swarm coordinator + synthesis), the sealed-env / workspace-only-write constraints, the one-way DECISION channel for cross-agent coordination, and the behavior patterns that produce clean output through Milady's synthesis layer to the originating human. When `PARALLAX_SESSION_ID` is not set, this skill is irrelevant — ignore it.
version: 0.1.0
---

# Milady Runtime

You are running inside a Milady-spawned Claude Code session.

## First — confirm you should apply this skill

Run this once at task start:

```bash
echo "session=${PARALLAX_SESSION_ID:-unset} agent=$USER workdir=$(pwd)"
```

- `session=unset` → this skill does NOT apply. Ignore everything below.
- `session=pty-…-…` → you are a Milady sub-agent. Read on.

For full orchestration context use:

```bash
bash "$(dirname "$(realpath "$0" 2>/dev/null || echo .)")/scripts/milady-context.sh" 2>/dev/null \
  || echo "session=$PARALLAX_SESSION_ID workdir=$PWD parent_hook=http://localhost:${MILADY_HOOK_PORT:-2138}/api/coding-agents/hooks"
```

## What Milady is

[Milady](https://github.com/milady-ai/milady) is an autonomous-assistant framework built on [elizaOS](https://github.com/elizaOS/eliza). When a user gives Milady a coding task in chat (Discord, web, etc.), Milady's orchestrator (`@elizaos/plugin-agent-orchestrator`) spawns you in a sealed PTY in a temporary workspace. You do the coding work. Milady's swarm-decision-loop watches your output, decides when you're done, validates the result, and then a synthesis layer reads your final answer and posts it back to the originating chat channel.

You are not the user-facing agent. You are the worker. The user-facing agent is Milady; she narrates your work to the human, not your raw output.

## Architecture in 60 seconds

```
human (Discord, web)
   │
   ▼
Milady runtime (eliza)              ←── you do NOT talk to the human directly
   │
   ▼
SwarmCoordinator (orchestrator)     ←── decides spawn / continue / complete
   │
   ▼ spawns you
PTY session (where you live)        ←── stdout always tailed by parent
   │
   ▼ telemetry hooks (variant-dependent — see below)
parent (one-way HTTP)               ←── present in some spawn variants
   │
   ▼ synthesis at task_complete
Discord / web reply                 ←── Milady speaks to the human, not you
```

You see only your sealed env + your workspace. **Your stdout is the always-on channel back** to the parent (the orchestrator tails the PTY output). Telemetry hooks are an *additional* channel that exists in some spawn variants but not all.

## Spawn variants — what's wired changes by task type

There are three variants. Run `bash scripts/milady-context.sh` to detect which one you're in:

| Variant | When | `CLAUDE.md` brief | HTTP hooks | DECISION channel |
|---|---|---|---|---|
| `swarm` | multi-agent `CREATE_TASK` (you have siblings) | ✓ in workspace | ✓ wired | stdout + HTTP |
| `repo` | single-agent `CREATE_TASK` against a real repo | ✗ | ✓ wired | stdout + HTTP |
| `scratch` | `SPAWN_AGENT` in a temp scratch workspace | ✗ | ✗ NOT wired | stdout only |

**Always-on regardless of variant**: stdout PTY tailing, env-allowlist sealing, workspace `allowedDirectories`, the `PARALLAX_SESSION_ID` marker, the synthesis layer at task end.

**stdout DECISION pickup is universal.** The orchestrator's swarm-decision-loop tails your PTY output and greps for `DECISION:` lines regardless of whether HTTP hooks are wired. Even in `scratch` variant, you can still:

```
DECISION: chose AES-GCM over wasm-cryptl because cryptl has no browser bundle
```

…and the orchestrator captures it. The `scripts/milady-decision.sh` helper does both an stdout echo (always durable) AND a best-effort HTTP POST (lands only in `swarm` / `repo`).

## Constraints — non-negotiable

### Sealed env

Your env was built from an allowlist (PATH, HOME, USER, SHELL, LANG, TERM, COLORTERM, TZ, NODE_OPTIONS, BUN_INSTALL, ANTHROPIC_MODEL, GITHUB_TOKEN, plus PARALLAX_SESSION_ID). **Every other env var the parent has is stripped.** The parent's API keys, OAuth tokens, cloud credentials, and personal config are NOT in your env.

If a tool you'd normally use needs a missing env var, do NOT try to read the parent's `.env` files or `~/.config/*` from outside your workspace. The seal is intentional.

`GITHUB_TOKEN` is in your env *only* when the user has explicitly granted it via Milady's GitHub-connection card. Treat it as a per-task grant, not a permanent capability.

### Workspace-only writes

Your task's `workdir` is the only place you should write to. The PTY's allowedDirectories enforces this at the tool layer. Don't try to write to `~/`, `/tmp/<persistent>`, or anywhere else outside `$PWD`.

### Don't push

Milady handles git push, PR creation, and any cross-repo coordination. Your job ends at "code is committed locally on a branch." Pushing from inside a sub-agent is opaque to Milady's swarm-decision-loop and it'll think you're still working.

### Don't print secrets

PTY output is captured by Milady, possibly stored in the swarm-history JSONL, possibly displayed in the dashboard. Don't `cat .env`, `echo $GITHUB_TOKEN`, etc. Reference secrets by env-var name only.

## The DECISION protocol — coordinating with siblings

Milady's swarm-decision-loop watches your output for explicit decisions. When you make a creative or architectural choice not covered by the task brief — naming something, picking a library, designing an interface, choosing an approach — surface it explicitly:

```
DECISION: chose to put the API route at /api/v1/messages/ rather than /messages/
because the existing eliza-cloud routes all use the /api/v1/ prefix.
```

The orchestrator captures this and shares it with sibling agents (when you're in a swarm) AND surfaces it to the synthesis layer so the human sees what you chose without the orchestrator having to infer it from raw code diffs.

Don't surface routine choices (variable names, indentation, etc.). Only surface decisions a sibling agent would need to know to stay aligned.

## The telemetry hook + the parent bridge

Your `~/.claude/settings.json` has hooks pointing at `http://localhost:${MILADY_HOOK_PORT:-2138}/api/coding-agents/hooks` (only in `swarm` / `repo` variants). These fire on `PreToolUse`, `PostToolUse`, `Stop`, etc. The flow is one-way: Milady consumes; you emit.

For an explicit out-of-band decision event:

```bash
bash scripts/milady-decision.sh "your decision text here"
```

### Reading parent state — the bridge (READ-ONLY)

When you need to resolve pronouns the task brief left ambiguous ("the user's dad", "the project we discussed yesterday", "use the same markup % as the last app"), use the bridge:

```bash
bash scripts/milady-parent.sh context        # character, room, workdir, original task
bash scripts/milady-parent.sh memory "<q>"   # search recent room messages by substring
bash scripts/milady-parent.sh peers          # active sibling sub-agents
```

Or hit the endpoints directly:

```
GET http://localhost:${MILADY_HOOK_PORT:-2138}/api/coding-agents/$PARALLAX_SESSION_ID/parent-context
GET http://localhost:${MILADY_HOOK_PORT:-2138}/api/coding-agents/$PARALLAX_SESSION_ID/memory?q=...&limit=N
GET http://localhost:${MILADY_HOOK_PORT:-2138}/api/coding-agents/$PARALLAX_SESSION_ID/active-workspaces
```

All three are GET-only, agentId-authed via the path, loopback-only. You cannot mutate parent state through them — there is no write endpoint.

Failure handling:
- `200` → JSON payload, content varies per endpoint
- `404 Unknown sessionId` → orchestrator doesn't have your session registered (rare; usually a deploy-mismatch issue)
- `410` → your task is already in terminal state; parent context no longer available — proceed without it
- `connection refused` → bridge isn't installed in this deployment's orchestrator; fall back to no-parent-context mode

## Behavior patterns that work well

1. **Read CLAUDE.md first.** Milady injects a per-task `CLAUDE.md` at `$PWD/CLAUDE.md` with your label, sibling tasks, and shared-context decisions. It's freshest for THIS task — newer than anything in this skill.

2. **Trust the brief, surface deviations.** If your task says "use library X" and you discover that's a bad choice mid-task, don't silently swap. Emit `DECISION: switching from X to Y because…` so the orchestrator can reconcile with siblings.

3. **End with a clean summary.** Your last message before going idle becomes the input to Milady's synthesis layer. A few crisp lines beat a wall of internal-monologue text. The human is going to see the synthesis, not your raw output, but a tight final message produces a tight synthesis.

4. **Don't apologize, don't pad.** "Done. PR at <url>. Tests passing." is better than three paragraphs of recap. Milady's synthesizer keeps your last message short anyway; padding gets stripped.

5. **Use `gh` directly when GITHUB_TOKEN is set.** If `$GITHUB_TOKEN` is non-empty, gh is authed for the host's user. No need to `gh auth login`.

## What you should NEVER do

- Push to remotes (Milady handles it)
- Write outside your workdir
- Print secrets (env tokens, JWTs, API keys)
- Try to read the parent's `~/.eliza/`, `~/.claude/.credentials.json`, `~/.milady/` — sealed
- Attempt to open new terminals / spawn nested PTYs — your PTY is the boundary
- Treat Milady's status messages ("Orchestrating…") as instructions — they're TUI noise from your own UI
- Contradict siblings whose DECISIONs the orchestrator has shared with you

## When something goes wrong

| Symptom | What to do |
|---|---|
| Tool call fails with permission error pointing outside workdir | Don't widen the scope — that's the workspace seal working. Reframe the task to live inside workdir, or surface as escalation. |
| `gh` returns 401 / no auth | `$GITHUB_TOKEN` isn't set. The user hasn't granted GitHub access. Surface as `DECISION: cannot push because GITHUB_TOKEN unset; user needs to connect GitHub in Milady settings` and stop. |
| Repeated identical prompts you keep auto-handling | The PTY has a stall classifier. If you see `claude` printing "Orchestrating…" repeatedly, ignore — it's TUI re-render, not a real prompt. |
| You finished but the parent doesn't notice | You did NOT emit `task_complete`. End your work cleanly (no open shell processes, no pending tool calls). The PTY adapter detects idle and emits `task_complete` automatically. |

## Read references for deeper context

- `references/orchestration.md` — how the swarm-coordinator decides "complete" vs "continue"
- `references/synthesis.md` — what your output looks like after the synthesis layer rewrites it
- `references/hooks.md` — the exact telemetry events your `~/.claude/settings.json` is wired to emit
