import { afterEach, describe, expect, it, jest } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import type { IAgentRuntime } from "@elizaos/core";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { TaskRegistry } from "../services/task-registry.js";
import { runReadyTaskVerifiers } from "../services/task-verifier-runner.js";

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
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (databases.length > 0) {
      const db = databases.pop();
      await db?.close();
    }
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        await rm(dir, { recursive: true, force: true });
      }
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

  it("runs acceptance verifier jobs against the real registry and writes a report", async () => {
    const db = new PGlite();
    databases.push(db);
    const stateDir = await mkdtemp(path.join(tmpdir(), "acceptance-verifier-"));
    tempDirs.push(stateDir);
    const originalStateDir = process.env.MILADY_STATE_DIR;
    process.env.MILADY_STATE_DIR = stateDir;

    try {
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
        useModel: async () =>
          JSON.stringify({
            verdict: "pass",
            summary: "Acceptance criteria are satisfied by the recorded evidence.",
            checklist: [
              {
                criterion: "All worker nodes complete",
                status: "pass",
                evidence: "The worker node completed successfully.",
              },
              {
                criterion: "Validation evidence exists",
                status: "pass",
                evidence: "Validation summary evidence was recorded for the worker node.",
              },
            ],
          }),
      } as unknown as IAgentRuntime;
      const registry = new TaskRegistry(runtime);
      await registry.ensureSchema();

      await registry.createThread({
        id: "thread-acceptance",
        title: "Acceptance verification",
        originalRequest: "Implement and verify the worker task",
        kind: "coding",
        acceptanceCriteria: [
          "All worker nodes complete",
          "Validation evidence exists",
        ],
      });
      await registry.registerSession({
        threadId: "thread-acceptance",
        sessionId: "session-acceptance",
        framework: "codex",
        label: "acceptance-worker",
        originalTask: "Implement and validate",
        workdir: "/tmp/acceptance-worker",
        status: "completed",
        registeredAt: Date.now(),
        lastActivityAt: Date.now(),
        completionSummary: "Implemented and validated",
      });
      await registry.createTaskNode({
        id: "node-goal",
        threadId: "thread-acceptance",
        kind: "goal",
        status: "completed",
        title: "Deliver the work",
        instructions: "Deliver the work",
        acceptanceCriteria: [
          "All worker nodes complete",
          "Validation evidence exists",
        ],
      });
      await registry.createTaskNode({
        id: "node-worker",
        threadId: "thread-acceptance",
        parentNodeId: "node-goal",
        kind: "execution",
        status: "completed",
        title: "Implement the worker task",
        instructions: "Implement the worker task",
        requiredCapabilities: ["codex"],
        assignedSessionId: "session-acceptance",
        assignedLabel: "acceptance-worker",
        agentType: "codex",
        workdir: "/tmp/acceptance-worker",
      });
      await registry.createTaskVerifierJob({
        id: "verify-worker",
        threadId: "thread-acceptance",
        nodeId: "node-worker",
        status: "passed",
        verifierType: "task_completion",
        title: "Validate worker task",
        instructions: "Validate worker task",
      });
      await registry.recordTaskEvidence({
        threadId: "thread-acceptance",
        nodeId: "node-worker",
        sessionId: "session-acceptance",
        verifierJobId: "verify-worker",
        evidenceType: "validation_summary",
        title: "Validation passed",
        summary: "Validation confirmed the worker task completed.",
        content: { passed: true },
      });
      await registry.createTaskVerifierJob({
        id: "verify-acceptance",
        threadId: "thread-acceptance",
        nodeId: "node-goal",
        status: "pending",
        verifierType: "acceptance_criteria",
        title: "Verify acceptance",
        instructions: "Check acceptance criteria",
      });

      await runReadyTaskVerifiers(runtime, registry, "thread-acceptance");

      const detail = await registry.getThread("thread-acceptance");
      const acceptanceJob = detail?.verifierJobs.find(
        (job) => job.id === "verify-acceptance",
      );
      expect(acceptanceJob?.status).toBe("passed");
      const acceptanceArtifact = detail?.artifacts.find(
        (artifact) => artifact.artifactType === "acceptance_report",
      );
      expect(acceptanceArtifact?.path).toBeDefined();
      const reportPath = acceptanceArtifact?.path;
      if (!reportPath) {
        throw new Error("expected acceptance report path");
      }
      const report = JSON.parse(await readFile(reportPath, "utf8")) as {
        evaluation: { verdict: string };
      };
      expect(report.evaluation.verdict).toBe("pass");
    } finally {
      if (originalStateDir === undefined) {
        delete process.env.MILADY_STATE_DIR;
      } else {
        process.env.MILADY_STATE_DIR = originalStateDir;
      }
    }
  });

  it("fails acceptance verifier jobs deterministically when completion evidence is missing", async () => {
    const db = new PGlite();
    databases.push(db);
    const stateDir = await mkdtemp(path.join(tmpdir(), "acceptance-verifier-"));
    tempDirs.push(stateDir);
    const originalStateDir = process.env.MILADY_STATE_DIR;
    process.env.MILADY_STATE_DIR = stateDir;

    try {
      const useModel = jest.fn().mockResolvedValue(
        JSON.stringify({
          verdict: "pass",
          summary: "this should not be used",
          checklist: [],
        }),
      );
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
        useModel,
      } as unknown as IAgentRuntime;
      const registry = new TaskRegistry(runtime);
      await registry.ensureSchema();

      await registry.createThread({
        id: "thread-acceptance-fail",
        title: "Acceptance verification failure",
        originalRequest: "Implement and verify the worker task",
        kind: "coding",
        acceptanceCriteria: [
          "All worker nodes complete",
          "Validation evidence exists",
        ],
      });
      await registry.registerSession({
        threadId: "thread-acceptance-fail",
        sessionId: "session-acceptance-fail",
        framework: "codex",
        label: "acceptance-worker",
        originalTask: "Implement and validate",
        workdir: "/tmp/acceptance-worker",
        status: "completed",
        registeredAt: Date.now(),
        lastActivityAt: Date.now(),
        completionSummary: "Implemented but no verifier evidence recorded",
      });
      await registry.createTaskNode({
        id: "node-goal-fail",
        threadId: "thread-acceptance-fail",
        kind: "goal",
        status: "completed",
        title: "Deliver the work",
        instructions: "Deliver the work",
        acceptanceCriteria: [
          "All worker nodes complete",
          "Validation evidence exists",
        ],
      });
      await registry.createTaskNode({
        id: "node-worker-fail",
        threadId: "thread-acceptance-fail",
        parentNodeId: "node-goal-fail",
        kind: "execution",
        status: "completed",
        title: "Implement the worker task",
        instructions: "Implement the worker task",
        requiredCapabilities: ["codex"],
        assignedSessionId: "session-acceptance-fail",
        assignedLabel: "acceptance-worker",
        agentType: "codex",
        workdir: "/tmp/acceptance-worker",
      });
      await registry.createTaskVerifierJob({
        id: "verify-acceptance-fail",
        threadId: "thread-acceptance-fail",
        nodeId: "node-goal-fail",
        status: "pending",
        verifierType: "acceptance_criteria",
        title: "Verify acceptance",
        instructions: "Check acceptance criteria",
      });

      await runReadyTaskVerifiers(runtime, registry, "thread-acceptance-fail");

      const detail = await registry.getThread("thread-acceptance-fail");
      const acceptanceJob = detail?.verifierJobs.find(
        (job) => job.id === "verify-acceptance-fail",
      );
      expect(acceptanceJob?.status).toBe("failed");
      expect(useModel).not.toHaveBeenCalled();
      expect(
        detail?.nodes.find((node) => node.id === "node-goal-fail")?.status,
      ).toBe("failed");
    } finally {
      if (originalStateDir === undefined) {
        delete process.env.MILADY_STATE_DIR;
      } else {
        process.env.MILADY_STATE_DIR = originalStateDir;
      }
    }
  });
});
