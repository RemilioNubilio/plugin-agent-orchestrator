/**
 * SEND_TO_AGENT action tests
 */

import { beforeEach, describe, expect, it, jest } from "bun:test";

type IAgentRuntime = import("@elizaos/core").IAgentRuntime;
type Memory = import("@elizaos/core").Memory;
type State = import("@elizaos/core").State;

const { sendToAgentAction } = await import("../actions/send-to-agent.js");

const mockSendToSession = jest.fn();
const mockSendKeysToSession = jest.fn();
const mockGetSession = jest.fn();
const mockListSessions = jest.fn();
const mockRegisterTask = jest.fn();
const mockSetTaskDelivered = jest.fn();

const createMockPTYService = (
  sessions: { id: string }[] = [],
  coordinator: unknown = undefined,
) => ({
  sendToSession: mockSendToSession,
  sendKeysToSession: mockSendKeysToSession,
  getSession: mockGetSession,
  listSessions: mockListSessions.mockReturnValue(sessions),
  coordinator,
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

describe("sendToAgentAction", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSendToSession.mockResolvedValue(undefined);
    mockSendKeysToSession.mockResolvedValue(undefined);
    mockRegisterTask.mockReset();
    mockSetTaskDelivered.mockReset();
    mockGetSession.mockReturnValue({
      id: "session-123",
      status: "running",
      agentType: "claude",
      workdir: "/tmp/session-123",
      metadata: { label: "research-agent" },
    });
  });

  describe("action metadata", () => {
    it("should have the canonical name", () => {
      expect(sendToAgentAction.name).toBe("SEND_TO_AGENT");
    });

    it("should preserve legacy and new similes", () => {
      expect(sendToAgentAction.similes).toContain("SEND_TO_CODING_AGENT");
      expect(sendToAgentAction.similes).toContain("MESSAGE_AGENT");
    });

    it("should define input and keys parameters", () => {
      const paramNames = (sendToAgentAction.parameters ?? []).map(
        (p) => p.name,
      );
      expect(paramNames).toContain("sessionId");
      expect(paramNames).toContain("input");
      expect(paramNames).toContain("keys");
    });
  });

  describe("validate", () => {
    it("returns true when PTYService has active sessions", async () => {
      const runtime = createMockRuntime(createMockPTYService([{ id: "session-123" }]));

      const result = await sendToAgentAction.validate?.(
        runtime as unknown as IAgentRuntime,
        createMockMessage() as unknown as Memory,
      );
      expect(result).toBe(true);
    });

    it("returns false when no active sessions", async () => {
      const runtime = createMockRuntime(createMockPTYService([]));

      const result = await sendToAgentAction.validate?.(
        runtime as unknown as IAgentRuntime,
        createMockMessage() as unknown as Memory,
      );
      expect(result).toBe(false);
    });
  });

  describe("handler", () => {
    it("sends text input to a session", async () => {
      const runtime = createMockRuntime(createMockPTYService([{ id: "session-123" }]));
      const callback = jest.fn();

      const result = await sendToAgentAction.handler(
        runtime as unknown as IAgentRuntime,
        createMockMessage({
          sessionId: "session-123",
          input: "yes",
        }) as unknown as Memory,
        undefined,
        {},
        callback,
      );

      expect(result?.success).toBe(true);
      expect(mockSendToSession).toHaveBeenCalledWith("session-123", "yes");
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("yes"),
        }),
      );
    });

    it("sends keys to a session", async () => {
      const runtime = createMockRuntime(createMockPTYService([{ id: "session-123" }]));

      const result = await sendToAgentAction.handler(
        runtime as unknown as IAgentRuntime,
        createMockMessage({
          sessionId: "session-123",
          keys: "Enter",
        }) as unknown as Memory,
        undefined,
        {},
        jest.fn(),
      );

      expect(result?.success).toBe(true);
      expect(mockSendKeysToSession).toHaveBeenCalledWith("session-123", "Enter");
    });

    it("accepts parameters from options", async () => {
      const runtime = createMockRuntime(createMockPTYService([{ id: "session-123" }]));

      await sendToAgentAction.handler(
        runtime as unknown as IAgentRuntime,
        createMockMessage({}) as unknown as Memory,
        undefined,
        { parameters: { sessionId: "session-123", input: "continue" } },
        jest.fn(),
      );

      expect(mockSendToSession).toHaveBeenCalledWith("session-123", "continue");
    });

    it("tracks a newly assigned task on an existing agent", async () => {
      const runtime = createMockRuntime(
        createMockPTYService([{ id: "session-123" }], {
          registerTask: mockRegisterTask,
          setTaskDelivered: mockSetTaskDelivered,
          getTaskContext: jest.fn().mockReturnValue({
            label: "existing-agent",
            repo: "https://github.com/example/repo",
          }),
        }),
      );

      const result = await sendToAgentAction.handler(
        runtime as unknown as IAgentRuntime,
        createMockMessage({
          sessionId: "session-123",
          task: "Research the benchmark harness and write a summary",
        }) as unknown as Memory,
        undefined,
        {},
        jest.fn(),
      );

      expect(result?.success).toBe(true);
      expect(mockSendToSession).toHaveBeenCalledWith(
        "session-123",
        "Research the benchmark harness and write a summary",
      );
      expect(mockRegisterTask).toHaveBeenCalledWith(
        "session-123",
        expect.objectContaining({
          threadId: "session-123",
          agentType: "claude",
          label: "existing-agent",
          originalTask: "Research the benchmark harness and write a summary",
          workdir: "/tmp/session-123",
          repo: "https://github.com/example/repo",
          metadata: expect.objectContaining({
            label: "research-agent",
          }),
        }),
      );
      expect(mockSetTaskDelivered).toHaveBeenCalledWith("session-123");
    });

    it("uses session from state if not specified", async () => {
      const runtime = createMockRuntime(createMockPTYService([{ id: "session-123" }]));

      await sendToAgentAction.handler(
        runtime as unknown as IAgentRuntime,
        createMockMessage({ input: "test" }) as unknown as Memory,
        { codingSession: { id: "session-123" } } as unknown as State,
        {},
        jest.fn(),
      );

      expect(mockSendToSession).toHaveBeenCalledWith("session-123", "test");
    });

    it("uses the most recent session if none is specified", async () => {
      const runtime = createMockRuntime(
        createMockPTYService([{ id: "session-1" }, { id: "session-2" }]),
      );

      await sendToAgentAction.handler(
        runtime as unknown as IAgentRuntime,
        createMockMessage({ input: "test" }) as unknown as Memory,
        undefined,
        {},
        jest.fn(),
      );

      expect(mockSendToSession).toHaveBeenCalledWith("session-2", "test");
    });

    it("returns an error when no sessions are available", async () => {
      const callback = jest.fn();
      const result = await sendToAgentAction.handler(
        createMockRuntime(createMockPTYService([])) as unknown as IAgentRuntime,
        createMockMessage({ input: "test" }) as unknown as Memory,
        undefined,
        {},
        callback,
      );

      expect(result?.success).toBe(false);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("No active"),
        }),
      );
    });

    it("returns an error when the session does not exist", async () => {
      mockGetSession.mockReturnValue(undefined);
      const callback = jest.fn();
      const result = await sendToAgentAction.handler(
        createMockRuntime(createMockPTYService([{ id: "other-session" }])) as unknown as IAgentRuntime,
        createMockMessage({
          sessionId: "nonexistent",
          input: "test",
        }) as unknown as Memory,
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

    it("returns an error when no input is provided", async () => {
      const callback = jest.fn();
      const result = await sendToAgentAction.handler(
        createMockRuntime(createMockPTYService([{ id: "session-123" }])) as unknown as IAgentRuntime,
        createMockMessage({ sessionId: "session-123" }) as unknown as Memory,
        undefined,
        {},
        callback,
      );

      expect(result?.success).toBe(false);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("input"),
        }),
      );
    });
  });
});
