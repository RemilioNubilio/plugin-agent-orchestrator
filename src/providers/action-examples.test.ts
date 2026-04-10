/**
 * Tests for conditional task-agent examples injection.
 */

import { beforeEach, describe, expect, it, jest } from "bun:test";
import { codingAgentExamplesProvider } from "./action-examples";

const mockRuntime = {
  getService: jest.fn(),
  getSetting: jest.fn(),
} as never;
const mockState = {} as never;

function mockMessage(text: string) {
  return { content: { text } } as never;
}

describe("codingAgentExamplesProvider", () => {
  beforeEach(() => {
    mockRuntime.getService.mockReturnValue(undefined);
    mockRuntime.getSetting.mockReturnValue(undefined);
  });

  it("returns a compact summary for non-task messages", async () => {
    const result = await codingAgentExamplesProvider.get(
      mockRuntime,
      mockMessage("What is the difference between a stack and a queue?"),
      mockState,
    );
    expect(result.text).toContain("CREATE_TASK");
    expect(result.text).toContain("# Task Agent Action Call Examples");
    expect(result.text).not.toContain("Examples:");
  });

  it("returns full examples for task-agent requests", async () => {
    const result = await codingAgentExamplesProvider.get(
      mockRuntime,
      mockMessage("Can you clone this repo, fix the login bug, and keep me updated?"),
      mockState,
    );
    expect(result.text).toContain("# Task Agent Action Call Examples");
    expect(result.text).toContain("Examples:");
    expect(result.text).toContain("<action>CREATE_TASK</action>");
  });

  it("detects task-agent keywords like 'agent'", async () => {
    const result = await codingAgentExamplesProvider.get(
      mockRuntime,
      mockMessage("Tell the agent to accept those changes"),
      mockState,
    );
    expect(result.text).toContain("Examples:");
  });

  it("detects repo-oriented requests", async () => {
    const result = await codingAgentExamplesProvider.get(
      mockRuntime,
      mockMessage("Set up https://github.com/acme/app and investigate the test failures"),
      mockState,
    );
    expect(result.text).toContain("Examples:");
  });

  it("returns full examples for browser or website workflows", async () => {
    const result = await codingAgentExamplesProvider.get(
      mockRuntime,
      mockMessage("Use a sub-agent to inspect that website thread and post a reply"),
      mockState,
    );
    expect(result.text).toContain("Examples:");
    expect(result.text).toContain("NOT limited to coding");
    expect(result.text).toContain("operate websites and forms");
  });

  it("returns the compact variant for casual conversation", async () => {
    const result = await codingAgentExamplesProvider.get(
      mockRuntime,
      mockMessage("How are you doing today?"),
      mockState,
    );
    expect(result.text).not.toContain("<action>CREATE_TASK</action>");
  });

  it("handles string content type", async () => {
    const result = await codingAgentExamplesProvider.get(
      mockRuntime,
      { content: "Clone the repo and deploy it" } as never,
      mockState,
    );
    expect(result.text).toContain("# Task Agent Action Call Examples");
  });

  it("avoids false positives on generic words embedded in other words", async () => {
    const result = await codingAgentExamplesProvider.get(
      mockRuntime,
      mockMessage("The reagent is building up in the container"),
      mockState,
    );
    expect(result.text).not.toContain("Examples:");
  });
});
