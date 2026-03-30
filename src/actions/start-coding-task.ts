/**
 * START_CODING_TASK action - Unified action to set up and launch coding agents
 *
 * Combines workspace provisioning and agent spawning into a single atomic action.
 * - If a repo URL is provided, clones it into a fresh workspace
 * - If no repo, creates a scratch sandbox directory
 * - Spawns the specified coding agent(s) in that workspace with the given task
 * - Supports multi-agent mode via pipe-delimited `agents` param
 *
 * This eliminates the need for multi-action chaining (PROVISION_WORKSPACE -> SPAWN_CODING_AGENT)
 * and ensures agents always run in an isolated directory.
 *
 * @module actions/start-coding-task
 */

import type {
  Action,
  ActionResult,
  HandlerCallback,
  HandlerOptions,
  IAgentRuntime,
  Memory,
  State,
} from "@elizaos/core";
import type { AgentCredentials } from "coding-agent-adapters";
import type { PTYService } from "../services/pty-service.js";
import { getCoordinator } from "../services/pty-service.js";
import { normalizeAgentType } from "../services/pty-types.js";
import type { CodingWorkspaceService } from "../services/workspace-service.js";
import {
  type CodingTaskContext,
  handleMultiAgent,
} from "./coding-task-handlers.js";

export const startCodingTaskAction: Action = {
  name: "START_CODING_TASK",

  similes: [
    "LAUNCH_CODING_TASK",
    "RUN_CODING_TASK",
    "START_AGENT_TASK",
    "SPAWN_AND_PROVISION",
    "CODE_THIS",
  ],

  description:
    "Start a coding task: optionally clone a repo, then spawn a coding agent (Claude Code, Codex, Gemini, Aider, Pi) " +
    "to work on it. If no repo is provided, the agent runs in a safe scratch directory. " +
    "Use this whenever the user asks to work on code, research something with an agent, or run any agent task. " +
    "IMPORTANT: If the user references a repository from conversation history (e.g. 'in the same repo', " +
    "'on that project', 'add a feature to it'), you MUST include the repo URL in the `repo` parameter. " +
    "If the task involves code changes to a real project but you don't know the repo URL, ASK the user for it " +
    "before calling this action — do not default to a scratch directory for real project work.",

  examples: [
    [
      {
        name: "{{user1}}",
        content: {
          text: "Set up a workspace for https://github.com/acme/my-app and have Claude fix the auth bug",
        },
      },
      {
        name: "{{agentName}}",
        content: {
          text: "I'll clone the repo and spawn Claude to fix the auth bug.",
          action: "START_CODING_TASK",
        },
      },
    ],
    [
      {
        name: "{{user1}}",
        content: {
          text: "Use a coding agent to research the latest React patterns",
        },
      },
      {
        name: "{{agentName}}",
        content: {
          text: "I'll spin up an agent to research that for you.",
          action: "START_CODING_TASK",
        },
      },
    ],
  ],

  validate: async (
    runtime: IAgentRuntime,
    _message: Memory,
  ): Promise<boolean> => {
    const ptyService = runtime.getService("PTY_SERVICE") as unknown as
      | PTYService
      | undefined;
    return ptyService != null;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<ActionResult | undefined> => {
    const ptyService = runtime.getService("PTY_SERVICE") as unknown as
      | PTYService
      | undefined;
    if (!ptyService) {
      if (callback) {
        await callback({
          text: "PTY Service is not available. Cannot start coding task.",
        });
      }
      return { success: false, error: "SERVICE_UNAVAILABLE" };
    }

    const wsService = runtime.getService(
      "CODING_WORKSPACE_SERVICE",
    ) as unknown as CodingWorkspaceService | undefined;

    // Extract parameters
    const params = options?.parameters;
    const content = message.content as Record<string, unknown>;

    const explicitRawType =
      (params?.agentType as string) ?? (content.agentType as string);
    const rawAgentType =
      explicitRawType ?? (await ptyService.resolveAgentType());
    const defaultAgentType = normalizeAgentType(rawAgentType);
    const memoryContent =
      (params?.memoryContent as string) ?? (content.memoryContent as string);
    const approvalPreset =
      (params?.approvalPreset as string) ?? (content.approvalPreset as string);

    // Repo is optional -- extract from params, content, or text
    let repo = (params?.repo as string) ?? (content.repo as string);
    if (!repo && content.text) {
      const urlMatch = (content.text as string).match(
        /https?:\/\/(?:github\.com|gitlab\.com|bitbucket\.org)\/[\w.-]+\/[\w.-]+(?:\.git)?/i,
      );
      if (urlMatch) {
        repo = urlMatch[0];
      }
    }

    // Fallback chain: coordinator memory → disk history → workspace service
    if (!repo) {
      const coordinator = getCoordinator(runtime);
      const lastRepo = await coordinator?.getLastUsedRepoAsync();
      if (lastRepo) {
        repo = lastRepo;
      }
    }
    // Last resort: check workspace service for any tracked workspace with a repo
    if (!repo) {
      const wsService = runtime.getService("CODING_WORKSPACE_SERVICE") as
        unknown as CodingWorkspaceService | undefined;
      if (wsService && typeof wsService.listWorkspaces === "function") {
        const withRepo = wsService
          .listWorkspaces()
          .find((ws) => ws.repo);
        if (withRepo) {
          repo = withRepo.repo;
        }
      }
    }

    // Build credentials (shared across all agents)
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

    const credentials: AgentCredentials = {
      anthropicKey: runtime.getSetting("ANTHROPIC_API_KEY") as
        | string
        | undefined,
      openaiKey: runtime.getSetting("OPENAI_API_KEY") as string | undefined,
      googleKey: runtime.getSetting("GOOGLE_GENERATIVE_AI_API_KEY") as
        | string
        | undefined,
      githubToken: runtime.getSetting("GITHUB_TOKEN") as string | undefined,
    };

    const explicitLabel =
      (params?.label as string) ?? (content.label as string);

    // Build shared context for handlers
    const ctx: CodingTaskContext = {
      runtime,
      ptyService,
      wsService,
      credentials,
      customCredentials,
      callback,
      message,
      state,
      repo,
      defaultAgentType,
      rawAgentType,
      agentSelectionStrategy: ptyService.agentSelectionStrategy,
      memoryContent,
      approvalPreset,
      explicitLabel,
    };

    // --- Dispatch: build a pipe-delimited agents string for handleMultiAgent ---
    const agentsParam =
      (params?.agents as string) ?? (content.agents as string);

    if (agentsParam) {
      return handleMultiAgent(ctx, agentsParam);
    }

    // Single-agent mode: build a single-element agents string so we can
    // reuse handleMultiAgent (which handles length-1 specs fine).
    const task = (params?.task as string) ?? (content.task as string);
    const singleAgentSpec = task || "";
    return handleMultiAgent(ctx, singleAgentSpec);
  },

  parameters: [
    {
      name: "repo",
      description:
        "Git repository URL to clone (e.g. https://github.com/owner/repo). " +
        "ALWAYS provide this when the user is working on a real project or references a repo from context. " +
        "Only omit for pure research/scratch tasks with no target repository. " +
        "If unsure which repo, ask the user before spawning.",
      required: false,
      schema: { type: "string" as const },
    },
    {
      name: "agentType",
      description:
        "Type of coding agent to spawn (default for all agents). Options: claude, codex, gemini, aider, pi, shell.",
      required: false,
      schema: { type: "string" as const, default: "claude" },
    },
    {
      name: "task",
      description:
        "The task or prompt to send to the agent once it's ready. Used for single-agent mode.",
      required: false,
      schema: { type: "string" as const },
    },
    {
      name: "agents",
      description:
        "Pipe-delimited list of agent tasks for multi-agent mode. Each segment is a task description. " +
        "Optionally prefix with agent type: 'claude:Fix auth | gemini:Write tests | codex:Update docs'. " +
        "Each agent gets its own workspace clone. If provided, the 'task' parameter is ignored.",
      required: false,
      schema: { type: "string" as const },
    },
    {
      name: "memoryContent",
      description:
        "Instructions/context to write to each agent's memory file (e.g. CLAUDE.md) before spawning.",
      required: false,
      schema: { type: "string" as const },
    },
    {
      name: "label",
      description:
        "Short semantic label for this workspace. In multi-agent mode, each agent gets '{label}-1', '{label}-2', etc. " +
        "Auto-generated from repo/task if not provided.",
      required: false,
      schema: { type: "string" as const },
    },
    {
      name: "approvalPreset",
      description:
        "Permission level for all agents: readonly, standard, permissive, autonomous.",
      required: false,
      schema: {
        type: "string" as const,
        enum: ["readonly", "standard", "permissive", "autonomous"],
      },
    },
  ],
};
