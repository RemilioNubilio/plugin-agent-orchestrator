import { afterEach, beforeEach, describe, expect, it, jest } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import type { IAgentRuntime } from "@elizaos/core";

const { validateTaskCompletion } = await import(
  "../services/task-validation.js"
);

const PNG_BYTES = (() => {
  const bytes = new Uint8Array(1200);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  return bytes;
})();

function createThreadDetail() {
  return {
    id: "thread-1",
    title: "Fix provider failover",
    kind: "coding",
    status: "active",
    originalRequest: "Implement durable failover",
    summary: "Validator pending",
    sessionCount: 1,
    activeSessionCount: 1,
    latestSessionId: "session-1",
    latestSessionLabel: "failover-agent",
    latestWorkdir: "/workspace/project",
    latestRepo: "https://github.com/example/project",
    latestActivityAt: Date.now(),
    decisionCount: 2,
    createdAt: new Date("2026-04-06T00:00:00.000Z").toISOString(),
    updatedAt: new Date("2026-04-06T00:00:10.000Z").toISOString(),
    acceptanceCriteria: [
      "Persist all task state to the database",
      "Capture validation evidence",
    ],
    sessions: [],
    decisions: [
      {
        id: "decision-1",
        threadId: "thread-1",
        sessionId: "session-1",
        event: "turn_complete",
        promptText: "done",
        decision: "complete",
        response: null,
        reasoning: "Task appears finished",
        timestamp: Date.now(),
        createdAt: new Date().toISOString(),
      },
    ],
    events: [
      {
        id: "event-1",
        threadId: "thread-1",
        sessionId: "session-1",
        eventType: "validation_started",
        timestamp: Date.now(),
        summary: "Validation started",
        data: {},
        createdAt: new Date().toISOString(),
      },
    ],
    artifacts: [
      {
        id: "artifact-1",
        threadId: "thread-1",
        sessionId: "session-1",
        artifactType: "test_log",
        title: "Initial test log",
        path: "/tmp/test.log",
        uri: null,
        mimeType: "text/plain",
        metadata: {},
        createdAt: new Date().toISOString(),
      },
    ],
    transcripts: [
      {
        id: "transcript-1",
        threadId: "thread-1",
        sessionId: "session-1",
        timestamp: Date.now(),
        direction: "stdout",
        content: "Tests passed and screenshots captured.",
        metadata: {},
        createdAt: new Date().toISOString(),
      },
    ],
  };
}

