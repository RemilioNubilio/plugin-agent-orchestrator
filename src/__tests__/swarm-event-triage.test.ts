/**
 * Swarm Event Triage tests
 *
 * Tests heuristic classification, LLM response parsing,
 * and the full classifyEventTier pipeline.
 */

import { beforeEach, describe, expect, it, jest } from "bun:test";

const {
  classifyByHeuristic,
  parseTriageResponse,
  classifyEventTier,
} = await import("../services/swarm-event-triage.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function blockedCtx(
  promptText: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    eventType: "blocked" as const,
    promptText,
    originalTask: "Fix the login bug",
    ...overrides,
  };
}

function turnCompleteCtx(
  recentOutput: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    eventType: "turn_complete" as const,
    promptText: "",
    recentOutput,
    originalTask: "Fix the login bug",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// classifyByHeuristic — prompt type routing
// ---------------------------------------------------------------------------
describe("classifyByHeuristic — prompt types", () => {
  it("returns 'routine' for permission prompt type", () => {
    const result = classifyByHeuristic(
      blockedCtx("Allow tool read_file? (Y/n)", { promptType: "permission" }),
    );
    expect(result).toBe("routine");
  });

  it("returns 'routine' for config prompt type", () => {
    const result = classifyByHeuristic(
      blockedCtx("Set timezone?", { promptType: "config" }),
    );
    expect(result).toBe("routine");
  });

  it("returns 'routine' for tos prompt type", () => {
    const result = classifyByHeuristic(
      blockedCtx("Accept terms?", { promptType: "tos" }),
    );
    expect(result).toBe("routine");
  });

  it("returns 'routine' for tool_wait prompt type", () => {
    const result = classifyByHeuristic(
      blockedCtx("Waiting for tool...", { promptType: "tool_wait" }),
    );
    expect(result).toBe("routine");
  });

  it("returns 'creative' for project_select prompt type", () => {
    const result = classifyByHeuristic(
      blockedCtx("Choose a project", { promptType: "project_select" }),
    );
    expect(result).toBe("creative");
  });

  it("returns 'creative' for model_select prompt type", () => {
    const result = classifyByHeuristic(
      blockedCtx("Pick a model", { promptType: "model_select" }),
    );
    expect(result).toBe("creative");
  });
});

// ---------------------------------------------------------------------------
// classifyByHeuristic — regex pattern matching
// ---------------------------------------------------------------------------
describe("classifyByHeuristic — regex patterns", () => {
  it("returns 'routine' for 'Allow tool read_file? (Y/n)'", () => {
    const result = classifyByHeuristic(blockedCtx("Allow tool read_file? (Y/n)"));
    expect(result).toBe("routine");
  });

  it("returns 'routine' for 'Trust this directory?'", () => {
    const result = classifyByHeuristic(blockedCtx("Trust this directory?"));
    expect(result).toBe("routine");
  });

  it("returns 'routine' for 'Proceed?'", () => {
    const result = classifyByHeuristic(blockedCtx("Proceed?"));
    expect(result).toBe("routine");
  });

  it("returns 'routine' for 'overwrite?'", () => {
    const result = classifyByHeuristic(blockedCtx("File exists, overwrite?"));
    expect(result).toBe("routine");
  });

  it("returns 'routine' for 'Do you trust this workspace?'", () => {
    const result = classifyByHeuristic(
      blockedCtx("Do you trust this workspace?"),
    );
    expect(result).toBe("routine");
  });

  it("returns 'routine' for 'Allow access to /src?'", () => {
    const result = classifyByHeuristic(blockedCtx("Allow access to /src?"));
    expect(result).toBe("routine");
  });

  it("returns 'creative' for 'Which approach should we take?'", () => {
    const result = classifyByHeuristic(
      blockedCtx("Which approach should we take?"),
    );
    expect(result).toBe("creative");
  });

  it("returns 'creative' for 'tests are failing'", () => {
    const result = classifyByHeuristic(blockedCtx("The tests failing — what now?"));
    expect(result).toBe("creative");
  });

  it("returns 'creative' for 'How should we handle this?'", () => {
    const result = classifyByHeuristic(
      blockedCtx("How should we handle the migration?"),
    );
    expect(result).toBe("creative");
  });

  it("returns 'creative' for 'build failed'", () => {
    const result = classifyByHeuristic(blockedCtx("The build failed with 3 errors"));
    expect(result).toBe("creative");
  });

  it("returns 'creative' for 'merge conflict'", () => {
    const result = classifyByHeuristic(
      blockedCtx("There's a merge conflict in src/index.ts"),
    );
    expect(result).toBe("creative");
  });

  it("returns null for ambiguous prompt", () => {
    const result = classifyByHeuristic(
      blockedCtx("The agent has finished running the task"),
    );
    expect(result).toBeNull();
  });

  it("returns null for empty prompt text", () => {
    const result = classifyByHeuristic(blockedCtx(""));
    expect(result).toBeNull();
  });

  it("creative wins ties when both patterns match", () => {
    // A prompt that matches both routine and creative patterns
    const result = classifyByHeuristic(
      blockedCtx("Proceed? But the tests failing with compilation error"),
    );
    expect(result).toBe("creative");
  });
});

// ---------------------------------------------------------------------------
// classifyByHeuristic — turn_complete output patterns
// ---------------------------------------------------------------------------
describe("classifyByHeuristic — turn_complete", () => {
  it("returns 'routine' for terminal output (all tests pass)", () => {
    const result = classifyByHeuristic(
      turnCompleteCtx("All 42 tests passed in 3.2s"),
    );
    expect(result).toBe("routine");
  });

  it("returns 'routine' for terminal output (PR URL)", () => {
    const result = classifyByHeuristic(
      turnCompleteCtx("https://github.com/org/repo/pull/123"),
    );
    expect(result).toBe("routine");
  });

  it("returns 'routine' for intermediate output (running tests)", () => {
    const result = classifyByHeuristic(
      turnCompleteCtx("Running tests..."),
    );
    expect(result).toBe("routine");
  });

  it("returns null for ambiguous output", () => {
    const result = classifyByHeuristic(
      turnCompleteCtx("I've made changes to the file"),
    );
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseTriageResponse
// ---------------------------------------------------------------------------
describe("parseTriageResponse", () => {
  it("extracts 'routine' tier from valid JSON", () => {
    const result = parseTriageResponse('{"tier": "routine"}');
    expect(result).toBe("routine");
  });

  it("extracts 'creative' tier from valid JSON", () => {
    const result = parseTriageResponse('{"tier": "creative"}');
    expect(result).toBe("creative");
  });

  it("extracts tier from JSON embedded in text", () => {
    const result = parseTriageResponse(
      'Based on my analysis, {"tier": "routine"} is the correct classification.',
    );
    expect(result).toBe("routine");
  });

  it("returns null for malformed JSON", () => {
    const result = parseTriageResponse("not json at all");
    expect(result).toBeNull();
  });

  it("returns null for JSON with invalid tier value", () => {
    const result = parseTriageResponse('{"tier": "unknown"}');
    expect(result).toBeNull();
  });

  it("returns null for JSON missing tier key", () => {
    const result = parseTriageResponse('{"classification": "routine"}');
    expect(result).toBeNull();
  });

  it("returns null for empty string", () => {
    const result = parseTriageResponse("");
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// classifyEventTier — full pipeline
// ---------------------------------------------------------------------------
describe("classifyEventTier", () => {
  let mockRuntime: { useModel: ReturnType<typeof jest.fn> };
  let log: ReturnType<typeof jest.fn>;

  beforeEach(() => {
    mockRuntime = {
      useModel: jest.fn().mockResolvedValue('{"tier": "routine"}'),
    };
    log = jest.fn();
  });

  it("uses heuristic when definitive — no LLM call", async () => {
    const ctx = blockedCtx("Allow tool read_file? (Y/n)");

    const result = await classifyEventTier(mockRuntime as never, ctx as never, log);

    expect(result).toBe("routine");
    expect(mockRuntime.useModel).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("Triage: heuristic → routine");
  });

  it("falls back to LLM when heuristic returns null", async () => {
    const ctx = blockedCtx("The agent finished doing something ambiguous");
    mockRuntime.useModel.mockResolvedValue('{"tier": "creative"}');

    const result = await classifyEventTier(mockRuntime as never, ctx as never, log);

    expect(result).toBe("creative");
    expect(mockRuntime.useModel).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("Triage: LLM → creative");
  });

  it("defaults to 'creative' when LLM returns unparseable response", async () => {
    const ctx = blockedCtx("Something unclear");
    mockRuntime.useModel.mockResolvedValue("I can't decide");

    const result = await classifyEventTier(mockRuntime as never, ctx as never, log);

    expect(result).toBe("creative");
    expect(log).toHaveBeenCalledWith(
      "Triage: LLM returned unparseable response — defaulting to creative",
    );
  });

  it("defaults to 'creative' when LLM throws", async () => {
    const ctx = blockedCtx("Something unclear");
    mockRuntime.useModel.mockRejectedValue(new Error("LLM timeout"));

    const result = await classifyEventTier(mockRuntime as never, ctx as never, log);

    expect(result).toBe("creative");
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("LLM classifier failed"),
    );
  });

  it("uses heuristic for creative prompt type without calling LLM", async () => {
    const ctx = blockedCtx("Pick a project", { promptType: "project_select" });

    const result = await classifyEventTier(mockRuntime as never, ctx as never, log);

    expect(result).toBe("creative");
    expect(mockRuntime.useModel).not.toHaveBeenCalled();
  });
});
