import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { AgentRuntime } from "@elizaos/core";
import { TaskRegistry } from "../services/task-registry.js";

// TODO: This integration test requires a pglite test runtime helper
// (`test/helpers/pglite-runtime`) that is not present in the repo. The test
// was added in commit 989c14d but the helper module was never committed.
// Skipping until the helper is restored or the test is rewritten with mocks.
// biome-ignore lint/suspicious/noExplicitAny: stub for missing helper
const createTestRuntime: any = async () => {
  throw new Error(
    "createTestRuntime helper is missing — see test/helpers/pglite-runtime",
  );
};

describe.skip("TaskRegistry", () => {
  let runtime: AgentRuntime;
  let cleanup: () => Promise<void>;
  let registry: TaskRegistry;

  beforeAll(async () => {
    ({ runtime, cleanup } = await createTestRuntime());
    registry = new TaskRegistry(runtime);
    await registry.ensureSchema();
  }, 180_000);

  afterAll(async () => {
    await cleanup();
  });

  it("persists threads, sessions, decisions, events, and artifacts", async () => {
    const thread = await registry.createThread({
      id: "thread-registry-1",
      title: "Persist coordinator task state",
      originalRequest: "Make task state durable across restarts",
      kind: "coding",
      summary: "Initial summary",
      acceptanceCriteria: ["State survives restart", "Task can be reopened"],
      metadata: { source: "test" },
    });

    await registry.registerSession({
      threadId: thread.id,
      sessionId: "session-registry-1",
      framework: "claude",
      label: "claude-worker",
      originalTask: "Implement persistence",
      workdir: "/tmp/milady-registry",
      repo: "https://github.com/example/milady",
      status: "active",
      decisionCount: 0,
      autoResolvedCount: 0,
    });

    await registry.recordDecision({
      threadId: thread.id,
      sessionId: "session-registry-1",
      timestamp: Date.now(),
      event: "blocked",
      promptText: "Allow write?",
      decision: "respond",
      response: "y",
      reasoning: "Within workspace",
    });

    await registry.updateSession("session-registry-1", {
      status: "blocked",
      decisionCount: 1,
      lastActivityAt: Date.now(),
    });

    await registry.recordArtifact({
      threadId: thread.id,
      sessionId: "session-registry-1",
      artifactType: "screenshot",
      title: "Validation screenshot",
      path: "/tmp/validation.png",
      mimeType: "image/png",
      metadata: { verified: true },
    });

    await registry.recordTranscript({
      threadId: thread.id,
      sessionId: "session-registry-1",
      direction: "stdin",
      content: "Please continue with persistence validation.",
    });

    await registry.updateThreadSummary(
      thread.id,
      "Durable state was written and validation evidence captured.",
    );

    const detail = await registry.getThread(thread.id);
    expect(detail).not.toBeNull();
    expect(detail?.status).toBe("blocked");
    expect(detail?.sessions).toHaveLength(1);
    expect(detail?.sessions[0]?.status).toBe("blocked");
    expect(detail?.decisions).toHaveLength(1);
    expect(detail?.artifacts).toHaveLength(1);
    expect(detail?.transcripts).toHaveLength(1);
    expect(detail?.events.some((event) => event.eventType === "task_created")).toBe(
      true,
    );

    const searchResults = await registry.listThreads({ search: "validation evidence" });
    expect(searchResults.map((entry) => entry.id)).toContain(thread.id);
  });

  it("marks live sessions interrupted during restart recovery and supports archive/reopen", async () => {
    const thread = await registry.createThread({
      id: "thread-registry-2",
      title: "Recover interrupted tasks",
      originalRequest: "Resume after restart",
      kind: "coding",
    });

    await registry.registerSession({
      threadId: thread.id,
      sessionId: "session-registry-2",
      framework: "codex",
      label: "codex-worker",
      originalTask: "Continue task after restart",
      workdir: "/tmp/milady-recovery",
      status: "active",
    });

    await registry.recoverInterruptedTasks();

    let detail = await registry.getThread(thread.id);
    expect(detail?.status).toBe("interrupted");
    expect(detail?.sessions[0]?.status).toBe("interrupted");
    expect(
      detail?.events.some((event) => event.eventType === "session_interrupted"),
    ).toBe(true);

    await registry.archiveThread(thread.id);
    detail = await registry.getThread(thread.id);
    expect(detail?.status).toBe("archived");

    await registry.reopenThread(thread.id);
    detail = await registry.getThread(thread.id);
    expect(detail?.status).toBe("interrupted");
    expect(detail?.archivedAt).toBeNull();
  });

  it("persists pending confirmations across registry instances", async () => {
    const thread = await registry.createThread({
      id: "thread-registry-3",
      title: "Persist pending confirmation state",
      originalRequest: "Keep human approvals durable",
      kind: "coding",
    });

    await registry.upsertPendingDecision({
      sessionId: "session-registry-3",
      threadId: thread.id,
      promptText: "Allow deploy to production?",
      recentOutput: "Waiting for confirmation",
      llmDecision: {
        action: "respond",
        response: "y",
        reasoning: "Deployment plan already validated",
      },
      taskContext: {
        threadId: thread.id,
        sessionId: "session-registry-3",
        agentType: "claude",
        label: "deploy-agent",
        originalTask: "Deploy the verified release",
        workdir: "/tmp/milady-pending",
        status: "blocked",
      },
      createdAt: 12345,
    });

    const reloadedRegistry = new TaskRegistry(runtime);
    await reloadedRegistry.ensureSchema();
    const pending = await reloadedRegistry.listPendingDecisions();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.sessionId).toBe("session-registry-3");
    expect(pending[0]?.llmDecision.response).toBe("y");
    expect(pending[0]?.taskContext.label).toBe("deploy-agent");

    await reloadedRegistry.deletePendingDecision("session-registry-3");
    expect(await registry.listPendingDecisions()).toHaveLength(0);
  });
});
