/**
 * SPAWN_AGENT action tests
 */

import { beforeEach, describe, expect, it, jest } from "bun:test";
import type { IAgentRuntime, Memory, State } from "@elizaos/core";

const { spawnAgentAction } = await import("../actions/spawn-agent.js");

const mockSpawnSession = jest.fn();
const mockOnSessionEvent = jest.fn();
const mockCheckAvailableAgents = jest.fn();
const mockResolveAgentType = jest.fn();

const createMockPTYService = () => ({
  spawnSession: mockSpawnSession,
  onSessionEvent: mockOnSessionEvent,
  getSession: jest.fn(),
  listSessions: jest.fn().mockReturnValue([]),
  checkAvailableAgents: mockCheckAvailableAgents,
  resolveAgentType: mockResolveAgentType,
  defaultApprovalPreset: "autonomous",
});

const createMockRuntime = (ptyService: unknown = null) => ({
  getService: jest.fn((name: string) => {
    if (name === "PTY_SERVICE") return ptyService;
    return null;
  }),
  getSetting: jest.fn(),
});

const createMockMessage = (content: Record<string, unknown> = {}) => ({
  id: "msg-123",
  userId: "user-456",
  content,
  roomId: "room-789",
  createdAt: Date.now(),
});

describe("spawnAgentAction", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSpawnSession.mockResolvedValue({
      id: "session-123",
      agentType: "claude",
      workdir: "/test/path",
      status: "running",
      createdAt: new Date(),
      lastActivityAt: new Date(),
    });
    mockCheckAvailableAgents.mockResolvedValue([
      {
        adapter: "claude",
        installed: true,
        installCommand: "npm i -g @anthropic-ai/claude-code",
        docsUrl: "https://docs.anthropic.com",
      },
    ]);
    mockResolveAgentType.mockResolvedValue("claude");
  });

  describe("action metadata", () => {
    it("should have correct name", () => {
      expect(spawnAgentAction.name).toBe("SPAWN_AGENT");
    });

    it("should preserve legacy and new similes", () => {
      expect(spawnAgentAction.similes).toContain("SPAWN_CODING_AGENT");
      expect(spawnAgentAction.similes).toContain("START_TASK_AGENT");
    });

    it("should have task-agent description", () => {
      expect(spawnAgentAction.description).toContain("task agent");
      expect(spawnAgentAction.description).toContain("not limited to coding");
      expect(spawnAgentAction.description).toContain("browser/site workflows");
    });

    it("should define parameters", () => {
      const paramNames = (spawnAgentAction.parameters ?? []).map((p) => p.name);
      expect(paramNames).toContain("agentType");
      expect(paramNames).toContain("workdir");
      expect(paramNames).toContain("task");
    });
  });

  describe("validate", () => {
    it("returns true when PTYService is available", async () => {
      const runtime = createMockRuntime(createMockPTYService());

      const result = await spawnAgentAction.validate?.(
        runtime as unknown as IAgentRuntime,
        createMockMessage() as unknown as Memory,
      );
      expect(result).toBe(true);
    });

    it("returns false when PTYService is not available", async () => {
      const runtime = createMockRuntime(null);

      const result = await spawnAgentAction.validate?.(
        runtime as unknown as IAgentRuntime,
        createMockMessage() as unknown as Memory,
      );
      expect(result).toBe(false);
    });
  });

  describe("handler", () => {
    const validWorkdir = process.cwd();

    it("should spawn a task-agent session", async () => {
      const runtime = createMockRuntime(createMockPTYService());
      const message = createMockMessage({
        agentType: "claude",
        workdir: validWorkdir,
        task: "Fix the bug",
      });

      const result = await spawnAgentAction.handler(
        runtime as unknown as IAgentRuntime,
        message as unknown as Memory,
        undefined,
        {},
        jest.fn(),
      );

      expect(result?.success).toBe(true);
      expect(mockSpawnSession).toHaveBeenCalledWith({
        name: expect.stringContaining("task-"),
        agentType: "claude",
        workdir: validWorkdir,
        initialTask: "Fix the bug",
        credentials: expect.any(Object),
        approvalPreset: "autonomous",
        customCredentials: undefined,
        metadata: expect.objectContaining({
          requestedType: "claude",
          messageId: "msg-123",
        }),
      });
    });

    it("denies Discord users without task-agent access", async () => {
      const runtime = createMockRuntime(createMockPTYService());
      const callback = jest.fn();

      const result = await spawnAgentAction.handler(
        runtime as unknown as IAgentRuntime,
        createMockMessage({
          source: "discord",
          agentType: "claude",
          workdir: validWorkdir,
          task: "Fix the bug",
        }) as unknown as Memory,
        undefined,
        {},
        callback,
      );

      expect(result?.success).toBe(false);
      expect(result?.error).toBe("FORBIDDEN");
      expect(mockSpawnSession).not.toHaveBeenCalled();
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("requires a verified OWNER or ADMIN role"),
        }),
      );
    });

    it("should use the preferred agent type if not specified", async () => {
      const runtime = createMockRuntime(createMockPTYService());
      const message = createMockMessage({
        workdir: validWorkdir,
        task: "Investigate the failing tests in this repo",
      });

      await spawnAgentAction.handler(
        runtime as unknown as IAgentRuntime,
        message as unknown as Memory,
        undefined,
        {},
        jest.fn(),
      );

      expect(mockResolveAgentType).toHaveBeenCalledWith({
        task: "Investigate the failing tests in this repo",
        workdir: validWorkdir,
      });
      expect(mockSpawnSession).toHaveBeenCalledWith(
        expect.objectContaining({
          agentType: "claude",
        }),
      );
    });

    it("should map agent type aliases", async () => {
      const runtime = createMockRuntime(createMockPTYService());
      const message = createMockMessage({
        agentType: "claude-code",
        workdir: validWorkdir,
      });

      await spawnAgentAction.handler(
        runtime as unknown as IAgentRuntime,
        message as unknown as Memory,
        undefined,
        {},
        jest.fn(),
      );

      expect(mockSpawnSession).toHaveBeenCalledWith(
        expect.objectContaining({
          agentType: "claude",
        }),
      );
    });

    it("should map pi agent type to shell and wrap task as a pi command", async () => {
      const runtime = createMockRuntime(createMockPTYService());
      const message = createMockMessage({
        agentType: "pi",
        workdir: validWorkdir,
        task: "Fix flaky tests",
      });

      await spawnAgentAction.handler(
        runtime as unknown as IAgentRuntime,
        message as unknown as Memory,
        undefined,
        {},
        jest.fn(),
      );

      expect(mockSpawnSession).toHaveBeenCalledWith(
        expect.objectContaining({
          agentType: "shell",
          initialTask: "pi 'Fix flaky tests'",
        }),
      );
    });

    it("should use codex adapter for codex type", async () => {
      const runtime = createMockRuntime(createMockPTYService());
      const message = createMockMessage({
        agentType: "codex",
        workdir: validWorkdir,
      });
      mockCheckAvailableAgents.mockResolvedValue([
        {
          adapter: "codex",
          installed: true,
          installCommand: "npm i -g @openai/codex",
          docsUrl: "https://openai.com",
        },
      ]);

      await spawnAgentAction.handler(
        runtime as unknown as IAgentRuntime,
        message as unknown as Memory,
        undefined,
        {},
        jest.fn(),
      );

      expect(mockSpawnSession).toHaveBeenCalledWith(
        expect.objectContaining({
          agentType: "codex",
        }),
      );
    });

    it("returns NO_WORKSPACE when workdir is missing", async () => {
      const runtime = createMockRuntime(createMockPTYService());
      const result = await spawnAgentAction.handler(
        runtime as unknown as IAgentRuntime,
        createMockMessage({ agentType: "claude" }) as unknown as Memory,
        undefined,
        {},
        jest.fn(),
      );

      expect(result?.success).toBe(false);
      expect(result?.error).toBe("NO_WORKSPACE");
    });

    it("stores session in state", async () => {
      const runtime = createMockRuntime(createMockPTYService());
      const state: Record<string, unknown> = {};

      await spawnAgentAction.handler(
        runtime as unknown as IAgentRuntime,
        createMockMessage({
          agentType: "claude",
          workdir: validWorkdir,
        }) as unknown as Memory,
        state as unknown as State,
        {},
        jest.fn(),
      );

      expect(state.codingSession).toBeDefined();
      expect((state.codingSession as { id: string }).id).toBe("session-123");
    });

    it("registers a session event handler", async () => {
      const runtime = createMockRuntime(createMockPTYService());

      await spawnAgentAction.handler(
        runtime as unknown as IAgentRuntime,
        createMockMessage({
          agentType: "claude",
          workdir: validWorkdir,
        }) as unknown as Memory,
        undefined,
        {},
        jest.fn(),
      );

      expect(mockOnSessionEvent).toHaveBeenCalled();
    });

    it("fails if the requested CLI is not installed", async () => {
      const runtime = createMockRuntime(createMockPTYService());
      mockCheckAvailableAgents.mockResolvedValue([
        {
          adapter: "claude",
          installed: false,
          installCommand: "npm i -g @anthropic-ai/claude-code",
          docsUrl: "https://docs.anthropic.com",
        },
      ]);

      const callback = jest.fn();
      const result = await spawnAgentAction.handler(
        runtime as unknown as IAgentRuntime,
        createMockMessage({
          agentType: "claude",
          workdir: validWorkdir,
        }) as unknown as Memory,
        undefined,
        {},
        callback,
      );

      expect(result?.success).toBe(false);
      expect(result?.error).toBe("AGENT_NOT_INSTALLED");
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("not installed"),
        }),
      );
    });

    it("returns false when PTYService is not available", async () => {
      const callback = jest.fn();
      const result = await spawnAgentAction.handler(
        createMockRuntime(null) as unknown as IAgentRuntime,
        createMockMessage({}) as unknown as Memory,
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

    it("handles spawn errors", async () => {
      mockSpawnSession.mockRejectedValue(new Error("PTY spawn failed"));
      const runtime = createMockRuntime(createMockPTYService());
      const callback = jest.fn();

      const result = await spawnAgentAction.handler(
        runtime as unknown as IAgentRuntime,
        createMockMessage({
          agentType: "claude",
          workdir: validWorkdir,
        }) as unknown as Memory,
        undefined,
        {},
        callback,
      );

      expect(result?.success).toBe(false);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("Failed"),
        }),
      );
    });

    it("skips preflight check for shell agent type", async () => {
      const runtime = createMockRuntime(createMockPTYService());

      await spawnAgentAction.handler(
        runtime as unknown as IAgentRuntime,
        createMockMessage({
          agentType: "shell",
          workdir: validWorkdir,
        }) as unknown as Memory,
        undefined,
        {},
        jest.fn(),
      );

      expect(mockCheckAvailableAgents).not.toHaveBeenCalled();
      expect(mockSpawnSession).toHaveBeenCalledWith(
        expect.objectContaining({
          agentType: "shell",
        }),
      );
    });

    it("filters Anthropic OAuth tokens out of custom credentials", async () => {
      const runtime = createMockRuntime(createMockPTYService());
      runtime.getSetting.mockImplementation((key: string) => {
        const map: Record<string, string> = {
          CUSTOM_CREDENTIAL_KEYS: "ANTHROPIC_API_KEY,GITHUB_TOKEN",
          ANTHROPIC_API_KEY: "sk-ant-oat-demo",
          GITHUB_TOKEN: "ghp-demo",
        };
        return map[key] ?? undefined;
      });

      await spawnAgentAction.handler(
        runtime as unknown as IAgentRuntime,
        createMockMessage({
          agentType: "claude",
          workdir: validWorkdir,
          task: "Fix the bug",
        }) as unknown as Memory,
        undefined,
        {},
        jest.fn(),
      );

      expect(mockSpawnSession).toHaveBeenCalledWith(
        expect.objectContaining({
          customCredentials: {
            GITHUB_TOKEN: "ghp-demo",
          },
        }),
      );
    });
  });
});
