import { describe, expect, it, jest } from "bun:test";
import type { IAgentRuntime } from "@elizaos/core";

const { deriveTaskAcceptanceCriteria } = await import(
  "../services/task-acceptance.js"
);

function makeInput(
  overrides: Partial<
    import("../services/task-registry.js").CreateTaskThreadInput
  > = {},
): import("../services/task-registry.js").CreateTaskThreadInput {
  return {
    title: "Durable task thread",
    originalRequest: "Persist task state across restarts",
    kind: "coding",
    ...overrides,
  };
}

describe("deriveTaskAcceptanceCriteria", () => {
  it("uses provided criteria after trimming and deduping them", async () => {
    const runtime = {
      useModel: jest.fn(),
    } as unknown as IAgentRuntime;

    const result = await deriveTaskAcceptanceCriteria(
      runtime,
      makeInput({
        acceptanceCriteria: [
          "  Persist the task thread  ",
          "- persist the task thread",
          "",
          "Record validation evidence",
        ],
      }),
    );

    expect(result).toEqual({
      criteria: ["Persist the task thread", "Record validation evidence"],
      source: "provided",
    });
    expect(runtime.useModel).not.toHaveBeenCalled();
  });

  it("parses fenced model JSON and caps criteria to seven unique items", async () => {
    const runtime = {
      useModel: jest.fn().mockResolvedValue(`\`\`\`json
[
  "Persist all task state",
  "Persist all task state",
  "Recover after restart",
  "Validate task completion",
  "Capture screenshot evidence",
  "Link trajectories",
  "Handle blockers",
  "Archive completed tasks",
  "Reject premature completion"
]
\`\`\``),
    } as unknown as IAgentRuntime;

    const result = await deriveTaskAcceptanceCriteria(runtime, makeInput());

    expect(result.source).toBe("model");
    expect(result.criteria).toEqual([
      "Persist all task state",
      "Recover after restart",
      "Validate task completion",
      "Capture screenshot evidence",
      "Link trajectories",
      "Handle blockers",
      "Archive completed tasks",
    ]);
  });

  it("falls back to baseline criteria when the model response is invalid", async () => {
    const runtime = {
      useModel: jest.fn().mockResolvedValue("not json"),
    } as unknown as IAgentRuntime;

    const result = await deriveTaskAcceptanceCriteria(
      runtime,
      makeInput({
        kind: "research",
        currentPlan: {
          subtasks: ["Inspect current code", "Write an implementation plan"],
        },
        metadata: {
          repo: " https://github.com/example/project ",
        },
      }),
    );

    expect(result.source).toBe("baseline");
    expect(result.criteria).toEqual(
      expect.arrayContaining([
        "Address the full request: Persist task state across restarts",
        "Complete this planned subtask: Inspect current code",
        "Complete this planned subtask: Write an implementation plan",
        "Run the relevant checks for the changed code, or record the exact blocker.",
        "Capture concrete completion evidence in the task record.",
      ]),
    );
  });

  it("falls back to baseline criteria when the model throws", async () => {
    const runtime = {
      useModel: jest.fn().mockRejectedValue(new Error("model unavailable")),
    } as unknown as IAgentRuntime;

    const result = await deriveTaskAcceptanceCriteria(
      runtime,
      makeInput({
        kind: "research",
      }),
    );

    expect(result.source).toBe("baseline");
    expect(result.criteria).not.toContain(
      "Run the relevant checks for the changed code, or record the exact blocker.",
    );
    expect(result.criteria).toEqual(
      expect.arrayContaining([
        "Address the full request: Persist task state across restarts",
        "Capture concrete completion evidence in the task record.",
      ]),
    );
  });
});
