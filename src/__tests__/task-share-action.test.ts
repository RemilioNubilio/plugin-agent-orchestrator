import { beforeEach, describe, expect, it, jest } from "bun:test";

type IAgentRuntime = import("@elizaos/core").IAgentRuntime;
type Memory = import("@elizaos/core").Memory;

const { taskShareAction } = await import("../actions/task-share.js");

const mockListTaskThreads = jest.fn();
const mockGetTaskThread = jest.fn();
const mockRecordArtifact = jest.fn();

function createRuntime() {
  return {
    agentId: "agent-1",
    getService: jest.fn((name: string) => {
      if (name === "PTY_SERVICE") {
        return {
          coordinator: {
            listTaskThreads: mockListTaskThreads,
            getTaskThread: mockGetTaskThread,
            taskRegistry: {
              recordArtifact: mockRecordArtifact,
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

describe("taskShareAction", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListTaskThreads.mockResolvedValue([
      {
        id: "thread-1",
        title: "Birthday site",
        status: "done",
        originalRequest: "Build the birthday site",
      },
    ]);
    mockGetTaskThread.mockResolvedValue({
      id: "thread-1",
      title: "Birthday site",
      latestWorkdir: "/tmp/birthday-site",
      artifacts: [],
      transcripts: [
        {
          direction: "stdout",
          content: "Server ready at http://localhost:4173",
        },
      ],
    });
    mockRecordArtifact.mockResolvedValue(undefined);
  });

  it("discovers a preview URL and records it as an artifact", async () => {
    const callback = jest.fn();
    const result = await taskShareAction.handler(
      createRuntime() as unknown as IAgentRuntime,
      createMessage("Can I see it?"),
      undefined,
      {},
      callback,
    );

    expect(result?.success).toBe(true);
    expect(mockRecordArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "thread-1",
        artifactType: "share_link",
      }),
    );
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("http://localhost:4173"),
      }),
    );
  });
});
