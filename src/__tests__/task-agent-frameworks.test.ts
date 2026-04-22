/**
 * Tests for task-agent framework discovery, specifically covering the
 * `agents.defaults.orchestrator.codexSubscriptionRestrictedToCodexFramework`
 * config flag. When set, Codex (ChatGPT Plus/Pro) subscription tokens must
 * only count toward `subscriptionReady`/`authReady` for the `codex` framework.
 *
 * We isolate the filesystem by pointing MILADY_STATE_DIR and HOME at a temp
 * directory, then writing a fake Codex auth.json + milady.json. No mocks of
 * the module graph — we exercise the real config readers.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { IAgentRuntime } from "@elizaos/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readConfigCodexSubscriptionRestrictedToCodexFramework } from "../services/config-env.js";
import {
  clearTaskAgentFrameworkStateCache,
  getTaskAgentFrameworkState,
} from "../services/task-agent-frameworks.js";

function createRuntime(): IAgentRuntime {
  const runtime = {
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
    getSetting: () => undefined,
    getService: () => null,
  };
  return runtime as unknown as IAgentRuntime;
}

interface FrameworkFixture {
  tmpRoot: string;
  previous: {
    MILADY_STATE_DIR: string | undefined;
    ELIZA_STATE_DIR: string | undefined;
    ELIZA_NAMESPACE: string | undefined;
    MILADY_CONFIG_PATH: string | undefined;
    ELIZA_CONFIG_PATH: string | undefined;
    HOME: string | undefined;
    USERPROFILE: string | undefined;
    OPENAI_API_KEY: string | undefined;
    ANTHROPIC_API_KEY: string | undefined;
    GOOGLE_API_KEY: string | undefined;
    GOOGLE_GENERATIVE_AI_API_KEY: string | undefined;
    PARALLAX_LLM_PROVIDER: string | undefined;
    PARALLAX_DEFAULT_AGENT_TYPE: string | undefined;
  };
}

function setupFixture(): FrameworkFixture {
  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "orch-frameworks-"));
  const stateDir = path.join(tmpRoot, ".milady");
  const homeDir = path.join(tmpRoot, "home");
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(path.join(homeDir, ".codex"), { recursive: true });

  const previous = {
    MILADY_STATE_DIR: process.env.MILADY_STATE_DIR,
    ELIZA_STATE_DIR: process.env.ELIZA_STATE_DIR,
    ELIZA_NAMESPACE: process.env.ELIZA_NAMESPACE,
    MILADY_CONFIG_PATH: process.env.MILADY_CONFIG_PATH,
    ELIZA_CONFIG_PATH: process.env.ELIZA_CONFIG_PATH,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
    GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    PARALLAX_LLM_PROVIDER: process.env.PARALLAX_LLM_PROVIDER,
    PARALLAX_DEFAULT_AGENT_TYPE: process.env.PARALLAX_DEFAULT_AGENT_TYPE,
  };

  process.env.MILADY_STATE_DIR = stateDir;
  process.env.ELIZA_STATE_DIR = stateDir;
  delete process.env.ELIZA_NAMESPACE;
  delete process.env.MILADY_CONFIG_PATH;
  delete process.env.ELIZA_CONFIG_PATH;
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;
  // Scrub API keys so authReady only flows through sub detection in these tests.
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  delete process.env.PARALLAX_LLM_PROVIDER;
  delete process.env.PARALLAX_DEFAULT_AGENT_TYPE;

  // Plant a Codex subscription token so hasCodexSubscriptionAuth() returns true.
  writeFileSync(
    path.join(homeDir, ".codex", "auth.json"),
    JSON.stringify({ OPENAI_API_KEY: "sk-codex-test-token" }),
    "utf8",
  );

  clearTaskAgentFrameworkStateCache();
  return { tmpRoot, previous };
}

function teardownFixture(fixture: FrameworkFixture): void {
  for (const [key, value] of Object.entries(fixture.previous)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  rmSync(fixture.tmpRoot, { recursive: true, force: true });
  clearTaskAgentFrameworkStateCache();
}

function writeMiladyConfig(
  fixture: FrameworkFixture,
  config: Record<string, unknown>,
): void {
  writeFileSync(
    path.join(fixture.tmpRoot, ".milady", "milady.json"),
    JSON.stringify(config),
    "utf8",
  );
  clearTaskAgentFrameworkStateCache();
}

describe("codexSubscriptionRestrictedToCodexFramework flag", () => {
  let fixture: FrameworkFixture;

  beforeEach(() => {
    fixture = setupFixture();
  });

  afterEach(() => {
    teardownFixture(fixture);
  });

  it("preserves today's behavior when the flag is unset (Codex sub counted for codex)", async () => {
    writeMiladyConfig(fixture, {});
    const state = await getTaskAgentFrameworkState(createRuntime());
    const codex = state.frameworks.find((f) => f.id === "codex");
    expect(codex?.subscriptionReady).toBe(true);
  });

  it("preserves today's behavior when the flag is explicitly false", async () => {
    writeMiladyConfig(fixture, {
      agents: {
        defaults: {
          orchestrator: { codexSubscriptionRestrictedToCodexFramework: false },
        },
      },
    });
    const state = await getTaskAgentFrameworkState(createRuntime());
    const codex = state.frameworks.find((f) => f.id === "codex");
    expect(codex?.subscriptionReady).toBe(true);
    expect(codex?.authReady).toBe(true);
  });

  it("still counts Codex sub toward codex framework when flag is true", async () => {
    writeMiladyConfig(fixture, {
      agents: {
        defaults: {
          orchestrator: { codexSubscriptionRestrictedToCodexFramework: true },
        },
      },
    });
    const state = await getTaskAgentFrameworkState(createRuntime());
    const codex = state.frameworks.find((f) => f.id === "codex");
    expect(codex?.subscriptionReady).toBe(true);
    expect(codex?.authReady).toBe(true);
  });

  it("does not mark claude framework as subscriptionReady via Codex sub even without the flag", async () => {
    writeMiladyConfig(fixture, {});
    const state = await getTaskAgentFrameworkState(createRuntime());
    const claude = state.frameworks.find((f) => f.id === "claude");
    // Regression guard: claude's subscriptionReady is independent of Codex sub.
    expect(claude?.subscriptionReady).toBe(false);
  });

  it("gates aider's authReady through Codex sub only when flag is unset", async () => {
    // Flip between flag=false and flag=true with the same Codex sub token in
    // place. If aider's authReady is different between runs, the gate works.
    // If it's identical (e.g. the developer has a real Claude sub in the
    // macOS keychain that satisfies claudeAuthReady regardless), skip — the
    // behavior under test is masked by an environment signal we can't clear.
    writeMiladyConfig(fixture, {
      agents: {
        defaults: {
          orchestrator: { codexSubscriptionRestrictedToCodexFramework: false },
        },
      },
    });
    const unrestricted = await getTaskAgentFrameworkState(createRuntime());
    const aiderUnrestricted = unrestricted.frameworks.find(
      (f) => f.id === "aider",
    );
    // Without the flag, Codex sub alone should make aider auth-ready.
    expect(aiderUnrestricted?.authReady).toBe(true);

    writeMiladyConfig(fixture, {
      agents: {
        defaults: {
          orchestrator: { codexSubscriptionRestrictedToCodexFramework: true },
        },
      },
    });
    const restricted = await getTaskAgentFrameworkState(createRuntime());
    const aiderRestricted = restricted.frameworks.find((f) => f.id === "aider");
    const claudeRestricted = restricted.frameworks.find(
      (f) => f.id === "claude",
    );

    // If the host provides a Claude sub via keychain/API key, aider stays
    // auth-ready through that path — the flag only removes the Codex route.
    if (claudeRestricted?.authReady) {
      expect(aiderRestricted?.authReady).toBe(true);
    } else {
      expect(aiderRestricted?.authReady).toBe(false);
    }
  });

  it("reads the flag from agents.defaults.orchestrator in milady.json", () => {
    writeMiladyConfig(fixture, {});
    expect(readConfigCodexSubscriptionRestrictedToCodexFramework()).toBe(false);

    writeMiladyConfig(fixture, {
      agents: {
        defaults: {
          orchestrator: { codexSubscriptionRestrictedToCodexFramework: true },
        },
      },
    });
    expect(readConfigCodexSubscriptionRestrictedToCodexFramework()).toBe(true);

    writeMiladyConfig(fixture, {
      agents: {
        defaults: {
          orchestrator: { codexSubscriptionRestrictedToCodexFramework: false },
        },
      },
    });
    expect(readConfigCodexSubscriptionRestrictedToCodexFramework()).toBe(false);

    // Non-boolean values don't accidentally coerce to true.
    writeMiladyConfig(fixture, {
      agents: {
        defaults: {
          orchestrator: {
            codexSubscriptionRestrictedToCodexFramework: "true",
          },
        },
      },
    });
    expect(readConfigCodexSubscriptionRestrictedToCodexFramework()).toBe(false);
  });
});
