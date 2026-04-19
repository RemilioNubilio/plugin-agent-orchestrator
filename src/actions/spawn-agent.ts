/**
 * SPAWN_AGENT action - Spawns a CLI task agent.
 *
 * Creates a new PTY session for a task agent (Claude Code, Codex, etc.)
 * and returns a session ID for subsequent interactions.
 *
 * @module actions/spawn-agent
 */

import * as os from "node:os";
import * as path from "node:path";
import {
  type Action,
  type ActionResult,
  type HandlerCallback,
  type HandlerOptions,
  type IAgentRuntime,
  logger,
  type Memory,
  type State,
} from "@elizaos/core";
import type { AgentCredentials, ApprovalPreset } from "coding-agent-adapters";
import type { PTYService } from "../services/pty-service.js";
import { getCoordinator } from "../services/pty-service.js";
import {
  type CodingAgentType,
  isPiAgentType,
  normalizeAgentType,
  type SessionInfo,
  toPiCommand,
} from "../services/pty-types.js";
import { readConfigEnvKey } from "../services/config-env.js";
import {
  buildAgentCredentials,
  isAnthropicOAuthToken,
  sanitizeCustomCredentials,
} from "../services/agent-credentials.js";
import { looksLikeTaskAgentRequest } from "../services/task-agent-frameworks.js";
import { requireTaskAgentAccess } from "../services/task-policy.js";
import type { CodingWorkspaceService } from "../services/workspace-service.js";
import { mergeTaskThreadEvalMetadata } from "./eval-metadata.js";
import { createScratchDir } from "./coding-task-helpers.js";
import { looksLikeProseTask } from "./start-coding-task.js";

/**
 * Once-per-process warn when CODING_AGENT_SANDBOX=off is in effect, so
 * operators tailing logs can see the app-level workdir check has been
 * deliberately disabled (the OS user + systemd unit are then the only
 * line of defense). Kept outside the handler body so repeated spawns
 * don't spam the log.
 */
let sandboxDisabledWarned = false;
function warnSandboxDisabledOnce(): void {
  if (sandboxDisabledWarned) return;
  sandboxDisabledWarned = true;
  logger.warn(
    "[SPAWN_AGENT] CODING_AGENT_SANDBOX=off — app-level workdir allowlist disabled; relying on the OS user + systemd unit for isolation.",
  );
}

function hasExplicitSpawnPayload(message: Memory): boolean {
  const content =
    message.content && typeof message.content === "object"
      ? (message.content as Record<string, unknown>)
      : null;
  if (!content) {
    return false;
  }

  return (
    typeof content.task === "string" ||
    typeof content.workdir === "string" ||
    typeof content.agentType === "string"
  );
}

function getMessageText(message: Memory): string {
  if (typeof message.content === "string") {
    return message.content;
  }

  return typeof message.content?.text === "string" ? message.content.text : "";
}

