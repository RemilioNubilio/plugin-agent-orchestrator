/**
 * Structured proof bridge — captures `APP_CREATE_DONE` / `PLUGIN_CREATE_DONE`
 * sentinels emitted by spawned task agents and persists the structured claim
 * onto the owning task's session metadata so the custom validator can
 * cross-check the claim against actual disk state.
 *
 * Sibling to `skill-callback-bridge.ts`. Unlike the skill bridge, this bridge
 * never dispatches anything back into the runtime — it only records the
 * proof and echoes a brief acknowledgement to the PTY so the agent knows
 * the orchestrator saw it.
 *
 * Sentinel grammar (one per session, on its own line):
 *
 *   APP_CREATE_DONE     {"name":"foo","files":[...],"testsPassed":N,"lintClean":B,"description":"..."}
 *   PLUGIN_CREATE_DONE  {"name":"plugin-bar","files":[...],"testsPassed":N,"lintClean":B}
 *
 * @module services/structured-proof-bridge
 */

import type { IAgentRuntime, Logger } from "@elizaos/core";
import type { PTYService } from "./pty-service.js";
import type { TaskRegistry } from "./task-registry.js";

const LOG_PREFIX = "[StructuredProof]";

const STRUCTURED_PROOF_DIRECTIVE_RE =
  /^[\t ]*(APP_CREATE_DONE|PLUGIN_CREATE_DONE)[\t ]+(\{[\s\S]*?\})[\t ]*$/m;

export type StructuredProofKind = "APP_CREATE_DONE" | "PLUGIN_CREATE_DONE";

export interface StructuredProofClaim {
  /** Kind of completion sentinel emitted by the child. */
  kind: StructuredProofKind;
  /** App or plugin name. Required. */
  name: string;
  /** Relative paths the child claims to have created/modified. Required. */
  files: string[];
  /** Number of tests the child claims passed. Required. */
  testsPassed: number;
  /** Whether the child claims a clean lint run. Required. */
  lintClean: boolean;
  /** Optional human-readable description. */
  description?: string;
  /** Wall-clock timestamp when this proof was recorded. */
  recordedAt: number;
  /** Any other JSON fields the child included. */
  extra?: Record<string, unknown>;
}

interface ParsedStructuredProof {
  kind: StructuredProofKind;
  claim: StructuredProofClaim;
}

function getLogger(runtime: IAgentRuntime): Logger | Console {
  const candidate = (runtime as unknown as { logger?: Logger }).logger;
  return candidate ?? console;
}

function isPlainStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}

/**
 * Parse the first APP_CREATE_DONE / PLUGIN_CREATE_DONE directive in a chunk
 * of agent output, if any. The directive must be on its own line (after
 * optional whitespace) and the JSON must include all required fields:
 * `name`, `files`, `testsPassed`, `lintClean`. Anything missing returns a
 * structured "invalid" result so the bridge can log without persisting.
 */
