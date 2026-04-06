/**
 * Opt-in live smoke tests for real Claude Code and Codex sessions.
 *
 * These are skipped by default. Run with:
 *   ORCHESTRATOR_LIVE=1 bun test src/__tests__/task-agent-live.e2e.test.ts
 */

import { createServer, type Server } from "node:http";
import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import type { IAgentRuntime } from "@elizaos/core";

const RUN_LIVE = process.env.ORCHESTRATOR_LIVE === "1";
const liveDescribe = RUN_LIVE ? describe : describe.skip;

const { PTYService } = await import("../services/pty-service.js");
const { listAgentsAction } = await import("../actions/list-agents.js");
const { spawnAgentAction } = await import("../actions/spawn-agent.js");
const { sendToAgentAction } = await import("../actions/send-to-agent.js");

function createRuntime(settings: Record<string, unknown> = {}) {
  const services = new Map<string, unknown[]>();
  return {
    services,
    getSetting(key: string) {
      return settings[key] ?? process.env[key];
    },
    getService(name: string) {
      return services.get(name)?.[0] ?? null;
    },
  };
}

function createMessage(content: Record<string, unknown>) {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    userId: "live-user",
    roomId: "live-room",
    createdAt: Date.now(),
    content,
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
    .slice(-15)
    .map((entry) => `${entry.event}: ${JSON.stringify(entry.data)}`)
    .join("\n");
  const diagnostic = eventSummary ? `\nRecent events:\n${eventSummary}` : "";
  return new Error(`${agentType} live smoke failed: ${message}${diagnostic}`);
}

function ensureLiveBaseDir(): string {
  const baseDir = path.join(process.cwd(), ".tmp-live");
  fs.mkdirSync(baseDir, { recursive: true });
  return baseDir;
}

function createWorkdir(agentType: "claude" | "codex", label: string): string {
  return fs.mkdtempSync(
    path.join(ensureLiveBaseDir(), `plugin-agent-orchestrator-${agentType}-${label}-`),
  );
}

