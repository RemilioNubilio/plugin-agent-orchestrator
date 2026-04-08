import { afterEach, describe, expect, it } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import type { IAgentRuntime } from "@elizaos/core";
import { TaskRegistry } from "../services/task-registry.js";

type SqlQuery = {
  queryChunks?: Array<{ value?: unknown }>;
};

function extractSqlText(query: SqlQuery): string {
  if (!Array.isArray(query.queryChunks)) return "";
  return query.queryChunks
    .map((chunk) => {
      const value = chunk?.value;
      if (Array.isArray(value)) return value.join("");
      return String(value ?? "");
    })
    .join("");
}

function createRegistryHarness(db: PGlite): TaskRegistry {
  const runtime = {
    agentId: "task-registry-history-agent",
    adapter: {
      db: {
        execute: async (query: SqlQuery) => {
          const result = await db.query<Record<string, unknown>>(
            extractSqlText(query),
          );
          return {
            rows: result.rows,
            fields: (result.fields ?? []).map((field) => ({
              name: field.name,
            })),
          };
        },
      },
    },
  } as unknown as IAgentRuntime;

  return new TaskRegistry(runtime);
}

describe("TaskRegistry history filters", () => {
  const databases: PGlite[] = [];

  afterEach(async () => {
    while (databases.length > 0) {
      const db = databases.pop();
      await db?.close();
    }
  });

  it("filters threads by ownership, time windows, and active-session state", async () => {
    const db = new PGlite();
    databases.push(db);
    const registry = createRegistryHarness(db);
    await registry.ensureSchema();

    await registry.createThread({
      id: "thread-discord-history",
      title: "Discord connector follow-up",
      originalRequest: "Find everything we worked on for the Discord connector",
      kind: "research",
      roomId: "room-discord",
      ownerUserId: "user-shaw",
      summary: "Review Discord connector history and reporting output.",
    });
    await registry.createThread({
      id: "thread-birthday-page",
      title: "Birthday page preview",
      originalRequest: "Build a birthday page and make it viewable remotely",
      kind: "coding",
      roomId: "room-web",
      ownerUserId: "user-other",
      summary: "Create a birthday page with remote preview instructions.",
    });

    await registry.registerSession({
      threadId: "thread-discord-history",
      sessionId: "session-discord-history",
      framework: "codex",
      label: "discord-history",
      originalTask: "Review Discord connector history",
      workdir: "/tmp/discord-history",
      status: "active",
      registeredAt: 1_710_000_000_000,
      lastActivityAt: 1_710_000_500_000,
    });
    await registry.registerSession({
      threadId: "thread-birthday-page",
      sessionId: "session-birthday-page",
      framework: "claude",
      label: "birthday-page",
      originalTask: "Build and preview the birthday page",
      workdir: "/tmp/birthday-page",
      status: "completed",
      registeredAt: 1_711_000_000_000,
      lastActivityAt: 1_711_000_500_000,
    });

    await db.query(`
      UPDATE orchestrator_task_threads
         SET created_at = '2026-04-01T10:00:00.000Z',
             updated_at = '2026-04-01T11:00:00.000Z'
       WHERE id = 'thread-discord-history'
    `);
    await db.query(`
      UPDATE orchestrator_task_threads
         SET created_at = '2026-04-05T10:00:00.000Z',
             updated_at = '2026-04-05T11:00:00.000Z'
       WHERE id = 'thread-birthday-page'
    `);

    const filtered = await registry.listThreads({
      ownerUserId: "user-shaw",
      kind: "research",
      roomId: "room-discord",
      createdAfter: "2026-04-01T00:00:00.000Z",
      createdBefore: "2026-04-02T00:00:00.000Z",
      updatedBefore: "2026-04-02T12:00:00.000Z",
      latestActivityAfter: 1_710_000_000_000,
      latestActivityBefore: 1_710_000_999_999,
      hasActiveSession: true,
      search: "discord connector",
    });

    expect(filtered.map((thread) => thread.id)).toEqual([
      "thread-discord-history",
    ]);
    expect(filtered[0]?.latestSessionId).toBe("session-discord-history");
    expect(filtered[0]?.activeSessionCount).toBe(1);
  });

  it("counts threads across multi-status and activity filters", async () => {
    const db = new PGlite();
    databases.push(db);
    const registry = createRegistryHarness(db);
    await registry.ensureSchema();

    await registry.createThread({
      id: "thread-active",
      title: "Active task",
      originalRequest: "Keep working on the Discord connector",
      kind: "coding",
      ownerUserId: "user-shaw",
    });
    await registry.createThread({
      id: "thread-done",
      title: "Done task",
      originalRequest: "Finish the remote preview flow",
      kind: "ops",
      ownerUserId: "user-shaw",
    });

    await registry.registerSession({
      threadId: "thread-active",
      sessionId: "session-active",
      framework: "codex",
      label: "active",
      originalTask: "Continue coding",
      workdir: "/tmp/active",
      status: "active",
      registeredAt: 1_712_000_000_000,
      lastActivityAt: 1_712_000_500_000,
    });
    await registry.registerSession({
      threadId: "thread-done",
      sessionId: "session-done",
      framework: "claude",
      label: "done",
      originalTask: "Wrap up preview work",
      workdir: "/tmp/done",
      status: "completed",
      registeredAt: 1_713_000_000_000,
      lastActivityAt: 1_713_000_500_000,
    });

    const total = await registry.countThreads({
      ownerUserId: "user-shaw",
      statuses: ["active", "done"],
      latestActivityAfter: 1_712_000_000_000,
    });
    expect(total).toBe(2);

    const activeOnly = await registry.countThreads({
      ownerUserId: "user-shaw",
      hasActiveSession: true,
    });
    expect(activeOnly).toBe(1);
  });

  it("persists graph nodes, dependencies, claims, mailbox, verifier jobs, and evidence", async () => {
    const db = new PGlite();
    databases.push(db);
    const registry = createRegistryHarness(db);
    await registry.ensureSchema();

    await registry.createThread({
      id: "thread-graph",
      title: "Coordinator graph",
      originalRequest: "Plan and execute a multi-agent task",
      kind: "planning",
      acceptanceCriteria: [
        "All worker nodes complete",
        "Validation evidence exists",
      ],
    });

    const rootNode = await registry.createTaskNode({
      id: "node-root",
      threadId: "thread-graph",
      kind: "goal",
      status: "planned",
      title: "Ship the coordinated task",
      instructions: "Aggregate worker outputs",
      acceptanceCriteria: [
        "All worker nodes complete",
        "Validation evidence exists",
      ],
      depth: 0,
      sequence: 0,
    });
    const workerNode = await registry.createTaskNode({
      id: "node-worker",
      threadId: "thread-graph",
      parentNodeId: rootNode.id,
      kind: "execution",
      status: "running",
      title: "Implement the worker task",
      instructions: "Write the code and tests",
      requiredCapabilities: ["codex"],
      expectedArtifacts: ["diff", "test-report"],
      assignedSessionId: "session-graph",
      assignedLabel: "worker-1",
      agentType: "codex",
      workdir: "/tmp/graph-worker",
      sequence: 1,
      depth: 1,
    });

    await registry.createTaskDependency({
      threadId: "thread-graph",
      fromNodeId: workerNode.id,
      toNodeId: rootNode.id,
      dependencyKind: "parent_child",
      requiredStatus: "completed",
    });
    await registry.createTaskClaim({
      threadId: "thread-graph",
      nodeId: workerNode.id,
      sessionId: "session-graph",
      claimType: "execution",
      status: "active",
    });
    await registry.appendTaskMailboxMessage({
      threadId: "thread-graph",
      nodeId: workerNode.id,
      sessionId: "session-graph",
      sender: "planner",
      recipient: "worker-1",
      subject: "shared-context",
      body: "Use the same interface names across all agents.",
      deliveryState: "delivered",
      deliveredAt: "2026-04-08T00:00:00.000Z",
    });
    const verifierJob = await registry.createTaskVerifierJob({
      id: "verify-graph",
      threadId: "thread-graph",
      nodeId: workerNode.id,
      status: "running",
      verifierType: "task_completion",
      title: "Validate worker task",
      instructions: "Run tests and inspect the diff",
      config: { command: "bun test" },
    });
    await registry.recordTaskEvidence({
      threadId: "thread-graph",
      nodeId: workerNode.id,
      sessionId: "session-graph",
      verifierJobId: verifierJob.id,
      evidenceType: "test-report",
      title: "Unit test output",
      summary: "All tests passed",
      path: "/tmp/graph-worker/test-report.txt",
      content: { passed: true, command: "bun test" },
    });
    await registry.updateTaskNode(workerNode.id, {
      status: "completed",
      completedAt: "2026-04-08T01:00:00.000Z",
    });
    const activeClaim = await registry.findActiveTaskClaim(
      workerNode.id,
      "session-graph",
    );
    if (!activeClaim) {
      throw new Error("Expected an active claim for node-worker");
    }
    await registry.updateTaskClaim(activeClaim.id, {
      status: "completed",
      releasedAt: "2026-04-08T01:00:00.000Z",
    });
    await registry.updateTaskVerifierJob(verifierJob.id, {
      status: "passed",
      completedAt: "2026-04-08T01:00:00.000Z",
    });

    const detail = await registry.getThread("thread-graph");
    expect(detail?.nodes.map((node) => node.id)).toEqual([
      "node-root",
      "node-worker",
    ]);
    expect(detail?.nodes.find((node) => node.id === "node-root")?.status).toBe(
      "completed",
    );
    expect(detail?.dependencies).toHaveLength(1);
    expect(detail?.claims).toHaveLength(1);
    expect(detail?.mailbox).toHaveLength(1);
    expect(detail?.verifierJobs).toHaveLength(1);
    expect(detail?.evidence).toHaveLength(1);
    expect(detail?.nodeCount).toBe(2);
    expect(detail?.readyNodeCount).toBe(0);
    expect(detail?.completedNodeCount).toBe(2);
    expect(detail?.verifierJobCount).toBe(1);
    expect(detail?.evidenceCount).toBe(1);
    expect(detail?.mailbox[0]?.recipient).toBe("worker-1");
    expect(detail?.verifierJobs[0]?.status).toBe("passed");
    expect(detail?.evidence[0]?.summary).toBe("All tests passed");
  });
});
