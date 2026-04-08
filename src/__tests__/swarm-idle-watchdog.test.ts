/**
 * Swarm idle watchdog loading-detection tests.
 *
 * Regression coverage for the bug where the watchdog would fire an LLM
 * idle check on a session that was still actively processing — TUIs
 * like Codex redraw their status row ("Working (Xs • esc to interrupt)")
 * in place via cursor positioning, so consecutive ANSI-stripped tails
 * can collapse to identical text even while the model is reasoning.
 *
 * The fix consults `ptyService.isSessionLoading(sessionId)` as a final
 * authoritative signal: if the adapter's `detectLoading()` returns true,
 * bump `lastActivityAt` and skip the idle check entirely.
 */

import { beforeEach, describe, expect, it, jest } from "bun:test";

const { scanIdleSessions, IDLE_THRESHOLD_MS } = await import(
  "../services/swarm-idle-watchdog.js"
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MockCtx {
  runtime: { useModel: ReturnType<typeof jest.fn> };
  ptyService: {
    getSession: ReturnType<typeof jest.fn>;
    getSessionOutput: ReturnType<typeof jest.fn>;
    isSessionLoading: ReturnType<typeof jest.fn>;
    sendToSession: ReturnType<typeof jest.fn>;
    sendKeysToSession: ReturnType<typeof jest.fn>;
    stopSession: ReturnType<typeof jest.fn>;
  };
  tasks: Map<string, ReturnType<typeof createTaskCtx>>;
  inFlightDecisions: Set<string>;
  lastSeenOutput: Map<string, string>;
  sharedDecisions: never[];
  getSwarmContext: () => string;
  syncTaskContext: ReturnType<typeof jest.fn>;
  recordDecision: ReturnType<typeof jest.fn>;
  broadcast: ReturnType<typeof jest.fn>;
  sendChatMessage: ReturnType<typeof jest.fn>;
  log: ReturnType<typeof jest.fn>;
  taskRegistry: { appendEvent: ReturnType<typeof jest.fn> };
}

function createMockCtx(): MockCtx {
  return {
    runtime: {
      useModel: jest
        .fn()
        .mockResolvedValue(
          '{"action":"respond","response":"continue","reasoning":"nudge"}',
        ),
    },
    ptyService: {
      // Session is always alive for these tests.
      getSession: jest.fn().mockReturnValue({ id: "s-1" }),
      getSessionOutput: jest.fn().mockResolvedValue("same output"),
      isSessionLoading: jest.fn().mockResolvedValue(false),
      sendToSession: jest.fn().mockResolvedValue(undefined),
      sendKeysToSession: jest.fn().mockResolvedValue(undefined),
      stopSession: jest.fn().mockResolvedValue(undefined),
    },
    tasks: new Map(),
    inFlightDecisions: new Set<string>(),
    lastSeenOutput: new Map<string, string>(),
    sharedDecisions: [],
    getSwarmContext: () => "",
    syncTaskContext: jest.fn().mockResolvedValue(undefined),
    recordDecision: jest.fn().mockResolvedValue(undefined),
    broadcast: jest.fn(),
    sendChatMessage: jest.fn(),
    log: jest.fn(),
    taskRegistry: {
      appendEvent: jest.fn().mockResolvedValue(undefined),
    },
  };
}

function createTaskCtx(overrides: Record<string, unknown> = {}) {
  // Default to "idle for longer than the threshold" so the watchdog
  // reaches the adapter check. Individual tests can override.
  const now = Date.now();
  return {
    sessionId: "s-1",
    threadId: "thread-1",
    agentType: "codex",
    label: "todo-app",
    originalTask: "build a todo",
    workdir: "/tmp/scratch-todo",
    repo: null,
    status: "active" as const,
    decisions: [] as Array<Record<string, unknown>>,
    autoResolvedCount: 0,
    registeredAt: now - IDLE_THRESHOLD_MS - 60_000,
    lastActivityAt: now - IDLE_THRESHOLD_MS - 60_000,
    idleCheckCount: 0,
    lastSeenDecisionIndex: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("swarm idle watchdog — adapter loading signal", () => {
  let ctx: MockCtx;

  beforeEach(() => {
    ctx = createMockCtx();
  });

  it("skips the LLM idle check when the adapter reports loading", async () => {
    const taskCtx = createTaskCtx();
    ctx.tasks.set("s-1", taskCtx);

    // Prime lastSeenOutput so the text-diff check does NOT short-circuit
    // — this forces the code path down to the adapter loading check.
    ctx.lastSeenOutput.set("s-1", "same output");
    ctx.ptyService.getSessionOutput.mockResolvedValue("same output");

    // Adapter says "I'm busy" (Codex is mid-reasoning, status row shows
    // "esc to interrupt").
    ctx.ptyService.isSessionLoading.mockResolvedValue(true);

    await scanIdleSessions(ctx as never);

    // Adapter was consulted
    expect(ctx.ptyService.isSessionLoading).toHaveBeenCalledWith("s-1");

    // LLM idle check was NOT invoked
    expect(ctx.runtime.useModel).not.toHaveBeenCalled();

    // lastActivityAt was bumped so the next scan won't immediately re-fire
    expect(taskCtx.lastActivityAt).toBeGreaterThan(Date.now() - 1_000);

    // idleCheckCount was reset
    expect(taskCtx.idleCheckCount).toBe(0);
  });

  it("falls through to the LLM idle check when adapter reports not loading", async () => {
    const taskCtx = createTaskCtx();
    ctx.tasks.set("s-1", taskCtx);

    ctx.lastSeenOutput.set("s-1", "same output");
    ctx.ptyService.getSessionOutput.mockResolvedValue("same output");
    ctx.ptyService.isSessionLoading.mockResolvedValue(false);

    await scanIdleSessions(ctx as never);

    expect(ctx.ptyService.isSessionLoading).toHaveBeenCalledWith("s-1");

    // LLM idle check WAS invoked since nothing else saved us
    expect(ctx.runtime.useModel).toHaveBeenCalled();
  });

  it("swallows errors from isSessionLoading and falls through", async () => {
    const taskCtx = createTaskCtx();
    ctx.tasks.set("s-1", taskCtx);

    ctx.lastSeenOutput.set("s-1", "same output");
    ctx.ptyService.getSessionOutput.mockResolvedValue("same output");
    ctx.ptyService.isSessionLoading.mockRejectedValue(new Error("ipc timeout"));

    await scanIdleSessions(ctx as never);

    // Proceeded to the LLM idle check despite the thrown error
    expect(ctx.runtime.useModel).toHaveBeenCalled();
  });

  it("does not consult the adapter when the text diff already shows fresh output", async () => {
    const taskCtx = createTaskCtx();
    ctx.tasks.set("s-1", taskCtx);

    // Output changed since last scan — the text-diff path handles this
    // and should return before we ever ask the adapter.
    ctx.lastSeenOutput.set("s-1", "old output");
    ctx.ptyService.getSessionOutput.mockResolvedValue("brand new output");

    await scanIdleSessions(ctx as never);

    expect(ctx.ptyService.isSessionLoading).not.toHaveBeenCalled();
    expect(ctx.runtime.useModel).not.toHaveBeenCalled();
    expect(taskCtx.idleCheckCount).toBe(0);
  });
});
