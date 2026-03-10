/**
 * Post-send cooldown suppression tests
 *
 * Validates that handleTurnComplete and stall classification are
 * suppressed during the grace period after the coordinator sends
 * input to an agent, preventing cascading follow-ups.
 */

import { beforeEach, describe, expect, it, jest } from "bun:test";

const { handleTurnComplete, executeDecision } = await import(
  "../services/swarm-decision-loop.js"
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockCtx(overrides: Record<string, unknown> = {}) {
  return {
    runtime: {
      useModel: jest.fn().mockResolvedValue(
        '{"action":"respond","response":"Continue","reasoning":"Follow up"}',
      ),
    },
    ptyService: {
      sendToSession: jest.fn().mockResolvedValue(undefined),
      sendKeysToSession: jest.fn().mockResolvedValue(undefined),
      getSessionOutput: jest.fn().mockResolvedValue("recent output"),
      stopSession: jest.fn().mockResolvedValue(undefined),
    },
    tasks: new Map(),
    inFlightDecisions: new Set<string>(),
    pendingDecisions: new Map(),
    pendingTurnComplete: new Map(),
    lastBlockedPromptFingerprint: new Map(),
    pendingBlocked: new Map(),
    getSupervisionLevel: () => "autonomous",
    getAgentDecisionCallback: () => null,
    getSwarmCompleteCallback: () => null,
    sharedDecisions: [],
    getSwarmContext: () => "",
    broadcast: jest.fn(),
    sendChatMessage: jest.fn(),
    log: jest.fn(),
    ...overrides,
  };
}

function createTaskCtx(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "s-1",
    agentType: "claude",
    label: "test-agent",
    originalTask: "Fix bug",
    workdir: "/workspace/project",
    status: "active",
    decisions: [] as Array<Record<string, unknown>>,
    autoResolvedCount: 0,
    registeredAt: Date.now(),
    lastActivityAt: Date.now(),
    idleCheckCount: 0,
    lastSeenDecisionIndex: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// executeDecision sets lastInputSentAt
// ---------------------------------------------------------------------------
describe("executeDecision cooldown tracking", () => {
  it("sets lastInputSentAt after sending a text response", async () => {
    const ctx = createMockCtx();
    const taskCtx = createTaskCtx();
    ctx.tasks.set("s-1", taskCtx);

    const before = Date.now();
    await executeDecision(ctx as never, "s-1", {
      action: "respond",
      response: "Continue working",
      reasoning: "Follow up",
    });
    const after = Date.now();

    expect(taskCtx.lastInputSentAt).toBeDefined();
    expect(taskCtx.lastInputSentAt).toBeGreaterThanOrEqual(before);
    expect(taskCtx.lastInputSentAt).toBeLessThanOrEqual(after);
  });

  it("sets lastInputSentAt after sending keys", async () => {
    const ctx = createMockCtx();
    const taskCtx = createTaskCtx();
    ctx.tasks.set("s-1", taskCtx);

    await executeDecision(ctx as never, "s-1", {
      action: "respond",
      useKeys: true,
      keys: ["enter"],
      reasoning: "Approve",
    });

    expect(taskCtx.lastInputSentAt).toBeDefined();
  });

  it("does not set lastInputSentAt for complete action", async () => {
    const ctx = createMockCtx();
    const taskCtx = createTaskCtx();
    ctx.tasks.set("s-1", taskCtx);

    await executeDecision(ctx as never, "s-1", {
      action: "complete",
      reasoning: "Done",
    });

    expect(taskCtx.lastInputSentAt).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// handleTurnComplete suppression during cooldown
// ---------------------------------------------------------------------------
describe("handleTurnComplete cooldown suppression", () => {
  it("suppresses turn-complete during cooldown window", async () => {
    const ctx = createMockCtx();
    const taskCtx = createTaskCtx({
      lastInputSentAt: Date.now(), // Just sent input
    });
    ctx.tasks.set("s-1", taskCtx);

    await handleTurnComplete(ctx as never, "s-1", taskCtx as never, {
      response: "I finished the task",
    });

    // Should NOT have called the LLM — event was suppressed
    expect(ctx.runtime.useModel).not.toHaveBeenCalled();
    // Should have logged suppression
    expect(ctx.log).toHaveBeenCalledWith(
      expect.stringContaining("Suppressing turn-complete"),
    );
  });

  it("allows turn-complete after cooldown expires", async () => {
    const ctx = createMockCtx();
    const taskCtx = createTaskCtx({
      // Input sent 20s ago — past the 15s cooldown
      lastInputSentAt: Date.now() - 20_000,
    });
    ctx.tasks.set("s-1", taskCtx);

    await handleTurnComplete(ctx as never, "s-1", taskCtx as never, {
      response: "I finished the task",
    });

    // Should have called the LLM — cooldown expired
    expect(ctx.runtime.useModel).toHaveBeenCalled();
  });

  it("allows turn-complete when no input was ever sent", async () => {
    const ctx = createMockCtx();
    const taskCtx = createTaskCtx();
    // lastInputSentAt is undefined
    ctx.tasks.set("s-1", taskCtx);

    await handleTurnComplete(ctx as never, "s-1", taskCtx as never, {
      response: "I finished the task",
    });

    // Should have called the LLM — no cooldown active
    expect(ctx.runtime.useModel).toHaveBeenCalled();
  });
});
