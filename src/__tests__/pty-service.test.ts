/**
 * PTYService unit tests
 *
 * Tests PTY session management, event handling, and adapter registration.
 */

import { beforeEach, describe, expect, it, jest, mock } from "bun:test";

import type { IAgentRuntime } from "@elizaos/core";

// Track session count for unique IDs
let sessionCounter = 0;

// Shared mock manager instance
const mockManager = {
  spawn: jest.fn(),
  send: jest.fn(),
  get: jest.fn(),
  getSession: jest.fn(),
  stop: jest.fn(),
  logs: jest.fn(),
  list: jest.fn(),
  registerAdapter: jest.fn(),
  on: jest.fn(),
  removeListener: jest.fn(),
  shutdown: jest.fn(),
};

// Custom pty-manager mock required because PTYService instantiates the manager
// and calls methods on it — the preload's bare class stub is insufficient.
mock.module("pty-manager", () => ({
  PTYManager: class {
    constructor() {
      Object.assign(this, mockManager);
    }
  },
  BaseCLIAdapter: class {},
  ShellAdapter: class {},
  BunCompatiblePTYManager: class {
    constructor() {
      Object.assign(this, mockManager);
    }
  },
  isBun: () => false,
  extractTaskCompletionTraceRecords: () => [],
  buildTaskCompletionTimeline: () => ({}),
}));

// Dynamic import after mocks are registered
const { PTYService } = await import("../services/pty-service.js");
type PTYServiceConfig = import("../services/pty-service.js").PTYServiceConfig;

// Mock runtime
const createMockRuntime = (settings: Record<string, unknown> = {}) => ({
  getSetting: jest.fn((key: string) => settings[key]),
  getService: jest.fn(),
});

