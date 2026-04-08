import type { IAgentRuntime } from "@elizaos/core";
import type { AgentCredentials } from "coding-agent-adapters";
import { readConfigCloudKey, readConfigEnvKey } from "./config-env.js";

const ELIZA_CLOUD_ANTHROPIC_BASE = "https://www.elizacloud.ai/api";
const ELIZA_CLOUD_OPENAI_BASE = "https://www.elizacloud.ai/api/v1";

export function buildAgentCredentials(
  runtime: IAgentRuntime,
): AgentCredentials {
  const llmProvider =
    readConfigEnvKey("PARALLAX_LLM_PROVIDER") || "subscription";

  if (llmProvider === "cloud") {
    const cloudKey = readConfigCloudKey("apiKey");
    if (!cloudKey) {
      throw new Error(
        "Eliza Cloud is selected as the LLM provider but no cloud.apiKey is paired. Pair your account in the Cloud settings section first.",
      );
    }
    const cloudCredentials = {
      anthropicKey: cloudKey,
      openaiKey: cloudKey,
      googleKey: undefined,
      anthropicBaseUrl: ELIZA_CLOUD_ANTHROPIC_BASE,
      openaiBaseUrl: ELIZA_CLOUD_OPENAI_BASE,
      githubToken: runtime.getSetting("GITHUB_TOKEN") as string | undefined,
    } as AgentCredentials & {
      anthropicBaseUrl?: string;
      openaiBaseUrl?: string;
    };
    return cloudCredentials;
  }

  const subscriptionMode = llmProvider === "subscription";
  const directCredentials = {
    anthropicKey: subscriptionMode
      ? undefined
      : (runtime.getSetting("ANTHROPIC_API_KEY") as string | undefined),
    openaiKey: runtime.getSetting("OPENAI_API_KEY") as string | undefined,
    googleKey: runtime.getSetting("GOOGLE_GENERATIVE_AI_API_KEY") as
      | string
      | undefined,
    githubToken: runtime.getSetting("GITHUB_TOKEN") as string | undefined,
    anthropicBaseUrl: subscriptionMode
      ? undefined
      : (runtime.getSetting("ANTHROPIC_BASE_URL") as string | undefined),
    openaiBaseUrl: runtime.getSetting("OPENAI_BASE_URL") as
      | string
      | undefined,
  } as AgentCredentials & {
    anthropicBaseUrl?: string;
    openaiBaseUrl?: string;
  };
  return directCredentials;
}
