/**
 * Opt-in live smoke tests for real Claude Code and Codex sessions.
 *
 * These are skipped by default. Run with:
 *   ORCHESTRATOR_LIVE=1 bun test src/__tests__/task-agent-live.e2e.test.ts
 */

import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { IAgentRuntime } from "@elizaos/core";

const RUN_LIVE = process.env.ORCHESTRATOR_LIVE === "1";
const liveDescribe = RUN_LIVE ? describe : describe.skip;

const { PTYService } = await import("../services/pty-service.js");
const { listAgentsAction } = await import("../actions/list-agents.js");

function createRuntime(settings: Record<string, unknown> = {}) {
  const services = new Map<string, unknown[]>();
  return {
    services,
    getSetting(key: string) {
      return settings[key];
    },
    getService(name: string) {
      return services.get(name)?.[0] ?? null;
    },
  };
}

async function waitFor(
  check: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs: number,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}

function buildFailureDiagnostic(
  agentType: "claude" | "codex",
  message: string,
  events: Array<{ event: string; data: unknown }>,
): Error {
  const eventSummary = events
    .slice(-10)
    .map((entry) => `${entry.event}: ${JSON.stringify(entry.data)}`)
    .join("\n");
  const diagnostic = eventSummary ? `\nRecent events:\n${eventSummary}` : "";
  return new Error(`${agentType} live smoke failed: ${message}${diagnostic}`);
}

async function runLiveFrameworkSmoke(
  agentType: "claude" | "codex",
  fileContents: string,
): Promise<void> {
  const workdir = fs.mkdtempSync(
    path.join(os.tmpdir(), `plugin-agent-orchestrator-${agentType}-`),
  );
  const runtime = createRuntime({
    SERVER_PORT: "31337",
  });
  const service = await PTYService.start(runtime as unknown as IAgentRuntime);
  runtime.services.set("PTY_SERVICE", [service]);

  const events: Array<{ event: string; data: unknown }> = [];
  const unsubscribe = service.onSessionEvent((_sessionId, event, data) => {
    events.push({ event, data });
  });

  const liveFileName = `LIVE_SMOKE_${agentType.toUpperCase()}.txt`;
  const liveFilePath = path.join(workdir, liveFileName);
  const sentinel = `LIVE_SMOKE_${agentType.toUpperCase()}_DONE`;

  try {
    const [preflight] = await service.checkAvailableAgents([agentType]);
    expect(preflight?.installed).toBe(true);

    const session = await service.spawnSession({
      name: `live-${agentType}`,
      agentType,
      workdir,
      approvalPreset: "autonomous",
      initialTask:
        `Create a file named ${liveFileName} in the current directory containing exactly "${fileContents}". ` +
        `Then print exactly "${sentinel}". Do not ask follow-up questions.`,
    });

    let listResult:
      | Awaited<ReturnType<typeof listAgentsAction.handler>>
      | undefined;
    await waitFor(async () => {
      listResult = await listAgentsAction.handler(
        runtime as unknown as IAgentRuntime,
        {} as never,
      );
      if (!listResult?.success) {
        return false;
      }
      const sessions = Array.isArray(listResult.data?.sessions)
        ? listResult.data.sessions
        : [];
      return sessions.some((entry) => entry.id === session.id);
    }, 30_000, 1_000);

    expect(listResult?.text).toContain(session.id);
    expect(listResult?.text).toContain(agentType);

    await waitFor(async () => {
      const sessionInfo = service.getSession(session.id);
      const recentLoginRequired = events.findLast(
        (entry) => entry.event === "login_required",
      );
      if (recentLoginRequired) {
        const details = recentLoginRequired.data as {
          instructions?: string;
          url?: string;
        };
        throw buildFailureDiagnostic(
          agentType,
          details.instructions || "framework authentication is required",
          events,
        );
      }
      if (sessionInfo?.status === "stopped" || sessionInfo?.status === "error") {
        const output = await service.getSessionOutput(session.id, 200);
        throw buildFailureDiagnostic(
          agentType,
          `session ended early with status ${sessionInfo.status}. Output: ${output.slice(-600)}`,
          events,
        );
      }
      if (!fs.existsSync(liveFilePath)) {
        return false;
      }
      const fileText = fs.readFileSync(liveFilePath, "utf8").trim();
      if (fileText !== fileContents) {
        return false;
      }
      const output = await service.getSessionOutput(session.id, 200);
      return output.includes(sentinel);
    }, 6 * 60 * 1000, 3000);

    expect(fs.readFileSync(liveFilePath, "utf8").trim()).toBe(fileContents);
    expect(events.length).toBeGreaterThan(0);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(`${agentType} live smoke failed:`)) {
      throw error;
    }
    throw buildFailureDiagnostic(
      agentType,
      error instanceof Error ? error.message : String(error),
      events,
    );
  } finally {
    unsubscribe();
    await service.stop();
    fs.rmSync(workdir, { recursive: true, force: true });
  }
}

liveDescribe("task-agent live smoke", () => {
  it(
    "executes a Claude Code task end-to-end",
    async () => {
      await runLiveFrameworkSmoke("claude", "claude-ok");
    },
    8 * 60 * 1000,
  );

  it(
    "executes a Codex task end-to-end",
    async () => {
      await runLiveFrameworkSmoke("codex", "codex-ok");
    },
    8 * 60 * 1000,
  );
});
