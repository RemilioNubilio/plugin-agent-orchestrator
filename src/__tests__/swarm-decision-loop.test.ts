/**
 * Swarm Decision Loop tests
 *
 * Tests handleBlocked, handleTurnComplete, executeDecision,
 * and the out-of-scope path escalation guard.
 */

import { beforeEach, describe, expect, it, jest } from "bun:test";

const { handleBlocked, handleTurnComplete, executeDecision } = await import(
  "../services/swarm-decision-loop.js"
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockCtx(overrides: Record<string, unknown> = {}) {
  return {
    runtime: {
      useModel: jest.fn().mockResolvedValue(
        '{"action":"respond","response":"y","reasoning":"Approve"}',
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
// handleBlocked
// ---------------------------------------------------------------------------
describe("handleBlocked", () => {
  it("records auto-resolved decisions", async () => {
    const ctx = createMockCtx();
    const taskCtx = createTaskCtx();
    ctx.tasks.set("s-1", taskCtx);

    await handleBlocked(ctx as never, "s-1", taskCtx as never, {
      promptInfo: { prompt: "Allow?", type: "permission" },
      autoResponded: true,
    });

    expect(taskCtx.decisions.length).toBe(1);
    expect(taskCtx.decisions[0].decision).toBe("auto_resolved");
    expect(taskCtx.autoResolvedCount).toBe(1);
  });

  it("escalates after max auto-responses", async () => {
    const ctx = createMockCtx();
    const taskCtx = createTaskCtx({ autoResolvedCount: 10 });
    ctx.tasks.set("s-1", taskCtx);

    await handleBlocked(ctx as never, "s-1", taskCtx as never, {
      promptInfo: { prompt: "Allow?" },
      autoResponded: false,
    });

    expect(taskCtx.decisions.length).toBe(1);
    expect(taskCtx.decisions[0].decision).toBe("escalate");
    expect(ctx.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "escalation" }),
    );
  });

  it("routes to autonomous decision in autonomous mode", async () => {
    const ctx = createMockCtx();
    const taskCtx = createTaskCtx();
    ctx.tasks.set("s-1", taskCtx);

    await handleBlocked(ctx as never, "s-1", taskCtx as never, {
      promptInfo: { prompt: "Allow write to /workspace/project/src/a.ts?" },
      autoResponded: false,
    });

    expect(ctx.ptyService.sendToSession).toHaveBeenCalledWith("s-1", "y");
  });

  it("uses adapter suggested key responses immediately in autonomous mode", async () => {
    const ctx = createMockCtx();
    const taskCtx = createTaskCtx();
    ctx.tasks.set("s-1", taskCtx);

    await handleBlocked(ctx as never, "s-1", taskCtx as never, {
      promptInfo: {
        prompt: "Codex tool approval",
        type: "permission",
        canAutoRespond: true,
        suggestedResponse: "keys:enter",
      },
      autoResponded: false,
    });

    expect(ctx.runtime.useModel).not.toHaveBeenCalled();
    expect(ctx.ptyService.sendKeysToSession).toHaveBeenCalledWith("s-1", [
      "enter",
    ]);
    expect(taskCtx.decisions[0].decision).toBe("auto_resolved");
  });

  it("falls back to enter for autonomous permission prompts that omit a suggested response", async () => {
    const ctx = createMockCtx();
    const taskCtx = createTaskCtx();
    ctx.tasks.set("s-1", taskCtx);

    await handleBlocked(ctx as never, "s-1", taskCtx as never, {
      promptInfo: {
        prompt: "Codex tool approval",
        type: "permission",
        canAutoRespond: true,
      },
      autoResponded: false,
    });

    expect(ctx.runtime.useModel).not.toHaveBeenCalled();
    expect(ctx.ptyService.sendKeysToSession).toHaveBeenCalledWith("s-1", [
      "enter",
    ]);
    expect(taskCtx.decisions[0].decision).toBe("auto_resolved");
  });

  it("auto-answers routine Codex browser follow-up questions", async () => {
    const ctx = createMockCtx();
    const taskCtx = createTaskCtx({ agentType: "codex" });
    ctx.tasks.set("s-1", taskCtx);

    await handleBlocked(ctx as never, "s-1", taskCtx as never, {
      promptInfo: {
        prompt: "The page is accessible. Should I open the page in a new tab instead?",
        type: "unknown",
        canAutoRespond: false,
      },
      autoResponded: false,
    });

    expect(ctx.runtime.useModel).not.toHaveBeenCalled();
    expect(ctx.ptyService.sendToSession).toHaveBeenCalledWith("s-1", "yes");
    expect(taskCtx.decisions[0].decision).toBe("auto_resolved");
  });

  it("keeps the current Codex model for routine selection prompts", async () => {
    const ctx = createMockCtx();
    const taskCtx = createTaskCtx({ agentType: "codex" });
    ctx.tasks.set("s-1", taskCtx);

    await handleBlocked(ctx as never, "s-1", taskCtx as never, {
      promptInfo: {
        prompt:
          "1. GPT-5 Mini ex. Cheaper, faster, but less capable. 2. Keep current model 3. Keep current mode",
        type: "unknown",
        canAutoRespond: false,
      },
      autoResponded: false,
    });

    expect(ctx.runtime.useModel).not.toHaveBeenCalled();
    expect(ctx.ptyService.sendToSession).toHaveBeenCalledWith("s-1", "2");
    expect(taskCtx.decisions[0].decision).toBe("auto_resolved");
  });

  it("declines and redirects out-of-scope path access in autonomous mode", async () => {
    const ctx = createMockCtx();
    // LLM says "respond y" but path is out of scope
    ctx.runtime.useModel.mockResolvedValue(
      '{"action":"respond","response":"y","reasoning":"Approve"}',
    );
    const taskCtx = createTaskCtx({ workdir: "/workspace/project" });
    ctx.tasks.set("s-1", taskCtx);

    await handleBlocked(ctx as never, "s-1", taskCtx as never, {
      promptInfo: { prompt: "Allow read of /etc/passwd?" },
      autoResponded: false,
    });

    // Should have declined and redirected — NOT sent "y"
    expect(ctx.ptyService.sendToSession).toHaveBeenCalledWith(
      "s-1",
      expect.stringContaining("outside your workspace"),
    );
    const lastDecision =
      taskCtx.decisions[taskCtx.decisions.length - 1];
    expect(lastDecision.decision).toBe("respond");
    expect(lastDecision.reasoning).toContain("Declined out-of-scope");

    // Should have notified the human
    expect(ctx.sendChatMessage).toHaveBeenCalledWith(
      expect.stringContaining("Declined out-of-scope"),
      "coding-agent",
    );
  });

  it("approves in-scope path access in autonomous mode", async () => {
    const ctx = createMockCtx();
    ctx.runtime.useModel.mockResolvedValue(
      '{"action":"respond","response":"y","reasoning":"Approve"}',
    );
    const taskCtx = createTaskCtx({ workdir: "/workspace/project" });
    ctx.tasks.set("s-1", taskCtx);

    await handleBlocked(ctx as never, "s-1", taskCtx as never, {
      promptInfo: {
        prompt: "Allow write to /workspace/project/src/index.ts?",
      },
      autoResponded: false,
    });

    expect(ctx.ptyService.sendToSession).toHaveBeenCalledWith("s-1", "y");
  });

  it("stops session when auto-response approved out-of-scope access", async () => {
    const ctx = createMockCtx();
    const taskCtx = createTaskCtx({ workdir: "/workspace/project" });
    ctx.tasks.set("s-1", taskCtx);

    await handleBlocked(ctx as never, "s-1", taskCtx as never, {
      promptInfo: { prompt: "Allow read of /etc/passwd?" },
      autoResponded: true,
    });

    // Should have escalated, NOT recorded as auto_resolved
    expect(taskCtx.decisions.length).toBe(1);
    expect(taskCtx.decisions[0].decision).toBe("escalate");
    expect(taskCtx.decisions[0].reasoning).toContain("SECURITY");
    expect(taskCtx.decisions[0].reasoning).toContain("outside workspace");

    // Session should be stopped
    expect(taskCtx.status).toBe("error");
    expect(ctx.ptyService.stopSession).toHaveBeenCalledWith("s-1", true);

    // Should have sent warning chat message
    expect(ctx.sendChatMessage).toHaveBeenCalledWith(
      expect.stringContaining("WARNING"),
      "coding-agent",
    );

    // Should have broadcast escalation with out_of_scope reason
    expect(ctx.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "escalation",
        data: expect.objectContaining({
          reason: "out_of_scope_auto_approved",
        }),
      }),
    );

    // Auto-resolved count should NOT have incremented
    expect(taskCtx.autoResolvedCount).toBe(0);
  });

  it("allows auto-response for in-scope paths", async () => {
    const ctx = createMockCtx();
    const taskCtx = createTaskCtx({ workdir: "/workspace/project" });
    ctx.tasks.set("s-1", taskCtx);

    await handleBlocked(ctx as never, "s-1", taskCtx as never, {
      promptInfo: {
        prompt: "Allow write to /workspace/project/src/index.ts?",
      },
      autoResponded: true,
    });

    // Should be recorded as auto_resolved (not escalated)
    expect(taskCtx.decisions.length).toBe(1);
    expect(taskCtx.decisions[0].decision).toBe("auto_resolved");
    expect(taskCtx.autoResolvedCount).toBe(1);

    // Session should NOT be stopped
    expect(taskCtx.status).toBe("active");
    expect(ctx.ptyService.stopSession).not.toHaveBeenCalled();
  });

  it("records notify-mode decisions as escalate", async () => {
    const ctx = createMockCtx({
      getSupervisionLevel: () => "notify",
    });
    const taskCtx = createTaskCtx();

    await handleBlocked(ctx as never, "s-1", taskCtx as never, {
      promptInfo: { prompt: "Allow?" },
      autoResponded: false,
    });

    expect(taskCtx.decisions.length).toBe(1);
    expect(taskCtx.decisions[0].decision).toBe("escalate");
    expect(ctx.runtime.useModel).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// executeDecision
// ---------------------------------------------------------------------------
describe("executeDecision", () => {
  it("sends text response for respond action", async () => {
    const ctx = createMockCtx();

    await executeDecision(ctx as never, "s-1", {
      action: "respond",
      response: "y",
      reasoning: "Approve",
    });

    expect(ctx.ptyService.sendToSession).toHaveBeenCalledWith("s-1", "y");
  });

  it("sends keys for respond action with useKeys", async () => {
    const ctx = createMockCtx();

    await executeDecision(ctx as never, "s-1", {
      action: "respond",
      useKeys: true,
      keys: ["down", "enter"],
      reasoning: "Select option",
    });

    expect(ctx.ptyService.sendKeysToSession).toHaveBeenCalledWith("s-1", [
      "down",
      "enter",
    ]);
  });

  it("broadcasts escalation for escalate action", async () => {
    const ctx = createMockCtx();

    await executeDecision(ctx as never, "s-1", {
      action: "escalate",
      reasoning: "Needs human input",
    });

    expect(ctx.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "escalation" }),
    );
  });

  it("completes session and stops it", async () => {
    const ctx = createMockCtx();
    const taskCtx = createTaskCtx();
    ctx.tasks.set("s-1", taskCtx);

    await executeDecision(ctx as never, "s-1", {
      action: "complete",
      reasoning: "Task done",
    });

    expect(taskCtx.status).toBe("completed");
    expect(ctx.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "task_complete" }),
    );
    expect(ctx.ptyService.stopSession).toHaveBeenCalledWith("s-1", true);
  });
});

// ---------------------------------------------------------------------------
// handleTurnComplete
// ---------------------------------------------------------------------------
describe("handleTurnComplete", () => {
  it("sends follow-up when LLM says respond", async () => {
    const ctx = createMockCtx();
    ctx.runtime.useModel.mockResolvedValue(
      '{"action":"respond","response":"Now run tests","reasoning":"Code written but not tested"}',
    );
    const taskCtx = createTaskCtx();

    await handleTurnComplete(ctx as never, "s-1", taskCtx as never, {
      response: "I wrote the code",
    });

    expect(ctx.ptyService.sendToSession).toHaveBeenCalledWith(
      "s-1",
      "Now run tests",
    );
    expect(taskCtx.decisions.length).toBe(1);
    expect(taskCtx.decisions[0].decision).toBe("respond");
  });

  it("completes session when LLM says complete", async () => {
    const ctx = createMockCtx();
    ctx.runtime.useModel.mockResolvedValue(
      '{"action":"complete","reasoning":"All objectives met"}',
    );
    const taskCtx = createTaskCtx();
    ctx.tasks.set("s-1", taskCtx);

    await handleTurnComplete(ctx as never, "s-1", taskCtx as never, {
      response: "PR created and verified",
    });

    expect(taskCtx.status).toBe("completed");
    expect(ctx.ptyService.stopSession).toHaveBeenCalledWith("s-1", true);
  });

  it("defaults to escalate on invalid LLM response", async () => {
    const ctx = createMockCtx();
    ctx.runtime.useModel.mockResolvedValue("I cannot parse this");
    const taskCtx = createTaskCtx();
    ctx.tasks.set("s-1", taskCtx);

    await handleTurnComplete(ctx as never, "s-1", taskCtx as never, {
      response: "done",
    });

    expect(taskCtx.decisions.length).toBe(1);
    expect(taskCtx.decisions[0].decision).toBe("escalate");
  });

  it("debounces concurrent assessments", async () => {
    const ctx = createMockCtx();
    ctx.runtime.useModel.mockResolvedValue(
      '{"action":"complete","reasoning":"Done"}',
    );
    const taskCtx = createTaskCtx();
    ctx.tasks.set("s-1", taskCtx);

    // Simulate in-flight
    ctx.inFlightDecisions.add("s-1");

    await handleTurnComplete(ctx as never, "s-1", taskCtx as never, {});

    // Should have been skipped
    expect(ctx.runtime.useModel).not.toHaveBeenCalled();
  });
});
