/**
 * Task-agent framework discovery and preference resolution.
 *
 * Detects installed CLIs, available auth, and Milady subscription preferences so
 * the orchestrator can choose the best framework when the caller does not
 * specify one explicitly.
 *
 * @module services/task-agent-frameworks
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { IAgentRuntime } from "@elizaos/core";
import type { PreflightResult } from "coding-agent-adapters";

export type SupportedTaskAgentAdapter =
  | "claude"
  | "codex"
  | "gemini"
  | "aider";
export type TaskAgentFrameworkId = SupportedTaskAgentAdapter | "pi";

export interface TaskAgentFrameworkAvailability {
  id: TaskAgentFrameworkId;
  label: string;
  installed: boolean;
  authReady: boolean;
  subscriptionReady: boolean;
  recommended: boolean;
  reason: string;
  installCommand?: string;
  docsUrl?: string;
}

export interface PreferredTaskAgent {
  id: TaskAgentFrameworkId;
  reason: string;
}

export interface TaskAgentFrameworkState {
  configuredSubscriptionProvider?: string;
  frameworks: TaskAgentFrameworkAvailability[];
  preferred: PreferredTaskAgent;
}

export interface TaskAgentFrameworkProbe {
  checkAvailableAgents?: (
    types?: SupportedTaskAgentAdapter[],
  ) => Promise<PreflightResult[]>;
}

const FRAMEWORK_LABELS: Record<TaskAgentFrameworkId, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
  aider: "Aider",
  pi: "Pi",
};

const STANDARD_FRAMEWORKS: SupportedTaskAgentAdapter[] = [
  "claude",
  "codex",
  "gemini",
  "aider",
];

const TASK_AGENT_COMPLEXITY_RE =
  /\b(repo|repository|code|coding|debug|fix|implement|investigate|research|analyze|analysis|summarize|summary|write|draft|document|plan|workflow|automation|parallel|delegate|subtask|agent|orchestrate|coordinate|compare|test|tests|pull request|pr\b|branch|commit)\b/i;

let frameworkStateCache:
  | {
      expiresAt: number;
      value: TaskAgentFrameworkState;
    }
  | undefined;

function safeGetSetting(
  runtime: IAgentRuntime | undefined,
  key: string,
): string | undefined {
  if (!runtime) return undefined;
  try {
    const value = runtime.getSetting(key);
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

function getUserHomeDir(): string {
  return (
    process.env.HOME?.trim() ||
    process.env.USERPROFILE?.trim() ||
    os.homedir()
  );
}

function readJsonFile(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function extractOauthAccessToken(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const record = value as Record<string, unknown>;
  const direct = record.accessToken ?? record.access_token;
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }
  for (const nested of Object.values(record)) {
    const token = extractOauthAccessToken(nested);
    if (token) return token;
  }
  return;
}

function resolveMiladyConfigPath(): string {
  const explicit =
    process.env.MILADY_CONFIG_PATH?.trim() ||
    process.env.ELIZA_CONFIG_PATH?.trim();
  if (explicit) return explicit;

  const stateDir =
    process.env.MILADY_STATE_DIR?.trim() ||
    process.env.ELIZA_STATE_DIR?.trim() ||
    path.join(getUserHomeDir(), ".milady");
  const namespace = process.env.ELIZA_NAMESPACE?.trim();
  const filename =
    !namespace || namespace === "milady" ? "milady.json" : `${namespace}.json`;
  return path.join(stateDir, filename);
}

function readConfiguredSubscriptionProvider(): string | undefined {
  const config = readJsonFile(resolveMiladyConfigPath());
  if (!config || typeof config !== "object" || Array.isArray(config)) return;
  const agents = (config as Record<string, unknown>).agents;
  if (!agents || typeof agents !== "object" || Array.isArray(agents)) return;
  const defaults = (agents as Record<string, unknown>).defaults;
  if (!defaults || typeof defaults !== "object" || Array.isArray(defaults))
    return;
  const provider = (defaults as Record<string, unknown>).subscriptionProvider;
  return typeof provider === "string" && provider.trim()
    ? provider.trim()
    : undefined;
}

function hasClaudeSubscriptionAuth(): boolean {
  const credentialsPath = path.join(
    getUserHomeDir(),
    ".claude",
    ".credentials.json",
  );
  const fileToken = extractOauthAccessToken(readJsonFile(credentialsPath));
  if (fileToken) return true;

  if (process.platform !== "darwin") return false;
  try {
    const raw = execFileSync(
      "security",
      ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
      { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    if (!raw) return false;
    return Boolean(extractOauthAccessToken(JSON.parse(raw)));
  } catch {
    return false;
  }
}

function hasClaudeApiKey(runtime?: IAgentRuntime): boolean {
  return Boolean(
    process.env.ANTHROPIC_API_KEY?.trim() ||
      safeGetSetting(runtime, "ANTHROPIC_API_KEY"),
  );
}

function hasCodexSubscriptionAuth(): boolean {
  const authPath = path.join(getUserHomeDir(), ".codex", "auth.json");
  const auth = readJsonFile(authPath);
  if (!auth || typeof auth !== "object" || Array.isArray(auth)) return false;
  const key = (auth as Record<string, unknown>).OPENAI_API_KEY;
  return typeof key === "string" && key.trim().length > 0;
}

function hasCodexApiKey(runtime?: IAgentRuntime): boolean {
  return Boolean(
    process.env.OPENAI_API_KEY?.trim() ||
      safeGetSetting(runtime, "OPENAI_API_KEY"),
  );
}

function hasGeminiCredential(runtime?: IAgentRuntime): boolean {
  return Boolean(
    process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ||
      process.env.GOOGLE_API_KEY?.trim() ||
      safeGetSetting(runtime, "GOOGLE_GENERATIVE_AI_API_KEY") ||
      safeGetSetting(runtime, "GOOGLE_API_KEY"),
  );
}

function hasPiBinary(): boolean {
  const command = process.platform === "win32" ? "where" : "which";
  const args = process.platform === "win32" ? ["pi.exe"] : ["pi"];
  try {
    execFileSync(command, args, {
      encoding: "utf8",
      timeout: 1500,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

async function computeTaskAgentFrameworkState(
  runtime: IAgentRuntime,
  probe?: TaskAgentFrameworkProbe,
): Promise<TaskAgentFrameworkState> {
  const configuredSubscriptionProvider = readConfiguredSubscriptionProvider();
  const preflightByAdapter = new Map<SupportedTaskAgentAdapter, PreflightResult>();

  if (probe?.checkAvailableAgents) {
    try {
      const results = await probe.checkAvailableAgents(STANDARD_FRAMEWORKS);
      for (const result of results) {
        if (
          result.adapter === "claude" ||
          result.adapter === "codex" ||
          result.adapter === "gemini" ||
          result.adapter === "aider"
        ) {
          preflightByAdapter.set(result.adapter, result);
        }
      }
    } catch {
      // Keep status surfaces alive even if preflight fails transiently.
    }
  }

  const claudeSubscriptionReady = hasClaudeSubscriptionAuth();
  const claudeAuthReady = claudeSubscriptionReady || hasClaudeApiKey(runtime);
  const codexSubscriptionReady = hasCodexSubscriptionAuth();
  const codexAuthReady = codexSubscriptionReady || hasCodexApiKey(runtime);
  const geminiAuthReady = hasGeminiCredential(runtime);
  const piReady = hasPiBinary();

  const providerPrefersClaude =
    configuredSubscriptionProvider === "anthropic-subscription";
  const providerPrefersCodex =
    configuredSubscriptionProvider === "openai-codex" ||
    configuredSubscriptionProvider === "openai-subscription";

  const frameworks: TaskAgentFrameworkAvailability[] = STANDARD_FRAMEWORKS.map(
    (id) => {
      const preflight = preflightByAdapter.get(id);
      const installed = preflight?.installed === true;
      const subscriptionReady =
        id === "claude"
          ? claudeSubscriptionReady
          : id === "codex"
            ? codexSubscriptionReady
            : false;
      const authReady =
        id === "claude"
          ? claudeAuthReady
          : id === "codex"
            ? codexAuthReady
            : id === "gemini"
              ? geminiAuthReady
              : claudeAuthReady || codexAuthReady || geminiAuthReady;
      const reason =
        id === "claude" && subscriptionReady
          ? "ready to use the user's Claude subscription"
          : id === "codex" && subscriptionReady
            ? "ready to use the user's OpenAI subscription"
            : installed
              ? authReady
                ? "installed with credentials available"
                : "installed but credentials were not detected"
              : "CLI not detected";
      return {
        id,
        label: FRAMEWORK_LABELS[id],
        installed,
        authReady,
        subscriptionReady,
        recommended: false,
        reason,
        installCommand: preflight?.installCommand,
        docsUrl: preflight?.docsUrl,
      };
    },
  );

  frameworks.push({
    id: "pi",
    label: FRAMEWORK_LABELS.pi,
    installed: piReady,
    authReady: piReady,
    subscriptionReady: false,
    recommended: false,
    reason: piReady ? "CLI detected" : "CLI not detected",
  });

  const byId = new Map(frameworks.map((framework) => [framework.id, framework]));
  const explicitDefault = safeGetSetting(runtime, "PARALLAX_DEFAULT_AGENT_TYPE")
    ?.toLowerCase()
    .trim();
  let preferred: PreferredTaskAgent;

  if (
    explicitDefault &&
    (explicitDefault === "claude" ||
      explicitDefault === "codex" ||
      explicitDefault === "gemini" ||
      explicitDefault === "aider" ||
      explicitDefault === "pi") &&
    byId.get(explicitDefault)?.installed
  ) {
    preferred = {
      id: explicitDefault,
      reason: "explicit PARALLAX_DEFAULT_AGENT_TYPE override",
    };
  } else if (providerPrefersClaude && byId.get("claude")?.installed && claudeSubscriptionReady) {
    preferred = {
      id: "claude",
      reason: "configured Claude subscription should drive Claude Code first",
    };
  } else if (providerPrefersCodex && byId.get("codex")?.installed && codexSubscriptionReady) {
    preferred = {
      id: "codex",
      reason: "configured OpenAI subscription should drive Codex first",
    };
  } else if (byId.get("claude")?.installed && claudeSubscriptionReady) {
    preferred = {
      id: "claude",
      reason: "Claude Code is installed and the user is logged in",
    };
  } else if (byId.get("codex")?.installed && codexSubscriptionReady) {
    preferred = {
      id: "codex",
      reason: "Codex is installed and the user is logged in",
    };
  } else if (byId.get("claude")?.installed && claudeAuthReady) {
    preferred = {
      id: "claude",
      reason: "Claude Code is installed and credentials are available",
    };
  } else if (byId.get("codex")?.installed && codexAuthReady) {
    preferred = {
      id: "codex",
      reason: "Codex is installed and credentials are available",
    };
  } else if (byId.get("gemini")?.installed && geminiAuthReady) {
    preferred = {
      id: "gemini",
      reason: "Gemini CLI is installed and credentials are available",
    };
  } else {
    const fallback =
      frameworks.find((framework) => framework.installed) ?? frameworks[0];
    preferred = {
      id: fallback.id,
      reason: fallback.installed
        ? "best available installed task-agent framework"
        : "default fallback while no task-agent CLI is installed",
    };
  }

  for (const framework of frameworks) {
    framework.recommended = framework.id === preferred.id;
  }

  return {
    configuredSubscriptionProvider,
    frameworks,
    preferred,
  };
}

export async function getTaskAgentFrameworkState(
  runtime: IAgentRuntime,
  probe?: TaskAgentFrameworkProbe,
): Promise<TaskAgentFrameworkState> {
  if (frameworkStateCache && frameworkStateCache.expiresAt > Date.now()) {
    return frameworkStateCache.value;
  }
  const value = await computeTaskAgentFrameworkState(runtime, probe);
  frameworkStateCache = {
    expiresAt: Date.now() + 15_000,
    value,
  };
  return value;
}

export function clearTaskAgentFrameworkStateCache(): void {
  frameworkStateCache = undefined;
}

export function formatTaskAgentFrameworkLine(
  framework: TaskAgentFrameworkAvailability,
): string {
  const parts = [
    framework.installed ? "installed" : "not installed",
    framework.authReady ? "credentials ready" : "credentials missing",
  ];
  if (framework.subscriptionReady) {
    parts.push("uses the user's subscription");
  }
  if (framework.recommended) {
    parts.push("recommended");
  }
  return `- ${framework.label}: ${parts.join(", ")}. ${framework.reason}.`;
}

export function looksLikeTaskAgentRequest(text: string): boolean {
  return TASK_AGENT_COMPLEXITY_RE.test(text);
}

export function formatTaskAgentStatus(status: string): string {
  switch (status) {
    case "ready":
      return "idle";
    case "busy":
      return "working";
    case "starting":
      return "starting";
    case "authenticating":
      return "authenticating";
    default:
      return status;
  }
}

export function truncateTaskAgentText(text: string, max = 120): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}...` : trimmed;
}

export function rewriteTaskAgentText(text: string): string {
  return text
    .replace(/\bcoding agents\b/gi, "task agents")
    .replace(/\bcoding agent\b/gi, "task agent")
    .replace(/\bcoding sessions\b/gi, "task-agent sessions")
    .replace(/\bcoding session\b/gi, "task-agent session");
}

export { FRAMEWORK_LABELS as TASK_AGENT_FRAMEWORK_LABELS };
