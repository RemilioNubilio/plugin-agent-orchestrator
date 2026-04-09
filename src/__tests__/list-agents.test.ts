/**
 * LIST_AGENTS action tests
 */

import { beforeEach, describe, expect, it, jest } from "bun:test";

type IAgentRuntime = import("@elizaos/core").IAgentRuntime;
type Memory = import("@elizaos/core").Memory;

const { listAgentsAction } = await import("../actions/list-agents.js");

const mockListSessions = jest.fn();

const createMockPTYService = (sessions: unknown[] = [], coordinator?: unknown) => ({
  listSessions: mockListSessions.mockResolvedValue(sessions),
  coordinator,
});

const createMockCoordinator = (tasks: unknown[] = [], pending = 0) => ({
  getAllTaskContexts: jest.fn().mockReturnValue(tasks),
  getPendingConfirmations: jest.fn().mockReturnValue(
    Array.from({ length: pending }, (_, index) => ({ id: index })),
  ),
  getSupervisionLevel: jest.fn().mockReturnValue("confirm"),
});

const createMockRuntime = (
  ptyService: unknown = null,
  coordinator: unknown = undefined,
) => ({
  getService: jest.fn((name: string) => {
    if (name === "PTY_SERVICE") return ptyService;
    if (name === "SWARM_COORDINATOR") return coordinator;
    return null;
  }),
  getSetting: jest.fn(),
});

const createMockMessage = () => ({
  id: "msg-123",
  userId: "user-456",
  content: {},
});

describe("listAgentsAction", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("action metadata", () => {
    it("should have the canonical name", () => {
      expect(listAgentsAction.name).toBe("LIST_AGENTS");
    });

    it("should preserve legacy and new similes", () => {
      expect(listAgentsAction.similes).toContain("LIST_CODING_AGENTS");
      expect(listAgentsAction.similes).toContain("SHOW_TASK_AGENTS");
    });

    it("should have no required parameters", () => {
      expect(listAgentsAction.parameters).toEqual([]);
    });
  });

  describe("validate", () => {
    it("returns true when PTYService is available", async () => {
      const result = await listAgentsAction.validate?.(
        createMockRuntime(createMockPTYService()) as unknown as IAgentRuntime,
        createMockMessage() as unknown as Memory,
      );
      expect(result).toBe(true);
    });

    it("returns false when PTYService is not available", async () => {
      const result = await listAgentsAction.validate?.(
        createMockRuntime(null) as unknown as IAgentRuntime,
        createMockMessage() as unknown as Memory,
      );
      expect(result).toBe(false);
    });
  });

  describe("handler", () => {
    it("lists active sessions", async () => {
      const sessions = [
        {
          id: "session-1",
          name: "alpha",
          agentType: "claude",
          status: "running",
          workdir: "/project/a",
          createdAt: new Date("2024-01-01T10:00:00Z"),
          lastActivityAt: new Date("2024-01-01T10:30:00Z"),
        },
      ];
      const callback = jest.fn();
      const result = await listAgentsAction.handler(
        createMockRuntime(createMockPTYService(sessions)) as unknown as IAgentRuntime,
        createMockMessage() as unknown as Memory,
        undefined,
        {},
        callback,
      );

      expect(result?.success).toBe(true);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("Active task agents"),
        }),
      );
    });

    it("denies Discord users without task-agent access", async () => {
      const callback = jest.fn();

      const result = await listAgentsAction.handler(
        createMockRuntime(createMockPTYService([])) as unknown as IAgentRuntime,
        {
          ...createMockMessage(),
          content: { source: "discord" },
        } as unknown as Memory,
        undefined,
        {},
        callback,
      );

      expect(result?.success).toBe(false);
      expect(result?.error).toBe("FORBIDDEN");
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("requires a verified OWNER or ADMIN role"),
        }),
      );
    });

    it("includes current task status from the coordinator", async () => {
      const tasks = [
        {
          sessionId: "session-1",
          agentType: "claude",
          label: "auth-fix",
          originalTask: "Fix the login bug",
          status: "active",
          decisions: [{ reasoning: "Investigating auth flow" }],
          registeredAt: 123,
        },
      ];
      const callback = jest.fn();
      const result = await listAgentsAction.handler(
        createMockRuntime(
          createMockPTYService([], createMockCoordinator(tasks, 1)),
          undefined,
        ) as unknown as IAgentRuntime,
        createMockMessage() as unknown as Memory,
        undefined,
        {},
        callback,
      );

      expect(result?.success).toBe(true);
      expect(result?.data).toEqual(
        expect.objectContaining({
          tasks: [
            expect.objectContaining({
              label: "auth-fix",
              status: "active",
            }),
          ],
          pendingConfirmations: 1,
        }),
      );
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("Current task status"),
        }),
      );
    });

    it("shows reusable agents when sessions are idle or between tasks", async () => {
      const sessions = [
        {
          id: "session-1",
          name: "research-agent",
          agentType: "codex",
          status: "ready",
          workdir: "/project/a",
          createdAt: new Date("2024-01-01T10:00:00Z"),
          lastActivityAt: new Date("2024-01-01T10:30:00Z"),
        },
      ];
      const callback = jest.fn();

      await listAgentsAction.handler(
        createMockRuntime(createMockPTYService(sessions)) as unknown as IAgentRuntime,
        createMockMessage() as unknown as Memory,
        undefined,
        {},
        callback,
      );

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("Reusable task agents"),
        }),
      );
    });

    it("shows a helpful message when nothing is running", async () => {
      const callback = jest.fn();
      const result = await listAgentsAction.handler(
        createMockRuntime(createMockPTYService([])) as unknown as IAgentRuntime,
        createMockMessage() as unknown as Memory,
        undefined,
        {},
        callback,
      );

      expect(result?.success).toBe(true);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("No active task agents"),
        }),
      );
    });

    it("returns false when PTYService is not available", async () => {
      const callback = jest.fn();
      const result = await listAgentsAction.handler(
        createMockRuntime(null) as unknown as IAgentRuntime,
        createMockMessage() as unknown as Memory,
        undefined,
        {},
        callback,
      );

      expect(result?.success).toBe(false);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("not available"),
        }),
      );
    });
  });
});
