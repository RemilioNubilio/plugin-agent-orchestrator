/**
 * Tests for conditional coding agent examples injection.
 */

import { describe, expect, it } from "bun:test";
import { codingAgentExamplesProvider } from "./action-examples";

const mockRuntime = {} as never;
const mockState = {} as never;

function mockMessage(text: string) {
  return { content: { text } } as never;
}

describe("codingAgentExamplesProvider", () => {
  it("returns brief summary for non-coding messages", async () => {
    const result = await codingAgentExamplesProvider.get(
      mockRuntime,
      mockMessage("What is the difference between a stack and a queue?"),
      mockState,
    );
    expect(result.text).toContain("START_CODING_TASK");
    expect(result.text).not.toContain("# Coding Agent Action Call Examples");
    expect(result.text!.length).toBeLessThan(500);
  });

  it("returns full examples for coding-related messages", async () => {
    const result = await codingAgentExamplesProvider.get(
      mockRuntime,
      mockMessage("Can you clone this repo and fix the login bug?"),
      mockState,
    );
    expect(result.text).toContain("# Coding Agent Action Call Examples");
    expect(result.text).toContain("Single Agent Examples");
    expect(result.text).toContain("Multi-Agent Example");
  });

  it("detects coding keywords like 'agent'", async () => {
    const result = await codingAgentExamplesProvider.get(
      mockRuntime,
      mockMessage("Tell the agent to accept those changes"),
      mockState,
    );
    expect(result.text).toContain("# Coding Agent Action Call Examples");
  });

  it("detects 'github' keyword", async () => {
    const result = await codingAgentExamplesProvider.get(
      mockRuntime,
      mockMessage("Set up https://github.com/acme/app"),
      mockState,
    );
    expect(result.text).toContain("# Coding Agent Action Call Examples");
  });

  it("returns brief for casual conversation", async () => {
    const result = await codingAgentExamplesProvider.get(
      mockRuntime,
      mockMessage("How are you doing today?"),
      mockState,
    );
    expect(result.text).not.toContain("# Coding Agent Action Call Examples");
  });

  it("handles string content type (not just object)", async () => {
    const result = await codingAgentExamplesProvider.get(
      mockRuntime,
      { content: "Clone the repo and deploy it" } as never,
      mockState,
    );
    expect(result.text).toContain("# Coding Agent Action Call Examples");
  });

  it("avoids false positives on generic words embedded in other words", async () => {
    const result = await codingAgentExamplesProvider.get(
      mockRuntime,
      mockMessage("The reagent is building up in the container"),
      mockState,
    );
    expect(result.text).not.toContain("# Coding Agent Action Call Examples");
  });
});
