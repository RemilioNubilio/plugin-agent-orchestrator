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
});
