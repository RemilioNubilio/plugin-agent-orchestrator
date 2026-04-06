import { beforeEach, describe, expect, it, jest, mock } from "bun:test";
import type { IAgentRuntime, Memory } from "@elizaos/core";

const mockCheckSenderRole = jest.fn();

mock.module("@miladyai/plugin-roles", () => ({
  checkSenderRole: mockCheckSenderRole,
}));

const { requireTaskAgentAccess } = await import("../services/task-policy.js");

function createRuntime(
  overrides: Partial<IAgentRuntime> & {
    settings?: Record<string, unknown>;
    roomSource?: string | null;
  } = {},
): IAgentRuntime {
  const settings = overrides.settings ?? {};
  return {
    agentId: "agent-1",
    getSetting: jest.fn((key: string) => settings[key]),
    getRoom: jest.fn(async () =>
      overrides.roomSource === undefined
        ? null
        : { source: overrides.roomSource },
    ),
    ...overrides,
  } as unknown as IAgentRuntime;
}

function createMessage(
  overrides: Partial<Memory> & { content?: Record<string, unknown> } = {},
): Memory {
  return {
    id: "msg-1",
    roomId: "room-1",
    userId: "user-1",
    entityId: "user-1",
    content: {},
    ...overrides,
  } as unknown as Memory;
}

describe("requireTaskAgentAccess", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckSenderRole.mockResolvedValue(null);
  });

  it("allows default guest access when no connector policy applies", async () => {
    const runtime = createRuntime();
    const message = createMessage({
      content: { source: "client_chat" },
    });

    const result = await requireTaskAgentAccess(runtime, message, "interact");

    expect(result).toEqual({
      allowed: true,
      connector: null,
      requiredRole: "GUEST",
      actualRole: "GUEST",
    });
  });

  it("denies discord task creation when role context is unavailable", async () => {
    const runtime = createRuntime({ roomSource: "discord" });
    const message = createMessage();

    const result = await requireTaskAgentAccess(runtime, message, "create");

    expect(result.allowed).toBe(false);
    expect(result.connector).toBe("discord");
    expect(result.requiredRole).toBe("ADMIN");
    expect(result.actualRole).toBe("GUEST");
    if (result.allowed) {
      throw new Error("expected access to be denied");
    }
    expect(result.reason).toContain("Discord");
  });

  it("allows access when the sender meets the configured connector role", async () => {
    mockCheckSenderRole.mockResolvedValue({
      role: "USER",
      isAdmin: false,
      isOwner: false,
    });
    const runtime = createRuntime({
      settings: {
        TASK_AGENT_ROLE_POLICY: JSON.stringify({
          default: "GUEST",
          connectors: {
            discord: {
              interact: "USER",
            },
          },
        }),
      },
      roomSource: "discord",
    });
    const message = createMessage();

    const result = await requireTaskAgentAccess(runtime, message, "interact");

    expect(result).toEqual({
      allowed: true,
      connector: "discord",
      requiredRole: "USER",
      actualRole: "USER",
    });
  });
});
