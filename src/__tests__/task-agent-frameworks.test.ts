/**
 * Task-agent framework preference tests.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
  mock,
} from "bun:test";
import * as childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let mockHome = os.homedir();

const mockExecFileSync = jest.fn(() => {
  throw new Error("not found");
});

mock.module("node:child_process", () => ({
  ...childProcess,
  execFileSync: mockExecFileSync,
}));

mock.module("node:os", () => ({
  ...os,
  homedir: () => mockHome,
}));

const {
  clearTaskAgentFrameworkStateCache,
  getTaskAgentFrameworkState,
  isUsageExhaustedTaskAgentError,
  markTaskAgentFrameworkHealthy,
  markTaskAgentFrameworkUnavailable,
} = await import("../services/task-agent-frameworks.js");

const originalEnv = { ...process.env };

function createRuntime(settings: Record<string, unknown> = {}) {
  return {
    getSetting: jest.fn((key: string) => settings[key]),
  };
}

describe("task-agent framework preferences", () => {
  let tempHome: string;
  let configPath: string;

  beforeEach(() => {
    jest.clearAllMocks();
    clearTaskAgentFrameworkStateCache();
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "task-agent-fw-"));
    mockHome = tempHome;
    configPath = path.join(tempHome, "milady.json");
    process.env.HOME = tempHome;
    process.env.MILADY_CONFIG_PATH = configPath;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  });

  afterEach(() => {
    clearTaskAgentFrameworkStateCache();
    markTaskAgentFrameworkHealthy("claude");
    markTaskAgentFrameworkHealthy("codex");
    markTaskAgentFrameworkHealthy("gemini");
    markTaskAgentFrameworkHealthy("aider");
    fs.rmSync(tempHome, { recursive: true, force: true });
    for (const [key, value] of Object.entries(originalEnv)) {
      process.env[key] = value;
    }
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
  });

  it("prefers Claude Code when the Claude subscription is configured and auth is present", async () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agents: { defaults: { subscriptionProvider: "anthropic-subscription" } },
      }),
    );
    fs.mkdirSync(path.join(tempHome, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(tempHome, ".claude", ".credentials.json"),
      JSON.stringify({ accessToken: "claude-token" }),
    );

    const state = await getTaskAgentFrameworkState(
      createRuntime() as never,
      {
        checkAvailableAgents: async () =>
          [
            { adapter: "claude", installed: true },
            { adapter: "codex", installed: true },
          ] as never,
      },
    );

    expect(state.preferred.id).toBe("claude");
    expect(state.configuredSubscriptionProvider).toBe("anthropic-subscription");
    expect(
      state.frameworks.find((framework) => framework.id === "claude")
        ?.subscriptionReady,
    ).toBe(true);
  });

  it("normalizes human-readable preflight adapter labels from live CLI probes", async () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agents: { defaults: { subscriptionProvider: "anthropic-subscription" } },
      }),
    );
    fs.mkdirSync(path.join(tempHome, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(tempHome, ".claude", ".credentials.json"),
      JSON.stringify({ accessToken: "claude-token" }),
    );
    fs.mkdirSync(path.join(tempHome, ".codex"), { recursive: true });
    fs.writeFileSync(
      path.join(tempHome, ".codex", "auth.json"),
      JSON.stringify({ OPENAI_API_KEY: "codex-token" }),
    );

    const state = await getTaskAgentFrameworkState(
      createRuntime() as never,
      {
        checkAvailableAgents: async () =>
          [
            { adapter: "Claude Code", installed: true },
            { adapter: "OpenAI Codex", installed: true },
          ] as never,
      },
    );

    expect(
      state.frameworks.find((framework) => framework.id === "claude")
        ?.installed,
    ).toBe(true);
    expect(
      state.frameworks.find((framework) => framework.id === "codex")
        ?.installed,
    ).toBe(true);
    expect(state.preferred.id).toBe("claude");
  });

  it("prefers Codex when the OpenAI subscription is configured and auth is present", async () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agents: { defaults: { subscriptionProvider: "openai-codex" } },
      }),
    );
    fs.mkdirSync(path.join(tempHome, ".codex"), { recursive: true });
    fs.writeFileSync(
      path.join(tempHome, ".codex", "auth.json"),
      JSON.stringify({ OPENAI_API_KEY: "codex-token" }),
    );

    const state = await getTaskAgentFrameworkState(
      createRuntime() as never,
      {
        checkAvailableAgents: async () =>
          [
            { adapter: "claude", installed: true },
            { adapter: "codex", installed: true },
          ] as never,
      },
    );

    expect(state.preferred.id).toBe("codex");
    expect(state.configuredSubscriptionProvider).toBe("openai-codex");
    expect(
      state.frameworks.find((framework) => framework.id === "codex")
        ?.subscriptionReady,
    ).toBe(true);
  });

  it("respects an explicit PARALLAX_DEFAULT_AGENT_TYPE override", async () => {
    fs.writeFileSync(configPath, JSON.stringify({}));

    const state = await getTaskAgentFrameworkState(
      createRuntime({ PARALLAX_DEFAULT_AGENT_TYPE: "gemini" }) as never,
      {
        checkAvailableAgents: async () =>
          [
            { adapter: "claude", installed: true },
            { adapter: "gemini", installed: true },
          ] as never,
      },
    );

    expect(state.preferred.id).toBe("gemini");
    expect(state.preferred.reason).toContain("PARALLAX_DEFAULT_AGENT_TYPE");
  });

  it("fails over when a preferred framework is temporarily disabled", async () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agents: { defaults: { subscriptionProvider: "openai-codex" } },
      }),
    );
    fs.mkdirSync(path.join(tempHome, ".codex"), { recursive: true });
    fs.writeFileSync(
      path.join(tempHome, ".codex", "auth.json"),
      JSON.stringify({ OPENAI_API_KEY: "codex-token" }),
    );
    process.env.ANTHROPIC_API_KEY = "anthropic-key";

    markTaskAgentFrameworkUnavailable("codex", "out of credits");

    const state = await getTaskAgentFrameworkState(
      createRuntime() as never,
      {
        checkAvailableAgents: async () =>
          [
            { adapter: "claude", installed: true },
            { adapter: "codex", installed: true },
          ] as never,
      },
    );

    expect(state.preferred.id).toBe("claude");
    expect(
      state.frameworks.find((framework) => framework.id === "codex")
        ?.temporarilyDisabled,
    ).toBe(true);
  });

  it("detects quota and credit depletion errors", () => {
    expect(isUsageExhaustedTaskAgentError("AI_APICallError: insufficient credits")).toBe(
      true,
    );
    expect(
      isUsageExhaustedTaskAgentError(
        "You've hit your usage limit. Visit settings/usage to purchase more credits.",
      ),
    ).toBe(true);
    expect(
      isUsageExhaustedTaskAgentError(
        "The codex agent session has stalled (usage-limit/spinner) and you hit usage limits.",
      ),
    ).toBe(true);
    expect(isUsageExhaustedTaskAgentError("status code: 402 payment required")).toBe(
      true,
    );
    expect(isUsageExhaustedTaskAgentError("network timeout")).toBe(false);
  });
});
