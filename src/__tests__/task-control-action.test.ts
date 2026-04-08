import { beforeEach, describe, expect, it, jest } from "bun:test";

type IAgentRuntime = import("@elizaos/core").IAgentRuntime;
type Memory = import("@elizaos/core").Memory;
type State = import("@elizaos/core").State;

const { taskControlAction } = await import("../actions/task-control.js");

const mockPauseTaskThread = jest.fn();
const mockStopTaskThread = jest.fn();
const mockResumeTaskThread = jest.fn();
const mockContinueTaskThread = jest.fn();
const mockArchiveTaskThread = jest.fn();
const mockReopenTaskThread = jest.fn();
const mockListTaskThreads = jest.fn();
const mockFindThreadIdBySessionId = jest.fn();
const mockGetTaskThread = jest.fn();

function createRuntime() {
  return {
    agentId: "agent-1",
    getService: jest.fn((name: string) => {
      if (name === "PTY_SERVICE") {
        return {
          coordinator: {
            pauseTaskThread: mockPauseTaskThread,
            stopTaskThread: mockStopTaskThread,
            resumeTaskThread: mockResumeTaskThread,
            continueTaskThread: mockContinueTaskThread,
            archiveTaskThread: mockArchiveTaskThread,
            reopenTaskThread: mockReopenTaskThread,
            listTaskThreads: mockListTaskThreads,
            getTaskThread: mockGetTaskThread,
            taskRegistry: {
              findThreadIdBySessionId: mockFindThreadIdBySessionId,
            },
          },
        };
      }
      return null;
    }),
    getRoom: jest.fn().mockResolvedValue(null),
    getSetting: jest.fn(),
  };
}

function createMessage(text: string): Memory {
  return {
    id: "msg-1",
    roomId: "room-1",
    userId: "user-1",
    entityId: "user-1",
    content: { text, source: "client_chat" },
  } as unknown as Memory;
}

const defaultThread = {
  id: "thread-1",
  title: "Birthday site",
  status: "active",
  originalRequest: "Build the birthday website",
};

describe("taskControlAction", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListTaskThreads.mockResolvedValue([defaultThread]);
    mockGetTaskThread.mockResolvedValue(defaultThread);
    mockPauseTaskThread.mockResolvedValue({
      threadId: "thread-1",
      stoppedSessionIds: ["session-1"],
    });
    mockStopTaskThread.mockResolvedValue({
      threadId: "thread-1",
      stoppedSessionIds: ["session-1"],
    });
    mockResumeTaskThread.mockResolvedValue({
      threadId: "thread-1",
      sessionId: "session-2",
      reusedSession: false,
      framework: "codex",
    });
    mockContinueTaskThread.mockResolvedValue({
      threadId: "thread-1",
      sessionId: "session-1",
      reusedSession: true,
      framework: "codex",
    });
  });

  it("pauses the current task thread", async () => {
    const callback = jest.fn();
    const result = await taskControlAction.handler(
      createRuntime() as unknown as IAgentRuntime,
      createMessage("Hold on a second, can you pause that and let's discuss if it's right?"),
      undefined,
      {},
      callback,
    );

    expect(result?.success).toBe(true);
    expect(mockPauseTaskThread).toHaveBeenCalledWith(
      "thread-1",
      expect.stringContaining("pause"),
    );
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("Paused"),
      }),
    );
  });

  it("continues a thread from state when asked to continue", async () => {
    const callback = jest.fn();
    const result = await taskControlAction.handler(
      createRuntime() as unknown as IAgentRuntime,
      createMessage("Continue and add a remote link if you can."),
      { codingSession: { id: "session-1" } } as unknown as State,
      { parameters: { operation: "continue" } },
      callback,
    );

    expect(result?.success).toBe(true);
    expect(mockContinueTaskThread).toHaveBeenCalledWith(
      "thread-1",
      expect.stringContaining("Continue and add a remote link"),
      undefined,
    );
  });
});