export function parseStructuredProofDirective(
  text: string,
):
  | { ok: true; parsed: ParsedStructuredProof }
  | { ok: false; reason: string }
  | null {
  if (!text) return null;
  const match = STRUCTURED_PROOF_DIRECTIVE_RE.exec(text);
  if (!match) return null;
  const kind = match[1] as StructuredProofKind;
  const jsonRaw = match[2];
  let payload: unknown;
  try {
    payload = JSON.parse(jsonRaw);
  } catch (err) {
    return {
      ok: false,
      reason: `JSON parse failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, reason: "payload must be a JSON object" };
  }
  const obj = payload as Record<string, unknown>;
  const name = obj.name;
  const files = obj.files;
  const testsPassed = obj.testsPassed;
  const lintClean = obj.lintClean;
  if (typeof name !== "string" || name.trim().length === 0) {
    return { ok: false, reason: "missing or empty 'name'" };
  }
  if (!isPlainStringArray(files)) {
    return { ok: false, reason: "'files' must be string[]" };
  }
  if (typeof testsPassed !== "number" || !Number.isFinite(testsPassed)) {
    return { ok: false, reason: "'testsPassed' must be a finite number" };
  }
  if (typeof lintClean !== "boolean") {
    return { ok: false, reason: "'lintClean' must be a boolean" };
  }
  const description =
    typeof obj.description === "string" ? obj.description : undefined;
  // Preserve any unknown JSON fields under `extra` so downstream validators
  // can read them without re-parsing the line.
  const known = new Set([
    "name",
    "files",
    "testsPassed",
    "lintClean",
    "description",
  ]);
  const extra: Record<string, unknown> = {};
  let hasExtra = false;
  for (const [key, value] of Object.entries(obj)) {
    if (known.has(key)) continue;
    extra[key] = value;
    hasExtra = true;
  }
  const claim: StructuredProofClaim = {
    kind,
    name: name.trim(),
    files,
    testsPassed,
    lintClean,
    ...(description !== undefined ? { description } : {}),
    recordedAt: Date.now(),
    ...(hasExtra ? { extra } : {}),
  };
  return { ok: true, parsed: { kind, claim } };
}

interface BridgeDeps {
  runtime: IAgentRuntime;
  ptyService: PTYService;
  /** Optional override for tests / non-default registries. */
  taskRegistry?: TaskRegistry;
}

/**
 * Per-runtime install guard — prevents stacking duplicate listeners when
 * many spawn calls fire concurrently. Mirrors the skill bridge.
 */
const installedRuntimes = new WeakSet<object>();

/**
 * Per-session idempotency: only persist the FIRST structured proof we see
 * for a given session. Subsequent sentinels are logged and skipped so a
 * looping agent cannot rewrite its own claim. Cleared on session teardown
 * (the entry naturally drops at process exit; we do not aggressively GC).
 */
const persistedSessions = new Set<string>();

/**
 * Reset per-session state. Tests use this to assert idempotency cleanly.
 * Production callers can call this when a session is recycled, but the
 * bridge is robust either way — duplicates are just logged.
 */
export function _resetStructuredProofBridge(): void {
  persistedSessions.clear();
}

function resolveTaskRegistry(
  deps: BridgeDeps,
): TaskRegistry | null {
  if (deps.taskRegistry) return deps.taskRegistry;
  const coordinator = deps.ptyService.coordinator;
  return coordinator?.taskRegistry ?? null;
}

/**
 * Ensure the bridge is installed exactly once for this runtime+PTY pair.
 * Safe to call from PTYService.start() and from every task spawn.
 */
export function ensureStructuredProofBridge(
  runtime: IAgentRuntime,
  ptyService: PTYService,
): void {
  const runtimeKey = runtime as unknown as object;
  if (installedRuntimes.has(runtimeKey)) return;
  installedRuntimes.add(runtimeKey);
  installStructuredProofBridge({ runtime, ptyService });
}

/**
 * Install the structured-proof bridge. Returns a teardown function. Safe to
 * call multiple times — the caller is responsible for deduplication via
 * `ensureStructuredProofBridge` (or by tracking the returned teardown).
 */
export function installStructuredProofBridge(deps: BridgeDeps): () => void {
  const { runtime, ptyService } = deps;
  const log = getLogger(runtime);

  const recordProof = async (
    sessionId: string,
    parsed: ParsedStructuredProof,
  ): Promise<void> => {
    if (persistedSessions.has(sessionId)) {
      log.info?.(
        `${LOG_PREFIX} duplicate ${parsed.kind} for session ${sessionId} (name=${parsed.claim.name}); skipping`,
      );
      // Echo back so the agent doesn't think the orchestrator missed it,
      // but make it explicit that this is a duplicate.
      await ptyService.sendToSession(
        sessionId,
        `--- structured proof duplicate ignored (${parsed.kind}, ${parsed.claim.name}) ---`,
      );
      return;
    }

    const registry = resolveTaskRegistry(deps);
    if (!registry) {
      log.warn?.(
        `${LOG_PREFIX} no task registry available; cannot persist proof for session ${sessionId}`,
      );
      return;
    }

    // Mark as persisted BEFORE the await so concurrent sentinels in the
    // same buffer chunk don't both win the idempotency check.
    persistedSessions.add(sessionId);

    await registry.updateSession(sessionId, {
      metadata: {
        structuredProof: parsed.claim,
      },
    });
    log.info?.(
      `${LOG_PREFIX} recorded ${parsed.kind} for session ${sessionId} (name=${parsed.claim.name}, files=${parsed.claim.files.length}, testsPassed=${parsed.claim.testsPassed}, lintClean=${parsed.claim.lintClean})`,
    );
    await ptyService.sendToSession(
      sessionId,
      `--- structured proof recorded (${parsed.kind}, ${parsed.claim.name}) ---`,
    );
  };

  const unsubscribe = ptyService.onSessionEvent((sessionId, event, data) => {
    if (event !== "task_complete" && event !== "message") return;
    const responseText =
      typeof (data as { response?: unknown })?.response === "string"
        ? (data as { response: string }).response
        : typeof (data as { text?: unknown })?.text === "string"
          ? (data as { text: string }).text
          : "";
    const parseResult = parseStructuredProofDirective(responseText);
    if (!parseResult) return;
    if (!parseResult.ok) {
      log.warn?.(
        `${LOG_PREFIX} session ${sessionId} emitted malformed structured proof: ${parseResult.reason}`,
      );
      return;
    }

    void recordProof(sessionId, parseResult.parsed).catch((err) => {
      // Roll back the idempotency mark on failure so a retry can succeed.
      persistedSessions.delete(sessionId);
      log.error?.(
        `${LOG_PREFIX} failed to persist proof for session ${sessionId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });
  });

  log.info?.(`${LOG_PREFIX} structured-proof bridge installed`);

  return () => {
    if (typeof unsubscribe === "function") unsubscribe();
  };
}
