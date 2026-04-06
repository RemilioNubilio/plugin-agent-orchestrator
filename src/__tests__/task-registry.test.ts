import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { AgentRuntime } from "@elizaos/core";
import { createTestRuntime } from "../../../../test/helpers/pglite-runtime";
import { TaskRegistry } from "../services/task-registry.js";

describe("TaskRegistry", () => {
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
});
