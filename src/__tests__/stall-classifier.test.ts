/**
 * Stall classifier unit tests
 *
 * Tests prompt building, LLM-based classification, and snapshot writing.
 */
import { beforeEach, describe, expect, it, jest } from "bun:test";

// Dynamic import after preload mocks are registered
const {
  buildStallClassificationPrompt,
  buildCombinedClassifyDecidePrompt,
  classifyStallOutput,
  classifyAndDecideForCoordinator,
  writeStallSnapshot,
} = await import("../services/stall-classifier.js");

const createMockMetrics = () => ({
  incrementStalls: jest.fn(),
  recordCompletion: jest.fn(),
  get: jest.fn().mockReturnValue({ spawned: 0, completed: 0, stalls: 0 }),
});

const createMockRuntime = () => ({
  useModel: jest.fn(),
  getSetting: jest.fn(),
});

describe("stall-classifier", () => {
  let mockRuntime: ReturnType<typeof createMockRuntime>;
  let mockMetrics: ReturnType<typeof createMockMetrics>;

  beforeEach(() => {
    mockRuntime = createMockRuntime();
    mockMetrics = createMockMetrics();
  });

  describe("buildStallClassificationPrompt", () => {
    it("includes the output text in the prompt", () => {
      const prompt = buildStallClassificationPrompt(
        "claude",
        "s-1",
        "hello world",
      );
      expect(prompt).toContain("hello world");
    });

    it("includes agent type and session ID", () => {
      const prompt = buildStallClassificationPrompt("gemini", "s-42", "output");
      expect(prompt).toContain("gemini");
      expect(prompt).toContain("s-42");
    });

    it("returns a string containing classification instructions", () => {
      const prompt = buildStallClassificationPrompt("claude", "s-1", "output");
      expect(typeof prompt).toBe("string");
      expect(prompt).toContain("task_complete");
      expect(prompt).toContain("waiting_for_input");
      expect(prompt).toContain("still_working");
      expect(prompt).toContain("error");
    });
  });

  describe("classifyStallOutput", () => {
    // biome-ignore lint/suspicious/noExplicitAny: test mock doesn't implement full interface
    const makeCtx = (overrides: Record<string, unknown> = {}): any => ({
      sessionId: "s-1",
      recentOutput: "A".repeat(300),
      agentType: "claude",
      buffers: new Map<string, string[]>(),
      traceEntries: [] as Array<string | Record<string, unknown>>,
      runtime: mockRuntime,
      manager: null,
      metricsTracker: mockMetrics,
      log: jest.fn(),
      ...overrides,
    });

    it("returns task_complete when LLM responds with that state", async () => {
      mockRuntime.useModel.mockResolvedValue('{"state":"task_complete"}');
      const result = await classifyStallOutput(makeCtx());
      expect(result).not.toBeNull();
      expect(result?.state).toBe("task_complete");
    });

    it("returns waiting_for_input with prompt and suggestedResponse", async () => {
      mockRuntime.useModel.mockResolvedValue(
        '{"state":"waiting_for_input","prompt":"Do you want to proceed?","suggestedResponse":"y"}',
      );
      const result = await classifyStallOutput(makeCtx());
      expect(result).not.toBeNull();
      expect(result?.state).toBe("waiting_for_input");
      expect(result?.prompt).toBe("Do you want to proceed?");
      expect(result?.suggestedResponse).toBe("y");
    });

    it("returns null when LLM responds with garbage (no JSON)", async () => {
      mockRuntime.useModel.mockResolvedValue("I have no idea what happened");
      const result = await classifyStallOutput(makeCtx());
      expect(result).toBeNull();
    });

    it("returns null when LLM responds with an invalid state", async () => {
      mockRuntime.useModel.mockResolvedValue('{"state":"bogus"}');
      const result = await classifyStallOutput(makeCtx());
      expect(result).toBeNull();
    });

    it("uses own buffer when recentOutput is short", async () => {
      mockRuntime.useModel.mockResolvedValue('{"state":"still_working"}');
      const buffers = new Map<string, string[]>();
      buffers.set("s-1", Array(50).fill("buffer line with content"));
      const ctx = makeCtx({ recentOutput: "short", buffers });
      await classifyStallOutput(ctx);
      const logFn = ctx.log as ReturnType<typeof jest.fn>;
      const bufferMsg = logFn.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === "string" && c[0].includes("Using own buffer"),
      );
      expect(bufferMsg).toBeDefined();
    });

    it("calls metricsTracker.incrementStalls", async () => {
      mockRuntime.useModel.mockResolvedValue('{"state":"still_working"}');
      await classifyStallOutput(makeCtx());
      expect(mockMetrics.incrementStalls).toHaveBeenCalledWith("claude");
    });
  });

  describe("buildCombinedClassifyDecidePrompt", () => {
    const taskCtx = {
      sessionId: "s-1",
      agentType: "claude",
      label: "test-task",
      originalTask: "Fix the login bug",
      workdir: "/workspace/project",
      repo: "https://github.com/test/repo",
    };

    it("includes task context in the prompt", () => {
      const prompt = buildCombinedClassifyDecidePrompt(
        "claude",
        "s-1",
        "some output",
        taskCtx,
        [],
      );
      expect(prompt).toContain("Fix the login bug");
      expect(prompt).toContain("/workspace/project");
      expect(prompt).toContain("https://github.com/test/repo");
    });

    it("includes out-of-scope guidelines with workdir", () => {
      const prompt = buildCombinedClassifyDecidePrompt(
        "claude",
        "s-1",
        "some output",
        taskCtx,
        [],
      );
      expect(prompt).toContain("OUTSIDE the working directory");
      expect(prompt).toContain("/workspace/project");
    });

    it("includes decision history when provided", () => {
      const history = [
        {
          event: "blocked",
          promptText: "Approve file write?",
          action: "respond",
          response: "y",
          reasoning: "Tool approval aligned with task",
        },
      ];
      const prompt = buildCombinedClassifyDecidePrompt(
        "claude",
        "s-1",
        "some output",
        taskCtx,
        history,
      );
      expect(prompt).toContain("Previous decisions");
      expect(prompt).toContain("Approve file write?");
      expect(prompt).toContain("Tool approval aligned with task");
    });

    it("includes all classification states", () => {
      const prompt = buildCombinedClassifyDecidePrompt(
        "claude",
        "s-1",
        "output",
        taskCtx,
        [],
      );
      expect(prompt).toContain("task_complete");
      expect(prompt).toContain("waiting_for_input");
      expect(prompt).toContain("still_working");
      expect(prompt).toContain("error");
      expect(prompt).toContain("tool_running");
    });
  });

  describe("classifyAndDecideForCoordinator", () => {
    const taskCtx = {
      sessionId: "s-1",
      agentType: "claude",
      label: "test-task",
      originalTask: "Fix the login bug",
      workdir: "/workspace/project",
    };

    // biome-ignore lint/suspicious/noExplicitAny: test mock doesn't implement full interface
    const makeCtx = (overrides: Record<string, unknown> = {}): any => ({
      sessionId: "s-1",
      recentOutput: "A".repeat(300),
      agentType: "claude",
      buffers: new Map<string, string[]>(),
      traceEntries: [] as Array<string | Record<string, unknown>>,
      runtime: mockRuntime,
      manager: null,
      metricsTracker: mockMetrics,
      log: jest.fn(),
      taskContext: taskCtx,
      decisionHistory: [],
      ...overrides,
    });

    it("preserves suggestedResponse (not stripped)", async () => {
      mockRuntime.useModel.mockResolvedValue(
        '{"state":"waiting_for_input","prompt":"Allow file write?","suggestedResponse":"y"}',
      );
      const result = await classifyAndDecideForCoordinator(makeCtx());
      expect(result).not.toBeNull();
      expect(result?.state).toBe("waiting_for_input");
      expect(result?.suggestedResponse).toBe("y");
    });

    it("handles task_complete and records metrics", async () => {
      const mockManager = {
        get: jest.fn().mockReturnValue({ startedAt: new Date(Date.now() - 5000) }),
      };
      mockRuntime.useModel.mockResolvedValue('{"state":"task_complete"}');
      const result = await classifyAndDecideForCoordinator(
        makeCtx({ manager: mockManager }),
      );
      expect(result).not.toBeNull();
      expect(result?.state).toBe("task_complete");
      expect(mockMetrics.recordCompletion).toHaveBeenCalledWith(
        "claude",
        "classifier",
        expect.any(Number),
      );
    });

    it("returns null on LLM failure", async () => {
      mockRuntime.useModel.mockRejectedValue(new Error("LLM timeout"));
      const result = await classifyAndDecideForCoordinator(makeCtx());
      expect(result).toBeNull();
    });

    it("returns null when LLM returns no JSON", async () => {
      mockRuntime.useModel.mockResolvedValue("something went wrong");
      const result = await classifyAndDecideForCoordinator(makeCtx());
      expect(result).toBeNull();
    });

    it("calls metricsTracker.incrementStalls", async () => {
      mockRuntime.useModel.mockResolvedValue('{"state":"still_working"}');
      await classifyAndDecideForCoordinator(makeCtx());
      expect(mockMetrics.incrementStalls).toHaveBeenCalledWith("claude");
    });
  });

  describe("writeStallSnapshot", () => {
    it("does not throw (best-effort function)", async () => {
      await expect(
        writeStallSnapshot(
          "s-1",
          "claude",
          "recent output",
          "effective output",
          new Map<string, string[]>(),
          [],
          jest.fn(),
        ),
      ).resolves.toBeUndefined();
    });
  });
});
