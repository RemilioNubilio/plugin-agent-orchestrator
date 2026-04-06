/**
 * STOP_AGENT action tests
 */

import { beforeEach, describe, expect, it, jest } from "bun:test";
import type { IAgentRuntime, Memory, State } from "@elizaos/core";

const { stopAgentAction } = await import("../actions/stop-agent.js");

const mockStopSession = jest.fn();
const mockGetSession = jest.fn();
const mockListSessions = jest.fn();

const createMockPTYService = (sessions: { id: string }[] = []) => ({
  stopSession: mockStopSession,
  getSession: mockGetSession,
  listSessions: mockListSessions.mockReturnValue(sessions),
});

const createMockRuntime = (ptyService: unknown = null) => ({
  getService: jest.fn((name: string) => {
    if (name === "PTY_SERVICE") return ptyService;
    return null;
  }),
});

const createMockMessage = (content: Record<string, unknown> = {}) => ({
  id: "msg-123",
  userId: "user-456",
  content,
});

describe("stopAgentAction", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStopSession.mockResolvedValue(undefined);
    mockGetSession.mockReturnValue({
      id: "session-123",
      agentType: "claude",
      status: "running",
    });
  });

  describe("action metadata", () => {
    it("should have the canonical name", () => {
      expect(stopAgentAction.name).toBe("STOP_AGENT");
    });

    it("should preserve legacy and new similes", () => {
      expect(stopAgentAction.similes).toContain("STOP_CODING_AGENT");
      expect(stopAgentAction.similes).toContain("CANCEL_TASK_AGENT");
    });

    it("should define parameters", () => {
      const paramNames = (stopAgentAction.parameters ?? []).map((p) => p.name);
      expect(paramNames).toContain("sessionId");
      expect(paramNames).toContain("all");
    });
  });

  describe("validate", () => {
    it("returns true when sessions exist", async () => {
      const result = await stopAgentAction.validate?.(
        createMockRuntime(createMockPTYService([{ id: "session-123" }])) as unknown as IAgentRuntime,
        createMockMessage() as unknown as Memory,
      );
      expect(result).toBe(true);
    });

    it("returns false when no sessions exist", async () => {
      const result = await stopAgentAction.validate?.(
        createMockRuntime(createMockPTYService([])) as unknown as IAgentRuntime,
        createMockMessage() as unknown as Memory,
      );
      expect(result).toBe(false);
    });
  });

  describe("handler", () => {
    it("stops a specific session", async () => {
      const callback = jest.fn();
      const result = await stopAgentAction.handler(
        createMockRuntime(createMockPTYService([{ id: "session-123" }])) as unknown as IAgentRuntime,
        createMockMessage({ sessionId: "session-123" }) as unknown as Memory,
        undefined,
        {},
        callback,
      );

      expect(result?.success).toBe(true);
      expect(mockStopSession).toHaveBeenCalledWith("session-123");
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("Stopped"),
        }),
      );
    });

    it("stops session from state", async () => {
      await stopAgentAction.handler(
        createMockRuntime(createMockPTYService([{ id: "session-123" }])) as unknown as IAgentRuntime,
        createMockMessage({}) as unknown as Memory,
        { codingSession: { id: "session-123" } } as unknown as State,
        {},
        jest.fn(),
      );

      expect(mockStopSession).toHaveBeenCalledWith("session-123");
    });

    it("clears session from state after stopping", async () => {
      const state: Record<string, unknown> = {
        codingSession: { id: "session-123" },
      };

      await stopAgentAction.handler(
        createMockRuntime(createMockPTYService([{ id: "session-123" }])) as unknown as IAgentRuntime,
        createMockMessage({ sessionId: "session-123" }) as unknown as Memory,
        state as unknown as State,
        {},
        jest.fn(),
      );

      expect(state.codingSession).toBeUndefined();
    });

    it("stops all sessions when all=true", async () => {
      const callback = jest.fn();
      const result = await stopAgentAction.handler(
        createMockRuntime(
          createMockPTYService([
            { id: "session-1" },
            { id: "session-2" },
            { id: "session-3" },
          ]),
        ) as unknown as IAgentRuntime,
        createMockMessage({ all: true }) as unknown as Memory,
        undefined,
        {},
        callback,
      );

      expect(result?.success).toBe(true);
      expect(mockStopSession).toHaveBeenCalledTimes(3);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("3"),
        }),
      );
    });

    it("accepts all=true from options", async () => {
      await stopAgentAction.handler(
        createMockRuntime(
          createMockPTYService([{ id: "session-1" }, { id: "session-2" }]),
        ) as unknown as IAgentRuntime,
        createMockMessage({}) as unknown as Memory,
        undefined,
        { parameters: { all: true } },
        jest.fn(),
      );

      expect(mockStopSession).toHaveBeenCalledTimes(2);
    });

    it("handles stopping the most recent session when none is specified", async () => {
      mockGetSession.mockReturnValue({ id: "session-2", agentType: "shell" });

      await stopAgentAction.handler(
        createMockRuntime(
          createMockPTYService([{ id: "session-1" }, { id: "session-2" }]),
        ) as unknown as IAgentRuntime,
        createMockMessage({}) as unknown as Memory,
        undefined,
        {},
        jest.fn(),
      );

      expect(mockStopSession).toHaveBeenCalledWith("session-2");
    });

    it("returns success when no sessions are active", async () => {
      const callback = jest.fn();
      const result = await stopAgentAction.handler(
        createMockRuntime(createMockPTYService([])) as unknown as IAgentRuntime,
        createMockMessage({}) as unknown as Memory,
        undefined,
        {},
        callback,
      );

      expect(result?.success).toBe(true);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("No active"),
        }),
      );
    });

    it("handles session not found", async () => {
      mockGetSession.mockReturnValue(undefined);
      const callback = jest.fn();
      const result = await stopAgentAction.handler(
        createMockRuntime(createMockPTYService([{ id: "other" }])) as unknown as IAgentRuntime,
        createMockMessage({ sessionId: "nonexistent" }) as unknown as Memory,
        undefined,
        {},
        callback,
      );

      expect(result?.success).toBe(false);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("not found"),
        }),
      );
    });
  });
});
