/**
 * Swarm Decision Loop tests
 *
 * Tests handleBlocked, handleTurnComplete, executeDecision,
 * and the out-of-scope path escalation guard.
 */

import { describe, expect, it, jest } from "bun:test";

const {
  POST_SEND_COOLDOWN_MS,
  checkAllTasksComplete,
  handleBlocked,
  handleTurnComplete,
  executeDecision,
} = await import("../services/swarm-decision-loop.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockCtx(overrides: Record<string, unknown> = {}) {
  return {
    runtime: {
      useModel: jest
        .fn()
        .mockImplementation(
          async (_modelType: string, options?: { prompt?: string }) => {
            if (
              options?.prompt?.includes("Return strict JSON only") ||
              options?.prompt?.includes("Return JSON only with keys: verdict, summary, checklist.")
            ) {
              return '{"verdict":"pass","summary":"Validation confirmed the task is complete."}';
            }
            return '{"action":"respond","response":"y","reasoning":"Approve"}';
          },
        ),
      getService: jest.fn().mockReturnValue(null),
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
    syncTaskContext: jest.fn().mockResolvedValue(undefined),
    recordDecision: jest
      .fn()
      .mockImplementation(
        async (
          taskCtx: { decisions: Array<Record<string, unknown>> },
          decision: Record<string, unknown>,
        ) => {
          taskCtx.decisions.push(decision);
        },
      ),
    taskRegistry: {
      getThread: jest.fn().mockResolvedValue({
        id: "thread-1",
        title: "test-agent",
        kind: "coding",
        status: "active",
        originalRequest: "Fix bug",
        summary: "",
        sessionCount: 1,
        activeSessionCount: 1,
        latestSessionId: "s-1",
        latestSessionLabel: "test-agent",
        latestWorkdir: "/workspace/project",
        latestRepo: null,
        latestActivityAt: Date.now(),
        decisionCount: 0,
        nodeCount: 0,
        readyNodeCount: 0,
        completedNodeCount: 0,
        verifierJobCount: 0,
        evidenceCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        acceptanceCriteria: ["Fix bug", "Run validation"],
        sessions: [],
        decisions: [],
        events: [],
        artifacts: [],
        transcripts: [],
        pendingDecisions: [],
        nodes: [],
        dependencies: [],
        claims: [],
        mailbox: [],
        verifierJobs: [],
        evidence: [],
      }),
      appendEvent: jest.fn().mockResolvedValue(undefined),
      recordArtifact: jest.fn().mockResolvedValue(undefined),
      createTaskVerifierJob: jest.fn().mockResolvedValue({
        id: "verify-1",
      }),
      updateTaskVerifierJob: jest.fn().mockResolvedValue(undefined),
      updateTaskNode: jest.fn().mockResolvedValue(undefined),
      recordTaskEvidence: jest.fn().mockResolvedValue(undefined),
      updateThreadSummary: jest.fn().mockResolvedValue(undefined),
    },
    broadcast: jest.fn(),
    sendChatMessage: jest.fn(),
    log: jest.fn(),
    ...overrides,
  };
}

function createTaskCtx(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "s-1",
    threadId: "thread-1",
    taskNodeId: "node-1",
    agentType: "claude",
    label: "test-agent",
    originalTask: "Fix bug",
    workdir: "/workspace/project",
    repo: null,
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
        prompt:
          "The page is accessible. Should I open the page in a new tab instead?",
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

  it("accepts the current workspace for routine project selection prompts", async () => {
    const ctx = createMockCtx();
    const taskCtx = createTaskCtx({ agentType: "codex" });
    ctx.tasks.set("s-1", taskCtx);

    await handleBlocked(ctx as never, "s-1", taskCtx as never, {
      promptInfo: {
        prompt: "Project/workspace selection required",
        type: "project_select",
        canAutoRespond: false,
      },
      autoResponded: false,
    });

    expect(ctx.runtime.useModel).not.toHaveBeenCalled();
    expect(ctx.ptyService.sendKeysToSession).toHaveBeenCalledWith("s-1", [
      "enter",
    ]);
    expect(taskCtx.decisions[0].decision).toBe("auto_resolved");
  });

  it("accepts Claude navigation dialogs with key input instead of text", async () => {
    const ctx = createMockCtx();
    const taskCtx = createTaskCtx({ agentType: "claude" });
    ctx.tasks.set("s-1", taskCtx);

    await handleBlocked(ctx as never, "s-1", taskCtx as never, {
      promptInfo: {
        prompt: "Claude dialog awaiting navigation",
        type: "config",
        canAutoRespond: false,
      },
      autoResponded: false,
    });

    expect(ctx.runtime.useModel).not.toHaveBeenCalled();
    expect(ctx.ptyService.sendKeysToSession).toHaveBeenCalledWith("s-1", [
      "enter",
    ]);
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
    const lastDecision = taskCtx.decisions[taskCtx.decisions.length - 1];
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

  it("replays buffered blocked prompts before buffered turn-complete events", async () => {
    const ctx = createMockCtx();
    const taskCtx = createTaskCtx({ agentType: "codex" });
    ctx.tasks.set("s-1", taskCtx);

    let seededBuffers = false;
    ctx.runtime.useModel.mockImplementationOnce(async () => {
      if (!seededBuffers) {
        seededBuffers = true;
        ctx.pendingBlocked.set("s-1", {
          promptInfo: {
            prompt:
              "1. GPT-5 Mini ex. Cheaper, faster, but less capable. 2. Keep current model 3. Keep current model (never show again)",
            type: "unknown",
            canAutoRespond: false,
          },
          autoResponded: false,
        });
        ctx.pendingTurnComplete.set("s-1", {
          response: "agent turn completed",
        });
      }
      return '{"action":"respond","response":"continue task","reasoning":"Need more work"}';
    });

    await handleTurnComplete(ctx as never, "s-1", taskCtx as never, {
      response: "initial turn output",
    });

    expect(ctx.ptyService.sendToSession.mock.calls[0]).toEqual(["s-1", "2"]);
    expect(ctx.pendingTurnComplete.has("s-1")).toBe(true);

    taskCtx.lastInputSentAt = Date.now() - POST_SEND_COOLDOWN_MS - 100;
    const bufferedTurnComplete = ctx.pendingTurnComplete.get("s-1");
    expect(bufferedTurnComplete).toBeDefined();
    await handleTurnComplete(
      ctx as never,
      "s-1",
      taskCtx as never,
      bufferedTurnComplete,
    );

    expect(ctx.ptyService.sendToSession.mock.calls[1]).toEqual(["s-1", "y"]);
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

  it("sends the agent back to work when validation requests revision", async () => {
    const ctx = createMockCtx();
    ctx.runtime.useModel.mockImplementation(
      async (_modelType: string, options?: { prompt?: string }) => {
        if (options?.prompt?.includes("Return strict JSON only")) {
          return JSON.stringify({
            verdict: "revise",
            summary: "Tests and verification evidence are still missing.",
            followUpPrompt:
              "Run the full test suite, verify the output, and report the evidence.",
          });
        }
        return '{"action":"respond","response":"y","reasoning":"Approve"}';
      },
    );
    const taskCtx = createTaskCtx();
    ctx.tasks.set("s-1", taskCtx);

    await executeDecision(ctx as never, "s-1", {
      action: "complete",
      reasoning: "Task done",
    });

    expect(taskCtx.status).toBe("active");
    expect(ctx.ptyService.sendToSession).toHaveBeenCalledWith(
      "s-1",
      "Run the full test suite, verify the output, and report the evidence.",
    );
    expect(ctx.ptyService.stopSession).not.toHaveBeenCalled();
    expect(ctx.sendChatMessage).toHaveBeenCalledWith(
      expect.stringContaining("Validation asked the agent to continue"),
      "coding-agent",
    );
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
    ctx.runtime.useModel.mockImplementation(
      async (_modelType: string, options?: { prompt?: string }) => {
        if (options?.prompt?.includes("Return strict JSON only")) {
          return '{"verdict":"pass","summary":"Validation confirmed the PR and verification evidence."}';
        }
        return '{"action":"complete","reasoning":"All objectives met"}';
      },
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

describe("checkAllTasksComplete", () => {
  it("waits for graph goal nodes to become terminal before firing swarm_complete", async () => {
    const ctx = createMockCtx();
    ctx.tasks.set(
      "s-1",
      createTaskCtx({ status: "completed", completionSummary: "Done" }),
    );
    ctx.taskRegistry.getThread.mockResolvedValue({
      id: "thread-1",
      title: "test-agent",
      kind: "coding",
      status: "active",
      originalRequest: "Fix bug",
      summary: "",
      sessionCount: 1,
      activeSessionCount: 0,
      latestSessionId: "s-1",
      latestSessionLabel: "test-agent",
      latestWorkdir: "/workspace/project",
      latestRepo: null,
      latestActivityAt: Date.now(),
      decisionCount: 0,
      nodeCount: 1,
      readyNodeCount: 0,
      completedNodeCount: 0,
      verifierJobCount: 0,
      evidenceCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      acceptanceCriteria: [],
      sessions: [],
      decisions: [],
      events: [],
      artifacts: [],
      transcripts: [],
      pendingDecisions: [],
      nodes: [
        {
          id: "node-goal",
          threadId: "thread-1",
          parentNodeId: null,
          kind: "goal",
          status: "planned",
          title: "Ship task",
          instructions: "Ship task",
          acceptanceCriteria: [],
          requiredCapabilities: [],
          expectedArtifacts: [],
          assignedSessionId: null,
          assignedLabel: null,
          agentType: null,
          workdir: null,
          repo: null,
          priority: 0,
          depth: 0,
          sequence: 0,
          createdFrom: null,
          metadata: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          startedAt: null,
          completedAt: null,
        },
      ],
      dependencies: [],
      claims: [],
      mailbox: [],
      verifierJobs: [],
      evidence: [],
    });

    checkAllTasksComplete(ctx as never);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(ctx.broadcast).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "swarm_complete" }),
    );
  });

  it("runs pending acceptance verifiers before firing swarm_complete", async () => {
    const ctx = createMockCtx();
    ctx.tasks.set(
      "s-1",
      createTaskCtx({ status: "completed", completionSummary: "Done" }),
    );
    const thread = {
      id: "thread-1",
      title: "test-agent",
      kind: "coding",
      status: "active",
      originalRequest: "Fix bug",
      summary: "",
      sessionCount: 1,
      activeSessionCount: 0,
      latestSessionId: "s-1",
      latestSessionLabel: "test-agent",
      latestWorkdir: "/workspace/project",
      latestRepo: null,
      latestActivityAt: Date.now(),
      decisionCount: 0,
      nodeCount: 2,
      readyNodeCount: 0,
      completedNodeCount: 2,
      verifierJobCount: 1,
      evidenceCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      acceptanceCriteria: ["Fix bug", "Run validation"],
      sessions: [
        {
          threadId: "thread-1",
          sessionId: "s-1",
          framework: "claude",
          providerSource: "credentials",
          label: "test-agent",
          originalTask: "Fix bug",
          workdir: "/workspace/project",
          repo: null,
          status: "completed",
          decisionCount: 0,
          autoResolvedCount: 0,
          registeredAt: Date.now(),
          lastActivityAt: Date.now(),
          idleCheckCount: 0,
          taskDelivered: true,
          completionSummary: "Done",
          lastSeenDecisionIndex: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          metadata: {},
        },
      ],
      decisions: [],
      events: [],
      artifacts: [],
      transcripts: [
        {
          id: "transcript-1",
          threadId: "thread-1",
          sessionId: "s-1",
          timestamp: Date.now(),
          direction: "stdout",
          content: "Tests passed.",
          metadata: {},
          createdAt: new Date().toISOString(),
        },
      ],
      pendingDecisions: [],
      nodes: [
        {
          id: "node-goal",
          threadId: "thread-1",
          parentNodeId: null,
          kind: "goal",
          status: "completed",
          title: "Ship task",
          instructions: "Ship task",
          acceptanceCriteria: ["Fix bug", "Run validation"],
          requiredCapabilities: [],
          expectedArtifacts: [],
          assignedSessionId: null,
          assignedLabel: null,
          agentType: null,
          workdir: null,
          repo: null,
          priority: 0,
          depth: 0,
          sequence: 0,
          createdFrom: null,
          metadata: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          startedAt: null,
          completedAt: new Date().toISOString(),
        },
        {
          id: "node-1",
          threadId: "thread-1",
          parentNodeId: "node-goal",
          kind: "execution",
          status: "completed",
          title: "Implement",
          instructions: "Fix bug",
          acceptanceCriteria: [],
          requiredCapabilities: ["claude"],
          expectedArtifacts: [],
          assignedSessionId: "s-1",
          assignedLabel: "test-agent",
          agentType: "claude",
          workdir: "/workspace/project",
          repo: null,
          priority: 1,
          depth: 1,
          sequence: 1,
          createdFrom: null,
          metadata: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          startedAt: null,
          completedAt: new Date().toISOString(),
        },
      ],
      dependencies: [],
      claims: [],
      mailbox: [],
      verifierJobs: [
        {
          id: "verify-task-completion",
          threadId: "thread-1",
          nodeId: "node-1",
          status: "passed",
          verifierType: "task_completion",
          title: "Validate task completion",
          instructions: "Validate task completion",
          config: {},
          metadata: {},
          createdAt: new Date().toISOString(),
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        },
        {
          id: "verify-acceptance",
          threadId: "thread-1",
          nodeId: "node-goal",
          status: "pending",
          verifierType: "acceptance_criteria",
          title: "Verify acceptance",
          instructions: "Check acceptance",
          config: {},
          metadata: {},
          createdAt: new Date().toISOString(),
          startedAt: null,
          completedAt: null,
        },
      ],
      evidence: [
        {
          id: "evidence-1",
          threadId: "thread-1",
          nodeId: "node-1",
          sessionId: "s-1",
          verifierJobId: "verify-task-completion",
          evidenceType: "validation_summary",
          title: "Validation passed",
          summary: "Validation confirmed the task is complete.",
          path: null,
          uri: null,
          content: {},
          metadata: {},
          createdAt: new Date().toISOString(),
        },
      ],
    };
    ctx.taskRegistry.getThread.mockImplementation(async () => thread);
    ctx.taskRegistry.updateTaskVerifierJob.mockImplementation(
      async (jobId: string, patch: Record<string, unknown>) => {
        const job = thread.verifierJobs.find((entry) => entry.id === jobId);
        if (job) Object.assign(job, patch);
      },
    );
    ctx.taskRegistry.updateTaskNode = jest.fn().mockResolvedValue(undefined);

    checkAllTasksComplete(ctx as never);
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(ctx.taskRegistry.updateTaskVerifierJob).toHaveBeenCalledWith(
      "verify-acceptance",
      expect.objectContaining({ status: "running" }),
    );
    expect(ctx.taskRegistry.updateTaskVerifierJob).toHaveBeenCalledWith(
      "verify-acceptance",
      expect.objectContaining({ status: "passed" }),
    );
    expect(ctx.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "swarm_complete" }),
    );
  });

  it("raises attention instead of swarm_complete when acceptance evidence is missing", async () => {
    const ctx = createMockCtx();
    ctx.tasks.set(
      "s-1",
      createTaskCtx({ status: "completed", completionSummary: "Done" }),
    );
    const thread = {
      id: "thread-1",
      title: "test-agent",
      kind: "coding",
      status: "active",
      originalRequest: "Fix bug",
      summary: "",
      sessionCount: 1,
      activeSessionCount: 0,
      latestSessionId: "s-1",
      latestSessionLabel: "test-agent",
      latestWorkdir: "/workspace/project",
      latestRepo: null,
      latestActivityAt: Date.now(),
      decisionCount: 0,
      nodeCount: 2,
      readyNodeCount: 0,
      completedNodeCount: 2,
      verifierJobCount: 1,
      evidenceCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      acceptanceCriteria: ["Fix bug", "Run validation"],
      sessions: [
        {
          threadId: "thread-1",
          sessionId: "s-1",
          framework: "claude",
          providerSource: "credentials",
          label: "test-agent",
          originalTask: "Fix bug",
          workdir: "/workspace/project",
          repo: null,
          status: "completed",
          decisionCount: 0,
          autoResolvedCount: 0,
          registeredAt: Date.now(),
          lastActivityAt: Date.now(),
          idleCheckCount: 0,
          taskDelivered: true,
          completionSummary: "Done",
          lastSeenDecisionIndex: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          metadata: {},
        },
      ],
      decisions: [],
      events: [],
      artifacts: [],
      transcripts: [],
      pendingDecisions: [],
      nodes: [
        {
          id: "node-goal",
          threadId: "thread-1",
          parentNodeId: null,
          kind: "goal",
          status: "completed",
          title: "Ship task",
          instructions: "Ship task",
          acceptanceCriteria: ["Fix bug", "Run validation"],
          requiredCapabilities: [],
          expectedArtifacts: [],
          assignedSessionId: null,
          assignedLabel: null,
          agentType: null,
          workdir: null,
          repo: null,
          priority: 0,
          depth: 0,
          sequence: 0,
          createdFrom: null,
          metadata: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          startedAt: null,
          completedAt: new Date().toISOString(),
        },
        {
          id: "node-1",
          threadId: "thread-1",
          parentNodeId: "node-goal",
          kind: "execution",
          status: "completed",
          title: "Implement",
          instructions: "Fix bug",
          acceptanceCriteria: [],
          requiredCapabilities: ["claude"],
          expectedArtifacts: [],
          assignedSessionId: "s-1",
          assignedLabel: "test-agent",
          agentType: "claude",
          workdir: "/workspace/project",
          repo: null,
          priority: 1,
          depth: 1,
          sequence: 1,
          createdFrom: null,
          metadata: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          startedAt: null,
          completedAt: new Date().toISOString(),
        },
      ],
      dependencies: [],
      claims: [],
      mailbox: [],
      verifierJobs: [
        {
          id: "verify-acceptance",
          threadId: "thread-1",
          nodeId: "node-goal",
          status: "pending",
          verifierType: "acceptance_criteria",
          title: "Verify acceptance",
          instructions: "Check acceptance",
          config: {},
          metadata: {},
          createdAt: new Date().toISOString(),
          startedAt: null,
          completedAt: null,
        },
      ],
      evidence: [],
    };
    ctx.taskRegistry.getThread.mockImplementation(async () => thread);
    ctx.taskRegistry.updateTaskVerifierJob.mockImplementation(
      async (jobId: string, patch: Record<string, unknown>) => {
        const job = thread.verifierJobs.find((entry) => entry.id === jobId);
        if (job) Object.assign(job, patch);
      },
    );
    ctx.taskRegistry.updateTaskNode.mockImplementation(
      async (nodeId: string, patch: Record<string, unknown>) => {
        const node = thread.nodes.find((entry) => entry.id === nodeId);
        if (node) Object.assign(node, patch);
      },
    );

    checkAllTasksComplete(ctx as never);
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(ctx.taskRegistry.updateTaskVerifierJob).toHaveBeenCalledWith(
      "verify-acceptance",
      expect.objectContaining({ status: "failed" }),
    );
    expect(ctx.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "swarm_attention_required" }),
    );
    expect(ctx.broadcast).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "swarm_complete" }),
    );
  });
});