describe("PTYService", () => {
  let service: InstanceType<typeof PTYService>;

  beforeEach(async () => {
    sessionCounter = 0;
    jest.clearAllMocks();

    // Reset mock implementations
    mockManager.spawn.mockImplementation(() =>
      Promise.resolve({
        id: `session-${++sessionCounter}`,
        name: "test-session",
        type: "shell",
        status: "running",
        startedAt: new Date(),
        lastActivityAt: new Date(),
      }),
    );
    mockManager.send.mockResolvedValue(undefined);
    mockManager.stop.mockResolvedValue(undefined);
    mockManager.get.mockImplementation((id: string) => {
      if (id.startsWith("session-")) {
        return {
          id,
          name: "test-session",
          type: "shell",
          status: "running",
          startedAt: new Date(),
          lastActivityAt: new Date(),
        };
      }
      return undefined;
    });
    mockManager.getSession.mockImplementation((id: string) => {
      if (id.startsWith("session-")) {
        return { sendKeys: jest.fn() };
      }
      return undefined;
    });
    mockManager.list.mockReturnValue([]);
    mockManager.logs.mockImplementation(async function* () {
      yield "mock output line";
    });

    const runtime = createMockRuntime();
    service = await PTYService.start(runtime as unknown as IAgentRuntime);
  });

  describe("initialization", () => {
    it("should initialize with default config", async () => {
      expect(service).toBeInstanceOf(PTYService);
      expect(service.defaultApprovalPreset).toBe("autonomous");
    });

    it("should accept custom config from runtime settings", async () => {
      const customConfig: PTYServiceConfig = {
        maxLogLines: 2000,
        debug: true,
      };
      const runtime = createMockRuntime({ PTY_SERVICE_CONFIG: customConfig });
      const customService = await PTYService.start(
        runtime as unknown as IAgentRuntime,
      );
      expect(customService).toBeInstanceOf(PTYService);
    });

    it("should honor an explicit approval preset override from runtime settings", async () => {
      const runtime = createMockRuntime({
        PARALLAX_DEFAULT_APPROVAL_PRESET: "standard",
      });
      const customService = await PTYService.start(
        runtime as unknown as IAgentRuntime,
      );

      expect(customService.defaultApprovalPreset).toBe("standard");
    });

    it("pins the explicit default agent type in fixed mode", async () => {
      const runtime = createMockRuntime({
        PARALLAX_AGENT_SELECTION_STRATEGY: "fixed",
        PARALLAX_DEFAULT_AGENT_TYPE: "gemini",
      });
      const customService = await PTYService.start(
        runtime as unknown as IAgentRuntime,
      );

      expect(await customService.resolveAgentType({ task: "Fix the bug" })).toBe(
        "gemini",
      );
    });
  });

  describe("session management", () => {
    it("should spawn a session", async () => {
      const session = await service.spawnSession({
        name: "test-session",
        agentType: "shell",
        workdir: "/test/path",
      });

      expect(session).toBeDefined();
      expect(session.id).toMatch(/^session-\d+$/);
      expect(session.agentType).toBe("shell");
      expect(session.workdir).toBe("/test/path");
      expect(session.status).toBe("running");
    });

    it("should spawn session with initial task", async () => {
      // Spawn returns "ready" so the deferred task path fires immediately
      mockManager.spawn.mockImplementation(() =>
        Promise.resolve({
          id: `session-${++sessionCounter}`,
          name: "test-session",
          type: "shell",
          status: "ready",
          startedAt: new Date(),
          lastActivityAt: new Date(),
        }),
      );

      const session = await service.spawnSession({
        name: "test-session",
        agentType: "shell",
        workdir: "/test/path",
        initialTask: "Fix the bug",
      });

      expect(session).toBeDefined();
      expect(session.status).toBe("ready");

      // The initial task is deferred via setTimeout(300ms) settle delay
      await new Promise((r) => setTimeout(r, 400));
      expect(mockManager.send).toHaveBeenCalledWith(session.id, "Fix the bug");
    });

    it("should track session metadata", async () => {
      const session = await service.spawnSession({
        name: "test-session",
        agentType: "shell",
        workdir: "/test",
        metadata: { userId: "user-123", taskId: "task-456" },
      });

      expect(session.metadata).toEqual({
        userId: "user-123",
        taskId: "task-456",
        requestedType: "shell",
        agentType: "shell",
        coordinatorManaged: false,
      });
    });

    it("should get session by ID", async () => {
      const spawned = await service.spawnSession({
        name: "test-session",
        agentType: "shell",
        workdir: "/test",
      });

      const retrieved = service.getSession(spawned.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(spawned.id);
    });

    it("should return undefined for unknown session", () => {
      mockManager.get.mockReturnValueOnce(undefined);
      const session = service.getSession("unknown-id");
      expect(session).toBeUndefined();
    });

    it("should preserve terminal session state when the live session disappears", async () => {
      const spawned = await service.spawnSession({
        name: "test-session",
        agentType: "shell",
        workdir: "/test",
      });

      mockManager.get.mockReturnValueOnce({
        id: spawned.id,
        name: "test-session",
        type: "shell",
        status: "running",
        startedAt: new Date("2026-01-01T00:00:00Z"),
        lastActivityAt: new Date("2026-01-01T00:00:01Z"),
      });

      (
        service as unknown as {
          emitEvent: (sessionId: string, event: string, data: unknown) => void;
        }
      ).emitEvent(spawned.id, "error", { message: "worker crashed" });

      mockManager.get.mockReturnValue(undefined);
      const retrieved = service.getSession(spawned.id);
      expect(retrieved?.status).toBe("error");
      expect(retrieved?.name).toBe("test-session");
    });

    it("should list all sessions", async () => {
      // Mock list to return sessions after spawning
      mockManager.list.mockReturnValue([
        { id: "session-1", name: "a", type: "shell", status: "running" },
        { id: "session-2", name: "b", type: "shell", status: "running" },
      ]);

      await service.spawnSession({
        name: "a",
        agentType: "shell",
        workdir: "/a",
      });
      await service.spawnSession({
        name: "b",
        agentType: "shell",
        workdir: "/b",
      });

      const sessions = await service.listSessions();
      expect(sessions.length).toBe(2);
    });

    it("should stop a session", async () => {
      const session = await service.spawnSession({
        name: "test-session",
        agentType: "shell",
        workdir: "/test",
      });

      await service.stopSession(session.id);

      expect(mockManager.stop).toHaveBeenCalledWith(session.id);
    });

    it("should throw when stopping unknown session", async () => {
      mockManager.get.mockReturnValueOnce(undefined);
      await expect(service.stopSession("unknown-id")).rejects.toThrow();
    });
  });

  describe("session interaction", () => {
    it("should send input to session", async () => {
      const session = await service.spawnSession({
        name: "test-session",
        agentType: "shell",
        workdir: "/test",
      });

      await service.sendToSession(session.id, "hello");
      expect(mockManager.send).toHaveBeenCalledWith(session.id, "hello");
    });

    it("reconciles a busy Codex session to task_complete when output is stably complete", async () => {
      const sessionId = "session-codex-busy";
      const liveSession = {
        id: sessionId,
        name: "codex-session",
        type: "codex",
        status: "busy",
        startedAt: new Date(Date.now() - 10_000),
        lastActivityAt: new Date(),
      };
      mockManager.get.mockImplementation((id: string) =>
        id === sessionId ? liveSession : undefined,
      );
      jest
        .spyOn(service, "getSessionOutput")
        .mockResolvedValue(
          [
            "Planning the edits",
            "Worked for 8s",
            "Added SECOND_CODEX.txt (+1 -0)",
            "› Implement {feature}",
            "? for shortcuts",
          ].join("\n"),
        );
      (
        service as unknown as {
          sessionMetadata: Map<string, Record<string, unknown>>;
          sessionOutputBuffers: Map<string, string[]>;
          taskResponseMarkers: Map<string, number>;
          completionSignalSince: Map<string, number>;
          adapterCache: Map<string, Record<string, unknown>>;
          reconcileBusySessionFromOutput: (sessionId: string) => Promise<void>;
        }
      ).sessionMetadata.set(sessionId, {
        agentType: "codex",
        requestedType: "codex",
      });
      (
        service as unknown as {
          adapterCache: Map<string, Record<string, unknown>>;
        }
      ).adapterCache.set("codex", {
        detectLoading: () => false,
        detectLogin: () => ({ required: false }),
        detectBlockingPrompt: () => ({ detected: false }),
        detectTaskComplete: (output: string) =>
          output.includes("Added SECOND_CODEX.txt"),
        detectReady: () => false,
      });
      (
        service as unknown as {
          sessionOutputBuffers: Map<string, string[]>;
          taskResponseMarkers: Map<string, number>;
          completionSignalSince: Map<string, number>;
          reconcileBusySessionFromOutput: (sessionId: string) => Promise<void>;
        }
      ).sessionOutputBuffers.set(sessionId, [
        "Planning the edits",
        "Worked for 8s",
        "Added SECOND_CODEX.txt (+1 -0)",
        "› Implement {feature}",
        "? for shortcuts",
      ]);
      (
        service as unknown as {
          taskResponseMarkers: Map<string, number>;
        }
      ).taskResponseMarkers.set(sessionId, 0);
      (
        service as unknown as {
          completionSignalSince: Map<string, number>;
        }
      ).completionSignalSince.set(sessionId, Date.now() - 3000);

      const callback = jest.fn();
      service.onSessionEvent(callback);

      await (
        service as unknown as {
          reconcileBusySessionFromOutput: (sessionId: string) => Promise<void>;
        }
      ).reconcileBusySessionFromOutput(sessionId);

      expect(liveSession.status).toBe("ready");
      expect(callback).toHaveBeenCalledWith(
        sessionId,
        "task_complete",
        expect.objectContaining({
          source: "output_reconcile",
          response: expect.stringContaining("Added SECOND_CODEX.txt"),
        }),
      );
    });

    it("should throw when sending to unknown session", async () => {
      mockManager.get.mockReturnValueOnce(undefined);
      await expect(
        service.sendToSession("unknown-id", "hello"),
      ).rejects.toThrow();
    });

    it("should send keys to session", async () => {
      const session = await service.spawnSession({
        name: "test-session",
        agentType: "shell",
        workdir: "/test",
      });

      const mockSendKeys = jest.fn();
      mockManager.getSession.mockReturnValueOnce({ sendKeys: mockSendKeys });

      await service.sendKeysToSession(session.id, "Enter");
      expect(mockSendKeys).toHaveBeenCalledWith("Enter");
    });

    it("should get session output", async () => {
      const session = await service.spawnSession({
        name: "test-session",
        agentType: "shell",
        workdir: "/test",
      });

      const output = await service.getSessionOutput(session.id);
      expect(output).toContain("mock output");
    });
  });

  describe("session status", () => {
    it("should track blocked status", async () => {
      const session = await service.spawnSession({
        name: "test-session",
        agentType: "shell",
        workdir: "/test",
      });

      expect(service.isSessionBlocked(session.id)).toBe(false);
    });

    it("should return false for unknown session blocked check", () => {
      expect(service.isSessionBlocked("unknown-id")).toBe(false);
    });

    it("should include pi in supported agent types", () => {
      expect(service.getSupportedAgentTypes()).toContain("pi");
    });
  });

  describe("event handling", () => {
    it("should register event callbacks", async () => {
      const callback = jest.fn();
      service.onSessionEvent(callback);

      // Callback should be registered (not called yet)
      expect(callback).not.toHaveBeenCalled();
    });

    it("emits normalized coordinator events with source-aware payloads", async () => {
      const callback = jest.fn();
      service.onNormalizedSessionEvent(callback);

      (
        service as unknown as {
          emitEvent: (sessionId: string, event: string, data: unknown) => void;
        }
      ).emitEvent("session-1", "blocked", {
        promptInfo: { prompt: "Approve file edit?", type: "permission" },
        autoResponded: false,
        source: "pty_manager",
      });

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "session-1",
          name: "blocked",
          source: "pty_manager",
          promptText: "Approve file edit?",
          promptType: "permission",
          autoResponded: false,
        }),
      );
    });

    it("suppresses false blocked events when PTY prompt text is just working status noise", () => {
      const rawCallback = jest.fn();
      const normalizedCallback = jest.fn();
      service.onSessionEvent(rawCallback);
      service.onNormalizedSessionEvent(normalizedCallback);

      (
        service as unknown as {
          emitEvent: (sessionId: string, event: string, data: unknown) => void;
        }
      ).emitEvent("session-1", "blocked", {
        promptInfo: {
          prompt:
            "• Working (11s • esc to interrupt) › Find and fix a bug in @filename gpt-5.4 xhigh · 97% left · /private/var/folders/example",
          type: "unknown",
        },
        autoResponded: false,
        source: "pty_manager",
      });

      expect(rawCallback).not.toHaveBeenCalled();
      expect(normalizedCallback).not.toHaveBeenCalled();
    });

    it("marks hook events with the hook source in the normalized stream", () => {
      const callback = jest.fn();
      service.onNormalizedSessionEvent(callback);

      service.handleHookEvent("session-1", "task_complete", {
        response: "done",
      });

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "session-1",
          name: "task_complete",
          source: "hook",
          response: "done",
        }),
      );
    });
  });

  describe("adapter registration", () => {
    it("should register custom adapters", async () => {
      const customAdapter = { type: "custom" };

      expect(() => service.registerAdapter(customAdapter)).not.toThrow();
      expect(mockManager.registerAdapter).toHaveBeenCalledWith(customAdapter);
    });
  });
});