export const spawnAgentAction: Action = {
  name: "SPAWN_AGENT",

  similes: [
    "SPAWN_CODING_AGENT",
    "START_CODING_AGENT",
    "LAUNCH_CODING_AGENT",
    "CREATE_CODING_AGENT",
    "SPAWN_CODER",
    "RUN_CODING_AGENT",
    "SPAWN_SUB_AGENT",
    "START_TASK_AGENT",
    "CREATE_AGENT",
  ],

  description:
    "Spawn a specific task agent inside an existing workspace when you need direct control. " +
    "These agents are intentionally open-ended and can handle investigation, writing, planning, testing, synthesis, repo work, and general async task execution. " +
    "Returns a session ID that can be used to interact with the agent.",

  // Spawning kicks off an async subagent whose final answer lands via the
  // synthesis callback, not via this action's ActionResult. Without this
  // flag the bootstrap runtime fires a second action-planning pass as
  // soon as the spawn returns; the planner sees the user's prompt still
  // unanswered (ActionResult.text is intentionally empty to avoid the
  // workspace-path leak — see the text:"" on success above) and invokes
  // SPAWN_AGENT again, producing a duplicate subagent per user prompt.
  // Matches CREATE_TASK, which already has this for the same reason.
  suppressPostActionContinuation: true,

  examples: [
    [
      {
        name: "{{user1}}",
        content: {
          text: "Start a Codex task agent in that workspace and have it continue the investigation.",
        },
      },
      {
        name: "{{agentName}}",
        content: {
          text: "I'll spawn a task agent in the current workspace and hand it the next chunk of work.",
          action: "SPAWN_AGENT",
        },
      },
    ],
    [
      {
        name: "{{user1}}",
        content: {
          text: "Spin up a task agent for the follow-up work in this repo.",
        },
      },
      {
        name: "{{agentName}}",
        content: {
          text: "I'll create a task-agent session for that.",
          action: "SPAWN_AGENT",
        },
      },
    ],
  ],

  validate: async (
    runtime: IAgentRuntime,
    message: Memory,
  ): Promise<boolean> => {
    const ptyService = runtime.getService("PTY_SERVICE") as unknown as
      | PTYService
      | undefined;
    if (!ptyService) {
      logger.warn("[SPAWN_AGENT] PTYService not available");
      return false;
    }

    if (hasExplicitSpawnPayload(message)) {
      return true;
    }

    const text = getMessageText(message).trim();
    if (text.length === 0) {
      return true;
    }

    return looksLikeTaskAgentRequest(text);
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<ActionResult | undefined> => {
    const access = await requireTaskAgentAccess(runtime, message, "create");
    if (!access.allowed) {
      if (callback) {
        await callback({
          text: access.reason,
        });
      }
      return { success: false, error: "FORBIDDEN", text: access.reason };
    }

    const ptyService = runtime.getService("PTY_SERVICE") as unknown as
      | PTYService
      | undefined;
    if (!ptyService) {
      if (callback) {
        await callback({
          text: "PTY Service is not available. Cannot spawn a task agent.",
        });
      }
      return { success: false, error: "SERVICE_UNAVAILABLE" };
    }

    // Extract parameters from options or message content
    const params = options?.parameters;
    const content = message.content as Record<string, unknown>;

    let explicitRawType: string | undefined =
      (params?.agentType as string | undefined) ??
      (content.agentType as string | undefined);
    const task = (params?.task as string) ?? (content.task as string);
    // Same guard as CREATE_TASK: ignore an LLM-supplied shell/pi/bash hint
    // when the task text is prose. See looksLikeProseTask in start-coding-task.
    if (
      explicitRawType &&
      /^(shell|pi|bash)$/i.test(explicitRawType.trim()) &&
      looksLikeProseTask(task)
    ) {
      logger.warn(
        `[SPAWN_AGENT] ignoring agentType="${explicitRawType}" — task text is prose, upgrading to default reasoning framework`,
      );
      explicitRawType = undefined;
    }
    const rawAgentType =
      explicitRawType ??
      (await ptyService.resolveAgentType({
        task,
        workdir:
          ((params?.workdir as string) ?? (content.workdir as string)) ||
          undefined,
      }));
    const agentType = normalizeAgentType(rawAgentType);
    const piRequested = isPiAgentType(rawAgentType);
    const initialTask = piRequested ? toPiCommand(task) : task;

    // Resolve workdir: explicit param > state from PROVISION_WORKSPACE > most recent workspace > cwd
    let workdir = (params?.workdir as string) ?? (content.workdir as string);
    if (!workdir && state?.codingWorkspace) {
      workdir = (state.codingWorkspace as { path: string }).path;
    }
    if (!workdir) {
      // Check workspace service for most recently provisioned workspace
      const wsService = runtime.getService(
        "CODING_WORKSPACE_SERVICE",
      ) as unknown as CodingWorkspaceService | undefined;
      if (wsService) {
        const workspaces = wsService.listWorkspaces();
        if (workspaces.length > 0) {
          workdir = workspaces[workspaces.length - 1].path;
        }
      }
    }
    if (!workdir) {
      // No explicit workdir, no prior PROVISION_WORKSPACE state, no existing
      // service-tracked workspace — fall back to an ephemeral scratch dir
      // (same path START_CODING_TASK takes when the user omits a repo). The
      // previous behavior errored with an API-internal hint; a normie prompt
      // like "build a timer page" shouldn't be blocked by workspace plumbing.
      workdir = createScratchDir(runtime);
    }

    // Validate workdir is within allowed directories. Upstream default is
    // conservative (scratch base + bot cwd); operators extend the allowlist
    // via CODING_AGENT_ALLOWED_WORKDIRS (comma-separated absolute paths,
    // `~`-expansion) or disable the app-level sandbox entirely via
    // CODING_AGENT_SANDBOX=off. The latter is appropriate on single-tenant
    // deployments where the OS-level user + systemd unit are the real
    // boundary and the app-level check is just duplicating their work.
    const resolvedWorkdir = path.resolve(workdir);
    const sandboxSetting = (
      (runtime.getSetting("CODING_AGENT_SANDBOX") as string | undefined) ??
      readConfigEnvKey("CODING_AGENT_SANDBOX") ??
      process.env.CODING_AGENT_SANDBOX ??
      ""
    )
      .trim()
      .toLowerCase();
    const sandboxDisabled =
      sandboxSetting === "off" ||
      sandboxSetting === "false" ||
      sandboxSetting === "0";
    if (sandboxDisabled) {
      warnSandboxDisabledOnce();
      workdir = resolvedWorkdir;
    } else {
      const extraAllowed =
        (runtime.getSetting("CODING_AGENT_ALLOWED_WORKDIRS") as string) ??
        process.env.CODING_AGENT_ALLOWED_WORKDIRS ??
        "";
      const workspaceBaseDir = path.join(os.homedir(), ".milady", "workspaces");
      const parallaxCodingDir =
        (runtime.getSetting("PARALLAX_CODING_DIRECTORY") as string) ??
        readConfigEnvKey("PARALLAX_CODING_DIRECTORY") ??
        process.env.PARALLAX_CODING_DIRECTORY;
      const expandHome = (p: string) =>
        p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
      const allowedPrefixes = [
        path.resolve(workspaceBaseDir),
        path.resolve(process.cwd()),
        ...(parallaxCodingDir?.trim()
          ? [path.resolve(expandHome(parallaxCodingDir.trim()))]
          : []),
        ...extraAllowed
          .split(",")
          .map((p) => p.trim())
          .filter((p) => p.length > 0)
          .map((p) => path.resolve(expandHome(p))),
      ];
      const isAllowed = allowedPrefixes.some(
        (prefix) =>
          resolvedWorkdir.startsWith(prefix + path.sep) ||
          resolvedWorkdir === prefix,
      );
      if (!isAllowed) {
        if (callback) {
          await callback({
            text:
              `can't write to \`${resolvedWorkdir}\` — not in my sandbox. ` +
              `tell the operator to add it to CODING_AGENT_ALLOWED_WORKDIRS ` +
              `or set CODING_AGENT_SANDBOX=off for full VPS access.`,
          });
        }
        return { success: false, error: "WORKDIR_OUTSIDE_ALLOWED" };
      }
      workdir = resolvedWorkdir;
    }

    const memoryContent =
      (params?.memoryContent as string) ?? (content.memoryContent as string);
    const approvalPreset =
      (params?.approvalPreset as string) ?? (content.approvalPreset as string);

    // Custom credentials for MCP servers and other integrations
    const customCredentialKeys = runtime.getSetting("CUSTOM_CREDENTIAL_KEYS") as
      | string
      | undefined;
    let customCredentials: Record<string, string> | undefined;
    if (customCredentialKeys) {
      customCredentials = {};
      for (const key of customCredentialKeys.split(",").map((k) => k.trim())) {
        const val = runtime.getSetting(key) as string | undefined;
        if (val) customCredentials[key] = val;
      }
    }
    const rawAnthropicKey = runtime.getSetting("ANTHROPIC_API_KEY") as
      | string
      | undefined;
    customCredentials = sanitizeCustomCredentials(
      customCredentials,
      isAnthropicOAuthToken(rawAnthropicKey) ? [rawAnthropicKey] : [],
    );

    // Build credentials based on the user's configured LLM provider.
    // Throws if cloud mode is selected but no cloud API key is paired.
    const llmProvider =
      readConfigEnvKey("PARALLAX_LLM_PROVIDER") || "subscription";
    let credentials: AgentCredentials;
    try {
      credentials = buildAgentCredentials(runtime);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to build credentials";
      logger.error(`[spawn-agent] ${msg}`);
      if (callback) {
        await callback({ text: msg });
      }
      return { success: false, error: "INVALID_CREDENTIALS" };
    }

    try {
      // Check if the agent CLI is installed (for non-shell agents)
      if (agentType !== "shell" && agentType !== "pi") {
        const [preflight] = await ptyService.checkAvailableAgents([
          agentType as Exclude<CodingAgentType, "shell" | "pi">,
        ]);
        if (preflight && !preflight.installed) {
          if (callback) {
            await callback({
              text:
                `${preflight.adapter} CLI is not installed.\n` +
                `Install with: ${preflight.installCommand}\n` +
                `Docs: ${preflight.docsUrl}`,
            });
          }
          return { success: false, error: "AGENT_NOT_INSTALLED" };
        }
      }

      // Check if coordinator is active — route blocking prompts through it
      const coordinator = getCoordinator(runtime);
      const evalMetadata = mergeTaskThreadEvalMetadata(message, {
        source: "spawn-agent-action",
        messageId: message.id,
        requestedType: rawAgentType,
      });
      const taskThread =
        coordinator && task
          ? await coordinator.createTaskThread({
              title: `agent-${Date.now()}`,
              originalRequest: task,
              roomId:
                typeof (message as unknown as Record<string, unknown>)
                  .roomId === "string"
                  ? ((message as unknown as Record<string, unknown>)
                      .roomId as string)
                  : null,
              ownerUserId:
                typeof (message as unknown as Record<string, unknown>)
                  .userId === "string"
                  ? ((message as unknown as Record<string, unknown>)
                      .userId as string)
                  : null,
              scenarioId: evalMetadata.scenarioId,
              batchId: evalMetadata.batchId,
              metadata: evalMetadata.metadata,
            })
          : null;

      // Spawn the PTY session
      const session: SessionInfo = await ptyService.spawnSession({
        name: `task-${Date.now()}`,
        agentType,
        workdir,
        initialTask,
        memoryContent,
        credentials,
        approvalPreset:
          (approvalPreset as ApprovalPreset | undefined) ??
          ptyService.defaultApprovalPreset,
        customCredentials,
        // Let adapter auto-response handle startup prompts (API key, trust, etc.)
        // when using cloud/API key mode — the LLM coordinator misinterprets these.
        // In subscription mode, the coordinator handles all prompts.
        ...(coordinator && llmProvider === "subscription"
          ? { skipAdapterAutoResponse: true }
          : {}),
        metadata: {
          threadId: taskThread?.id,
          requestedType: rawAgentType,
          messageId: message.id,
          userId: (message as unknown as Record<string, unknown>).userId,
        },
      });

      // Register event handler for this session
      ptyService.onSessionEvent((sessionId, event, data) => {
        if (sessionId !== session.id) return;

        // Log session events for debugging
        logger.debug(
          `[Session ${sessionId}] ${event}: ${JSON.stringify(data)}`,
        );

        // When coordinator is active it owns chat messaging for these events
        if (!coordinator) {
          // Handle blocked state - agent is waiting for input
          if (event === "blocked" && callback) {
            callback({
              text: `Task agent is waiting for input: ${(data as { prompt?: string }).prompt ?? "unknown prompt"}`,
            });
          }

          // Handle completion
          if (event === "completed" && callback) {
            callback({
              text: "Task agent completed the task.",
            });
          }

          // Handle errors
          if (event === "error" && callback) {
            callback({
              text: `Task agent encountered an error: ${(data as { message?: string }).message ?? "unknown error"}`,
            });
          }
        }
      });
      if (coordinator && task) {
        await coordinator.registerTask(session.id, {
          threadId: taskThread?.id ?? session.id,
          agentType,
          label: `agent-${session.id.slice(-8)}`,
          originalTask: task,
          workdir,
        });
      }

      // Store session info in state for subsequent actions

      if (state) {
        state.codingSession = {
          id: session.id,
          agentType: session.agentType,
          workdir: session.workdir,
          status: session.status,
        };
      }

      // Spawn-success is coordinator-internal — the synthesis callback
      // delivers the real outcome once the subagent finishes. Returning
      // non-empty `text` here triggers the bootstrap runtime to auto-post
      // it (see runtime.ts action-result routing), which is what leaked
      // the workdir + task prompt + Session ID dump into Discord.
      return {
        success: true,
        text: "",
        data: {
          sessionId: session.id,
          agentType: piRequested ? "pi" : session.agentType,
          workdir: session.workdir,
          status: session.status,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("[SPAWN_AGENT] Failed to spawn agent:", errorMessage);

      if (callback) {
        await callback({
          text: `Failed to spawn task agent: ${errorMessage}`,
        });
      }

      return { success: false, error: errorMessage };
    }
  },

  parameters: [
    {
      name: "agentType",
      description:
        "Specific task-agent framework to spawn. Options: claude (Claude Code), codex (OpenAI Codex), gemini (Google Gemini), aider, pi, shell (generic shell). " +
        "If omitted, the orchestrator picks the preferred available framework.",
      required: false,
      schema: { type: "string" as const },
    },
    {
      name: "workdir",
      description:
        "Working directory for the agent. Defaults to current directory.",
      descriptionCompressed:
        "Spawn task agent in existing workspace for direct control.",
      required: false,
      schema: { type: "string" as const },
    },
    {
      name: "task",
      description:
        "Open-ended task or prompt to send to the task agent once spawned.",
      required: false,
      schema: { type: "string" as const },
    },
    {
      name: "memoryContent",
      description:
        "Instructions or shared context to write to the task agent's memory file before spawning.",
      required: false,
      schema: { type: "string" as const },
    },
    {
      name: "approvalPreset",
      description:
        "Permission level for the task agent: readonly (safe audit), standard (reads+web auto, writes prompt), permissive (file ops auto, shell prompts), autonomous (all auto, use with sandbox)",
      required: false,
      schema: {
        type: "string" as const,
        enum: ["readonly", "standard", "permissive", "autonomous"],
      },
    },
  ],
};

export const spawnTaskAgentAction = spawnAgentAction;