async function getFreePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Failed to allocate an ephemeral port");
  }
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function startReferenceServer(html: string): Promise<{
  server: Server;
  url: string;
}> {
  const port = await getFreePort();
  const server = createServer((_, res) => {
    res.statusCode = 200;
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(html);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  return {
    server,
    url: `http://127.0.0.1:${port}/reference.html`,
  };
}

async function waitForTrackedSession(
  runtime: ReturnType<typeof createRuntime>,
  sessionId: string,
  expectedAgentType: "claude" | "codex",
): Promise<void> {
  let listResult:
    | Awaited<ReturnType<typeof listAgentsAction.handler>>
    | undefined;
  await waitFor(async () => {
    listResult = await listAgentsAction.handler(
      runtime as unknown as IAgentRuntime,
      createMessage({}) as never,
    );
    if (!listResult?.success) {
      return false;
    }
    const sessions = Array.isArray(listResult.data?.sessions)
      ? listResult.data.sessions
      : [];
    const tasks = Array.isArray(listResult.data?.tasks)
      ? listResult.data.tasks
      : [];
    return (
      sessions.some((entry) => entry.id === sessionId) &&
      tasks.some(
        (entry) =>
          entry.sessionId === sessionId && entry.agentType === expectedAgentType,
      )
    );
  }, 45_000, 1_000);

  expect(listResult?.text).toContain(sessionId);
  expect(listResult?.text).toContain(expectedAgentType);
}

async function runLiveFrameworkSequentialTaskSmoke(
  agentType: "claude" | "codex",
): Promise<void> {
  const workdir = createWorkdir(agentType, "reuse");
  const runtime = createRuntime({ SERVER_PORT: "31337" });
  const service = await PTYService.start(runtime as unknown as IAgentRuntime);
  runtime.services.set("PTY_SERVICE", [service]);

  const events: Array<{ event: string; data: unknown }> = [];
  const unsubscribe = service.onSessionEvent((_sessionId, event, data) => {
    events.push({ event, data });
  });

  const firstFileName = `FIRST_${agentType.toUpperCase()}.txt`;
  const secondFileName = `SECOND_${agentType.toUpperCase()}.txt`;
  const firstFilePath = path.join(workdir, firstFileName);
  const secondFilePath = path.join(workdir, secondFileName);
  const firstSentinel = `LIVE_REUSE_${agentType.toUpperCase()}_FIRST_DONE`;
  const secondSentinel = `LIVE_REUSE_${agentType.toUpperCase()}_SECOND_DONE`;
  const callbackMessages: string[] = [];

  try {
    const [preflight] = await service.checkAvailableAgents([agentType]);
    expect(preflight?.installed).toBe(true);

    const spawnResult = await spawnAgentAction.handler(
      runtime as unknown as IAgentRuntime,
      createMessage({
        agentType,
        workdir,
        task:
          `Create a file named ${firstFileName} in the current directory containing exactly "${agentType}-first". ` +
          `Then print exactly "${firstSentinel}". Do not ask follow-up questions.`,
      }) as never,
      undefined,
      {},
      async (content) => {
        if (typeof content?.text === "string") callbackMessages.push(content.text);
      },
    );

    if (!spawnResult?.success || !spawnResult.data?.sessionId) {
      throw new Error(spawnResult?.error ?? "spawn action did not return a session ID");
    }

    const sessionId = String(spawnResult.data.sessionId);
    await waitForTrackedSession(runtime, sessionId, agentType);

    await waitFor(async () => {
      const sessionInfo = service.getSession(sessionId);
      if (!sessionInfo) {
        throw buildFailureDiagnostic(
          agentType,
          "session disappeared before completing the first task",
          events,
        );
      }
      const recentLoginRequired = events.findLast(
        (entry) => entry.event === "login_required",
      );
      if (recentLoginRequired) {
        const details = recentLoginRequired.data as {
          instructions?: string;
        };
        throw buildFailureDiagnostic(
          agentType,
          details.instructions || "framework authentication is required",
          events,
        );
      }
      if (sessionInfo?.status === "stopped" || sessionInfo?.status === "error") {
        const output = await service.getSessionOutput(sessionId, 200);
        throw buildFailureDiagnostic(
          agentType,
          `session ended early with status ${sessionInfo.status}. Output: ${output.slice(-600)}`,
          events,
        );
      }
      if (!fs.existsSync(firstFilePath)) return false;
      const fileText = fs.readFileSync(firstFilePath, "utf8").trim();
      if (fileText !== `${agentType}-first`) return false;
      const output = await service.getSessionOutput(sessionId, 200);
      return output.includes(firstSentinel);
    }, 6 * 60 * 1000, 3000);

    const sendResult = await sendToAgentAction.handler(
      runtime as unknown as IAgentRuntime,
      createMessage({
        sessionId,
        task:
          `Now create a second file named ${secondFileName} containing exactly "${agentType}-second". ` +
          `Then print exactly "${secondSentinel}". Stay available for more work afterward and do not ask follow-up questions.`,
      }) as never,
      undefined,
      {},
      async (content) => {
        if (typeof content?.text === "string") callbackMessages.push(content.text);
      },
    );

    expect(sendResult?.success).toBe(true);

    await waitFor(async () => {
      if (!fs.existsSync(secondFilePath)) return false;
      const fileText = fs.readFileSync(secondFilePath, "utf8").trim();
      if (fileText !== `${agentType}-second`) return false;
      const output = await service.getSessionOutput(sessionId, 300);
      return output.includes(secondSentinel);
    }, 6 * 60 * 1000, 3000);

    const finalList = await listAgentsAction.handler(
      runtime as unknown as IAgentRuntime,
      createMessage({}) as never,
    );
    expect(finalList?.success).toBe(true);
    expect(finalList?.text).toContain(sessionId);
    expect(fs.readFileSync(firstFilePath, "utf8").trim()).toBe(`${agentType}-first`);
    expect(fs.readFileSync(secondFilePath, "utf8").trim()).toBe(`${agentType}-second`);
    expect(callbackMessages.some((text) => text.includes("Assigned new tracked task"))).toBe(true);
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

async function runLiveFrameworkWebTaskSmoke(
  agentType: "claude" | "codex",
): Promise<void> {
  const workdir = createWorkdir(agentType, "web");
  const runtime = createRuntime({ SERVER_PORT: "31337" });
  const service = await PTYService.start(runtime as unknown as IAgentRuntime);
  runtime.services.set("PTY_SERVICE", [service]);

  const events: Array<{ event: string; data: unknown }> = [];
  const unsubscribe = service.onSessionEvent((_sessionId, event, data) => {
    events.push({ event, data });
  });

  const agentPort = await getFreePort();
  const serveSentinel = `LIVE_WEB_${agentType.toUpperCase()}_READY`;
  const reference = await startReferenceServer(`<!doctype html>
<html>
  <body>
    <h1>Milady Benchmark Ready</h1>
    <p>Task agents stay reusable.</p>
    <p>Codex and Claude Code should both handle research and serving tasks.</p>
  </body>
</html>`);
  const callbackMessages: string[] = [];

  try {
    const [preflight] = await service.checkAvailableAgents([agentType]);
    expect(preflight?.installed).toBe(true);

    const spawnResult = await spawnAgentAction.handler(
      runtime as unknown as IAgentRuntime,
      createMessage({
        agentType,
        workdir,
        task:
          `Open the reference page at ${reference.url} and read it using your web or browser tools. ` +
          `Create an index.html in the current directory that includes the exact phrases "Milady Benchmark Ready" and "Task agents stay reusable." ` +
          `Then start a local HTTP server in the background from the current directory with ` +
          `"python3 -m http.server ${agentPort} >/tmp/${serveSentinel}.log 2>&1 & echo $! > server.pid", ` +
          `print exactly "${serveSentinel}", and keep the server available until I stop you. ` +
          `Do not ask follow-up questions.`,
      }) as never,
      undefined,
      {},
      async (content) => {
        if (typeof content?.text === "string") callbackMessages.push(content.text);
      },
    );

    if (!spawnResult?.success || !spawnResult.data?.sessionId) {
      throw new Error(spawnResult?.error ?? "spawn action did not return a session ID");
    }

    const sessionId = String(spawnResult.data.sessionId);
    await waitForTrackedSession(runtime, sessionId, agentType);

    await waitFor(async () => {
      const sessionInfo = service.getSession(sessionId);
      if (!sessionInfo) {
        throw buildFailureDiagnostic(
          agentType,
          "session disappeared before completing the web task",
          events,
        );
      }
      const recentLoginRequired = events.findLast(
        (entry) => entry.event === "login_required",
      );
      if (recentLoginRequired) {
        const details = recentLoginRequired.data as {
          instructions?: string;
        };
        throw buildFailureDiagnostic(
          agentType,
          details.instructions || "framework authentication is required",
          events,
        );
      }
      if (sessionInfo?.status === "stopped" || sessionInfo?.status === "error") {
        const output = await service.getSessionOutput(sessionId, 200);
        throw buildFailureDiagnostic(
          agentType,
          `web task ended early with status ${sessionInfo.status}. Output: ${output.slice(-600)}`,
          events,
        );
      }
      const output = await service.getSessionOutput(sessionId, 400);
      if (!output.includes(serveSentinel)) return false;
      try {
        const response = await fetch(`http://127.0.0.1:${agentPort}/index.html`);
        if (!response.ok) return false;
        const html = await response.text();
        return (
          html.includes("Milady Benchmark Ready") &&
          html.includes("Task agents stay reusable.")
        );
      } catch {
        return false;
      }
    }, 6 * 60 * 1000, 3000);

    const finalList = await listAgentsAction.handler(
      runtime as unknown as IAgentRuntime,
      createMessage({}) as never,
    );
    expect(finalList?.success).toBe(true);
    expect(finalList?.text).toContain(sessionId);
    expect(callbackMessages.length).toBeGreaterThan(0);
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
    await new Promise<void>((resolve) => reference.server.close(() => resolve()));
    await service.stop();
    fs.rmSync(workdir, { recursive: true, force: true });
  }
}

liveDescribe("task-agent live smoke", () => {
  it(
    "keeps a Claude Code session alive across sequential tracked tasks",
    async () => {
      await runLiveFrameworkSequentialTaskSmoke("claude");
    },
    12 * 60 * 1000,
  );

  it(
    "keeps a Codex session alive across sequential tracked tasks",
    async () => {
      await runLiveFrameworkSequentialTaskSmoke("codex");
    },
    12 * 60 * 1000,
  );

  it(
    "has Claude Code research a page and serve a generated webpage",
    async () => {
      await runLiveFrameworkWebTaskSmoke("claude");
    },
    12 * 60 * 1000,
  );

  it(
    "has Codex research a page and serve a generated webpage",
    async () => {
      await runLiveFrameworkWebTaskSmoke("codex");
    },
    12 * 60 * 1000,
  );
});
