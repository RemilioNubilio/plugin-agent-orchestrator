import { beforeEach, describe, expect, it, jest } from "bun:test";

type IAgentRuntime = import("@elizaos/core").IAgentRuntime;
type Memory = import("@elizaos/core").Memory;

const { taskHistoryAction } = await import("../actions/task-history.js");

const mockCountTaskThreads = jest.fn();
const mockListTaskThreads = jest.fn();
const mockGetTaskThread = jest.fn();

function createRuntime() {
  return {
    agentId: "agent-1",
    getService: jest.fn((name: string) => {
      if (name === "PTY_SERVICE") {
        return {
          coordinator: {
            countTaskThreads: mockCountTaskThreads,
            listTaskThreads: mockListTaskThreads,
            getTaskThread: mockGetTaskThread,
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

describe("taskHistoryAction", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCountTaskThreads.mockResolvedValue(2);
    mockListTaskThreads.mockResolvedValue([
      {
        id: "thread-1",
        title: "Discord connector follow-up",
        status: "active",
        summary: "Still wiring the connector bridge",
        latestActivityAt: Date.now(),
      },
      {
        id: "thread-2",
        title: "Coordinator eval batch",
        status: "done",
        summary: "Finished the batch manifest",
        latestActivityAt: Date.now() - 60_000,
      },
    ]);
    mockGetTaskThread.mockResolvedValue(null);
  });

  it("lists active work when asked what is running right now", async () => {
    const callback = jest.fn();
    const result = await taskHistoryAction.handler(
      createRuntime() as unknown as IAgentRuntime,
      createMessage("What are you working on right now?"),
      undefined,
      {},
      callback,
    );

    expect(result?.success).toBe(true);
    expect(mockCountTaskThreads).toHaveBeenCalledWith(
      expect.objectContaining({
        hasActiveSession: true,
      }),
    );
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("I found 2 tasks"),
      }),
    );
  });

  it("counts tasks for a date window query", async () => {
    const callback = jest.fn();
    const result = await taskHistoryAction.handler(
      createRuntime() as unknown as IAgentRuntime,
      createMessage("How many tasks did we do yesterday?"),
      undefined,
      {},
      callback,
    );

    expect(result?.success).toBe(true);
    expect(mockCountTaskThreads).toHaveBeenCalledWith(
      expect.objectContaining({
        latestActivityAfter: expect.any(Number),
        latestActivityBefore: expect.any(Number),
      }),
    );
    expect(result?.text).toContain("I found 2 tasks");
  });
});
