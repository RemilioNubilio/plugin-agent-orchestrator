import { PGlite } from "@electric-sql/pglite";
import type { AgentRuntime } from "@elizaos/core";
import { rm } from "node:fs/promises";

type SqlQuery = {
  queryChunks?: Array<{ value?: unknown }>;
};

function extractSqlText(query: SqlQuery): string {
  if (!Array.isArray(query.queryChunks)) {
    return "";
  }

  return query.queryChunks
    .map((chunk) => {
      const value = chunk?.value;
      if (Array.isArray(value)) {
        return value.join("");
      }
      return String(value ?? "");
    })
    .join("");
}

function createRuntime(db: PGlite): AgentRuntime {
  return {
    agentId: "task-registry-test-agent",
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
  } as unknown as AgentRuntime;
}

export async function createTestRuntime(options?: {
  pgliteDir?: string;
  removePgliteDirOnCleanup?: boolean;
}): Promise<{
  runtime: AgentRuntime;
  cleanup: () => Promise<void>;
}> {
  const db = options?.pgliteDir
    ? new PGlite(options.pgliteDir)
    : new PGlite();

  const runtime = createRuntime(db);

  return {
    runtime,
    cleanup: async () => {
      await db.close();
      if (options?.pgliteDir && options.removePgliteDirOnCleanup !== false) {
        await rm(options.pgliteDir, { recursive: true, force: true });
      }
    },
  };
}
