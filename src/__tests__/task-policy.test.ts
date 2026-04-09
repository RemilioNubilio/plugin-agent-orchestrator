import { beforeEach, describe, expect, it, jest, mock } from "bun:test";
import type { IAgentRuntime, Memory } from "@elizaos/core";

process.env.MILADY_SKIP_LOCAL_PLUGIN_ROLES = "1";

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

  it("does not auto-allow when entity identity is missing", async () => {
    const runtime = createRuntime({
      // biome-ignore lint/performance/noDelete: test fixture
      agentId: undefined,
      roomSource: "discord",
    });
    const message = createMessage({
      // biome-ignore lint/performance/noDelete: test fixture
      entityId: undefined,
    });

    const result = await requireTaskAgentAccess(runtime, message, "create");

    expect(result.allowed).toBe(false);
    expect(result.connector).toBe("discord");
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

  it("allows the Discord owner to create tasks under the default policy", async () => {
    mockCheckSenderRole.mockResolvedValue({
      role: "OWNER",
      isAdmin: true,
      isOwner: true,
    });
    const runtime = createRuntime();
    const message = createMessage({
      content: { source: "discord" },
    });

    const result = await requireTaskAgentAccess(runtime, message, "create");

    expect(result).toEqual({
      allowed: true,
      connector: "discord",
      requiredRole: "ADMIN",
      actualRole: "OWNER",
    });
  });

  it("allows Discord admins to interact with tasks under the default policy", async () => {
    mockCheckSenderRole.mockResolvedValue({
      role: "ADMIN",
      isAdmin: true,
      isOwner: false,
    });
    const runtime = createRuntime();
    const message = createMessage({
      content: { source: "discord" },
    });

    const result = await requireTaskAgentAccess(runtime, message, "interact");

    expect(result).toEqual({
      allowed: true,
      connector: "discord",
      requiredRole: "ADMIN",
      actualRole: "ADMIN",
    });
  });

  it("denies Discord users below admin under the default policy", async () => {
    mockCheckSenderRole.mockResolvedValue({
      role: "USER",
      isAdmin: false,
      isOwner: false,
    });
    const runtime = createRuntime();
    const message = createMessage({
      content: { source: "discord" },
    });

    const result = await requireTaskAgentAccess(runtime, message, "create");

    expect(result.allowed).toBe(false);
    expect(result.connector).toBe("discord");
    expect(result.requiredRole).toBe("ADMIN");
    expect(result.actualRole).toBe("USER");
    if (result.allowed) {
      throw new Error("expected access to be denied");
    }
    expect(result.reason).toContain("ADMIN or higher");
  });
});
