/**
 * Swarm Coordinator prompt construction and parsing tests
 *
 * Tests buildCoordinationPrompt() and parseCoordinationResponse() --
 * pure functions, no mocks needed.
 */

import { describe, expect, it } from "bun:test";

type DecisionHistoryEntry =
  import("../services/swarm-coordinator-prompts.js").DecisionHistoryEntry;
type TaskContextSummary =
  import("../services/swarm-coordinator-prompts.js").TaskContextSummary;

const {
  buildCoordinationPrompt,
  buildIdleCheckPrompt,
  parseCoordinationResponse,
} = await import("../services/swarm-coordinator-prompts.js");

const makeTaskCtx = (
  overrides: Partial<TaskContextSummary> = {},
): TaskContextSummary => ({
  sessionId: "s-1",
  agentType: "claude",
  label: "test-agent",
  originalTask: "Fix the login bug",
  workdir: "/workspace/project",
  ...overrides,
});

describe("swarm-coordinator-prompts", () => {
  // ==========================================================================
  // buildCoordinationPrompt
  // ==========================================================================
  describe("buildCoordinationPrompt", () => {
    it("includes task context in the prompt", () => {
      const prompt = buildCoordinationPrompt(
        makeTaskCtx(),
        "Do you want to proceed? (Y/n)",
        "recent output here",
        [],
      );
      expect(prompt).toContain("claude");
      expect(prompt).toContain("test-agent");
      expect(prompt).toContain("s-1");
      expect(prompt).toContain("Fix the login bug");
      expect(prompt).toContain("/workspace/project");
    });

    it("includes the blocking prompt text", () => {
      const prompt = buildCoordinationPrompt(
        makeTaskCtx(),
        "Allow file write to auth.ts?",
        "",
        [],
      );
      expect(prompt).toContain("Allow file write to auth.ts?");
    });

    it("includes recent output", () => {
      const prompt = buildCoordinationPrompt(
        makeTaskCtx(),
        "prompt",
        "Compiling TypeScript...\nBuild succeeded.",
        [],
      );
      expect(prompt).toContain("Compiling TypeScript");
      expect(prompt).toContain("Build succeeded");
    });

    it("includes decision history when present", () => {
      const history: DecisionHistoryEntry[] = [
        {
          event: "blocked",
          promptText: "Allow read?",
          action: "respond",
          response: "y",
          reasoning: "Read access is safe",
        },
      ];
      const prompt = buildCoordinationPrompt(
        makeTaskCtx(),
        "Allow write?",
        "output",
        history,
      );
      expect(prompt).toContain("Previous decisions");
      expect(prompt).toContain("Allow read?");
      expect(prompt).toContain("Read access is safe");
    });

    it("omits history section when empty", () => {
      const prompt = buildCoordinationPrompt(
        makeTaskCtx(),
        "prompt",
        "output",
        [],
      );
      expect(prompt).not.toContain("Previous decisions");
    });

    it("includes workdir scoping guideline with decline and redirect", () => {
      const prompt = buildCoordinationPrompt(
        makeTaskCtx({ workdir: "/home/user/project" }),
        "Allow write to /etc/passwd?",
        "output",
        [],
      );
      expect(prompt).toContain("OUTSIDE the working");
      expect(prompt).toContain("/home/user/project");
      expect(prompt).toContain("DECLINE");
      expect(prompt).toContain("REDIRECT");
      expect(prompt).toContain("Use /home/user/project instead");
    });

    it("contains all three action options", () => {
      const prompt = buildCoordinationPrompt(
        makeTaskCtx(),
        "prompt",
        "output",
        [],
      );
      expect(prompt).toContain('"respond"');
      expect(prompt).toContain('"escalate"');
      expect(prompt).toContain('"ignore"');
    });

    it("includes repo context when provided", () => {
      const prompt = buildCoordinationPrompt(
        makeTaskCtx({ repo: "https://github.com/org/repo" }),
        "prompt",
        "output",
        [],
      );
      expect(prompt).toContain("Repository: https://github.com/org/repo");
    });

    it("shows scratch directory when no repo", () => {
      const prompt = buildCoordinationPrompt(
        makeTaskCtx(),
        "prompt",
        "output",
        [],
      );
      expect(prompt).toContain("Repository: none (scratch directory)");
    });

    it("includes escalation guideline for missing context", () => {
      const prompt = buildCoordinationPrompt(
        makeTaskCtx(),
        "prompt",
        "output",
        [],
      );
      expect(prompt).toContain("NOT provided in the original task");
      expect(prompt).toContain("ESCALATE");
    });

    it("truncates very long output to 3000 chars", () => {
      const longOutput = "x".repeat(5000);
      const prompt = buildCoordinationPrompt(
        makeTaskCtx(),
        "prompt",
        longOutput,
        [],
      );
      // The prompt should contain at most 3000 chars of output
      expect(prompt.length).toBeLessThan(longOutput.length + 2000);
    });
  });

  // ==========================================================================
  // buildIdleCheckPrompt — response field formatting constraints
  // ==========================================================================
  //
  // Regression guard for a real bug: the idle watchdog used to fire an
  // LLM check that could return `action: "respond", response: "The
  // agent is still setting up..."` — a third-person status report —
  // which the coordinator then piped VERBATIM into the agent's stdin
  // as if the user had typed it. The agent would then see a user
  // message describing itself in the third person and get confused.
  //
  // The prompt now carries a CRITICAL constraint explaining that the
  // `response` field is sent verbatim and MUST be a second-person
  // imperative. These tests lock that constraint in place.
  describe("buildIdleCheckPrompt response format rules", () => {
    const makeCtx = () => makeTaskCtx({ agentType: "codex" });

    it("explains that `response` is sent verbatim to the agent's stdin", () => {
      const prompt = buildIdleCheckPrompt(
        makeCtx(),
        "Working on it...",
        5,
        1,
        4,
        [],
      );
      expect(prompt).toContain("VERBATIM");
      expect(prompt.toLowerCase()).toContain("agent's terminal");
    });

    it("requires the response to be a second-person imperative", () => {
      const prompt = buildIdleCheckPrompt(
        makeCtx(),
        "Working on it...",
        5,
        1,
        4,
        [],
      );
      expect(prompt).toMatch(/second-person imperative/i);
    });

    it("explicitly forbids third-person status reports in the response", () => {
      const prompt = buildIdleCheckPrompt(
        makeCtx(),
        "Working on it...",
        5,
        1,
        4,
        [],
      );
      expect(prompt).toMatch(/NEVER write a third-person/i);
      // The exact buggy phrasing from the real-world bug should be
      // mentioned as an anti-example so the LLM sees it directly.
      expect(prompt).toMatch(/The agent is still setting up/);
    });

    it("gives short 2nd-person examples the LLM can pattern-match on", () => {
      const prompt = buildIdleCheckPrompt(makeCtx(), "", 5, 1, 4, []);
      expect(prompt).toMatch(/"continue"/);
      expect(prompt).toMatch(/"please create the pull request"/);
    });

    it("steers reasoning-style explanation into the `reasoning` field, not `response`", () => {
      const prompt = buildIdleCheckPrompt(makeCtx(), "", 5, 1, 4, []);
      expect(prompt).toMatch(/put it in the "reasoning" field/);
    });
  });

  // ==========================================================================
  // parseCoordinationResponse
  // ==========================================================================
  describe("parseCoordinationResponse", () => {
    it("parses a valid respond action with text response", () => {
      const result = parseCoordinationResponse(
        '{"action":"respond","response":"y","reasoning":"Approve the file write"}',
      );
      expect(result).not.toBeNull();
      expect(result?.action).toBe("respond");
      expect(result?.response).toBe("y");
      expect(result?.reasoning).toBe("Approve the file write");
      expect(result?.useKeys).toBeUndefined();
    });

    it("parses a valid respond action with keys", () => {
      const result = parseCoordinationResponse(
        '{"action":"respond","useKeys":true,"keys":["down","enter"],"reasoning":"Select second option"}',
      );
      expect(result).not.toBeNull();
      expect(result?.action).toBe("respond");
      expect(result?.useKeys).toBe(true);
      expect(result?.keys).toEqual(["down", "enter"]);
    });

    it("parses an escalate action", () => {
      const result = parseCoordinationResponse(
        '{"action":"escalate","reasoning":"Design decision needed"}',
      );
      expect(result).not.toBeNull();
      expect(result?.action).toBe("escalate");
      expect(result?.reasoning).toBe("Design decision needed");
    });

    it("parses an ignore action", () => {
      const result = parseCoordinationResponse(
        '{"action":"ignore","reasoning":"Not actually blocked"}',
      );
      expect(result).not.toBeNull();
      expect(result?.action).toBe("ignore");
    });

    it("returns null for garbage text", () => {
      expect(parseCoordinationResponse("I have no idea")).toBeNull();
    });

    it("returns null for invalid action", () => {
      expect(
        parseCoordinationResponse('{"action":"dance","reasoning":"why not"}'),
      ).toBeNull();
    });

    it("returns null for respond with no response or keys", () => {
      expect(
        parseCoordinationResponse('{"action":"respond","reasoning":"hmm"}'),
      ).toBeNull();
    });

    it("extracts JSON from surrounding text", () => {
      const result = parseCoordinationResponse(
        'Here is my analysis:\n{"action":"escalate","reasoning":"Needs review"}\nThat is my answer.',
      );
      expect(result).not.toBeNull();
      expect(result?.action).toBe("escalate");
    });

    it("provides default reasoning when missing", () => {
      const result = parseCoordinationResponse('{"action":"escalate"}');
      expect(result).not.toBeNull();
      expect(result?.reasoning).toBe("No reasoning provided");
    });

    it("returns null for malformed JSON", () => {
      expect(parseCoordinationResponse("{action: respond}")).toBeNull();
    });
  });
});
