import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { IAgentRuntime } from "@elizaos/core";
import { afterEach, describe, expect, it } from "bun:test";
import { buildAgentCredentials } from "../services/agent-credentials.js";

function createRuntime(
  settings: Record<string, string | undefined>,
): Pick<IAgentRuntime, "getSetting"> {
  return {
    getSetting(key: string) {
      return settings[key];
    },
  };
}

function writeConfig(
  provider: "subscription" | "api_keys" | "cloud",
  cloudApiKey?: string,
): string {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "milady-config-"));
  fs.writeFileSync(
    path.join(stateDir, "milady.json"),
    JSON.stringify(
      {
        env: {
          PARALLAX_LLM_PROVIDER: provider,
        },
        ...(cloudApiKey ? { cloud: { apiKey: cloudApiKey } } : {}),
      },
      null,
      2,
    ),
  );
  return stateDir;
}

const stateDirs: string[] = [];
const previousEnv = {
  MILADY_STATE_DIR: process.env.MILADY_STATE_DIR,
  ELIZA_STATE_DIR: process.env.ELIZA_STATE_DIR,
  ELIZA_NAMESPACE: process.env.ELIZA_NAMESPACE,
};

afterEach(() => {
  process.env.MILADY_STATE_DIR = previousEnv.MILADY_STATE_DIR;
  process.env.ELIZA_STATE_DIR = previousEnv.ELIZA_STATE_DIR;
  process.env.ELIZA_NAMESPACE = previousEnv.ELIZA_NAMESPACE;

  while (stateDirs.length > 0) {
    const stateDir = stateDirs.pop();
    if (stateDir) {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  }
});

describe("buildAgentCredentials", () => {
  it("omits Anthropic API credentials in subscription mode", () => {
    const stateDir = writeConfig("subscription");
    stateDirs.push(stateDir);
    process.env.MILADY_STATE_DIR = stateDir;
    delete process.env.ELIZA_STATE_DIR;
    process.env.ELIZA_NAMESPACE = "milady";

    const credentials = buildAgentCredentials(
      createRuntime({
        ANTHROPIC_API_KEY: "bad-anthropic-key",
        ANTHROPIC_BASE_URL: "https://anthropic.example",
        OPENAI_API_KEY: "openai-key",
        OPENAI_BASE_URL: "https://openai.example",
        GOOGLE_GENERATIVE_AI_API_KEY: "google-key",
        GITHUB_TOKEN: "github-token",
      }) as IAgentRuntime,
    );

    expect(credentials.anthropicKey).toBeUndefined();
    expect(credentials.anthropicBaseUrl).toBeUndefined();
    expect(credentials.openaiKey).toBe("openai-key");
    expect(credentials.openaiBaseUrl).toBe("https://openai.example");
    expect(credentials.googleKey).toBe("google-key");
    expect(credentials.githubToken).toBe("github-token");
  });

  it("keeps direct API credentials in api_keys mode", () => {
    const stateDir = writeConfig("api_keys");
    stateDirs.push(stateDir);
    process.env.MILADY_STATE_DIR = stateDir;
    delete process.env.ELIZA_STATE_DIR;
    process.env.ELIZA_NAMESPACE = "milady";

    const credentials = buildAgentCredentials(
      createRuntime({
        ANTHROPIC_API_KEY: "anthropic-key",
        ANTHROPIC_BASE_URL: "https://anthropic.example",
        OPENAI_API_KEY: "openai-key",
      }) as IAgentRuntime,
    );

    expect(credentials.anthropicKey).toBe("anthropic-key");
    expect(credentials.anthropicBaseUrl).toBe("https://anthropic.example");
    expect(credentials.openaiKey).toBe("openai-key");
  });

  it("uses the paired Eliza Cloud key in cloud mode", () => {
    const stateDir = writeConfig("cloud", "cloud-key");
    stateDirs.push(stateDir);
    process.env.MILADY_STATE_DIR = stateDir;
    delete process.env.ELIZA_STATE_DIR;
    process.env.ELIZA_NAMESPACE = "milady";

    const credentials = buildAgentCredentials(
      createRuntime({
        GITHUB_TOKEN: "github-token",
      }) as IAgentRuntime,
    );

    expect(credentials.anthropicKey).toBe("cloud-key");
    expect(credentials.openaiKey).toBe("cloud-key");
    expect(credentials.anthropicBaseUrl).toBe(
      "https://www.elizacloud.ai/api",
    );
    expect(credentials.openaiBaseUrl).toBe(
      "https://www.elizacloud.ai/api/v1",
    );
    expect(credentials.githubToken).toBe("github-token");
  });
});