describe("validateTaskCompletion", () => {
  let stateDir: string;
  let originalStateDir: string | undefined;
  let originalApiPort: string | undefined;
  let originalFetch: typeof globalThis.fetch | undefined;

  beforeEach(async () => {
    stateDir = await mkdtemp(path.join(tmpdir(), "task-validation-"));
    originalStateDir = process.env.MILADY_STATE_DIR;
    originalApiPort = process.env.MILADY_API_PORT;
    process.env.MILADY_STATE_DIR = stateDir;
    originalFetch = globalThis.fetch;
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(new Response(PNG_BYTES, { status: 200 })) as typeof fetch;
  });

  afterEach(async () => {
    if (originalStateDir === undefined) {
      delete process.env.MILADY_STATE_DIR;
    } else {
      process.env.MILADY_STATE_DIR = originalStateDir;
    }
    if (originalApiPort === undefined) {
      delete process.env.MILADY_API_PORT;
    } else {
      process.env.MILADY_API_PORT = originalApiPort;
    }
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    } else {
      delete (globalThis as { fetch?: typeof fetch }).fetch;
    }
    await rm(stateDir, { recursive: true, force: true });
  });

  it("writes a validation report and records screenshot and trajectory evidence", async () => {
    const runtime = {
      useModel: jest.fn().mockResolvedValue(
        JSON.stringify({
          verdict: "pass",
          summary: "Validation evidence confirms the task is complete.",
          checklist: ["Tests present", "Screenshot captured"],
        }),
      ),
      getService: jest.fn((name: string) =>
        name === "trajectory_logger"
          ? {
              listTrajectories: jest.fn().mockResolvedValue({
                trajectories: [
                  {
                    id: "traj-1",
                    status: "completed",
                    llmCallCount: 4,
                    createdAt: "2026-04-06T00:00:05.000Z",
                    metadata: {
                      orchestrator: {
                        sessionId: "session-1",
                        taskLabel: "failover-agent",
                      },
                    },
                  },
                ],
              }),
            }
          : null,
      ),
    } as unknown as IAgentRuntime;

    const result = await validateTaskCompletion(
      {
        runtime,
        taskRegistry: {
          getThread: jest.fn().mockResolvedValue(createThreadDetail()),
        },
      } as never,
      {
        sessionId: "session-1",
        taskCtx: {
          sessionId: "session-1",
          threadId: "thread-1",
          label: "failover-agent",
          originalTask: "Implement durable failover",
          workdir: "/workspace/project",
          repo: "https://github.com/example/project",
        } as never,
        completionReasoning: "All code paths and tests are finished.",
        completionSummary: "Implemented the feature and ran verification.",
        turnOutput: "All tests passed and the screenshot hook returned output.",
      },
    );

    expect(result.verdict).toBe("pass");
    expect(result.artifacts.map((artifact) => artifact.artifactType)).toEqual(
      expect.arrayContaining([
        "validation_report",
        "trajectory_link",
        "screenshot",
      ]),
    );

    const report = JSON.parse(await readFile(result.reportPath, "utf8")) as {
      verdict: string;
      evidence: {
        screenshot:
          | {
              status: "captured";
              fileIntegrityVerified: boolean;
              contentVerified: boolean;
              captureScope: string;
            }
          | { status: "unavailable"; reason: string };
        trajectories: Array<{ id: string }>;
      };
    };
    expect(report.verdict).toBe("pass");
    expect(report.evidence.screenshot.status).toBe("captured");
    if (report.evidence.screenshot.status !== "captured") {
      throw new Error("expected captured screenshot evidence");
    }
    expect(report.evidence.screenshot.fileIntegrityVerified).toBe(true);
    expect(report.evidence.screenshot.contentVerified).toBe(false);
    expect(report.evidence.screenshot.captureScope).toBe("desktop-fullscreen");
    expect(report.evidence.trajectories[0]?.id).toBe("traj-1");
  });

  it("uses the real loopback screenshot fetch path when the API endpoint is available", async () => {
    if (!originalFetch) {
      throw new Error("expected fetch to exist in this runtime");
    }
    globalThis.fetch = originalFetch;

    const server = await new Promise<Server>((resolve) => {
      const nextServer = createServer((req, res) => {
        if (req.url !== "/api/dev/cursor-screenshot") {
          res.statusCode = 404;
          res.end("not found");
          return;
        }
        res.writeHead(200, { "Content-Type": "image/png" });
        res.end(Buffer.from(PNG_BYTES));
      });
      nextServer.listen(0, "127.0.0.1", () => resolve(nextServer));
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("expected numeric loopback port");
      }
      process.env.MILADY_API_PORT = String(address.port);

      const runtime = {
        useModel: jest.fn().mockResolvedValue(
          JSON.stringify({
            verdict: "pass",
            summary: "Validation completed with loopback screenshot capture.",
          }),
        ),
        getService: jest.fn().mockReturnValue(null),
      } as unknown as IAgentRuntime;

      const result = await validateTaskCompletion(
        {
          runtime,
          taskRegistry: {
            getThread: jest.fn().mockResolvedValue(createThreadDetail()),
          },
        } as never,
        {
          sessionId: "session-loopback",
          taskCtx: {
            sessionId: "session-loopback",
            threadId: "thread-1",
            label: "loopback-agent",
            originalTask: "Verify screenshot capture",
            workdir: "/workspace/project",
          } as never,
          completionReasoning: "The endpoint should return a PNG.",
          completionSummary: "Captured a screenshot through the loopback dev API.",
          turnOutput: "Screenshot requested from /api/dev/cursor-screenshot.",
        },
      );

      const screenshotArtifact = result.artifacts.find(
        (artifact) => artifact.artifactType === "screenshot",
      );
      expect(screenshotArtifact?.path).toContain("screenshot-session-loopback-");
      expect(screenshotArtifact?.metadata).toMatchObject({
        captureScope: "desktop-fullscreen",
        contentVerified: false,
        fileIntegrityVerified: true,
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  });
});
