/**
 * Handler logic for the START_CODING_TASK action.
 *
 * - handleMultiAgent()  -- Multi-agent mode (pipe-delimited `agents` param)
 * - handleSingleAgent() -- Single-agent mode (standard handler path)
 *
 * @module actions/coding-task-handlers
 */

import {
  type ActionResult,
  type HandlerCallback,
  type IAgentRuntime,
  logger,
  type Memory,
  ModelType,
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
import type { CodingWorkspaceService } from "../services/workspace-service.js";
import type { AgentSelectionStrategy } from "../services/agent-selection.js";
import {
  createScratchDir,
  generateLabel,
  registerSessionEvents,
} from "./coding-task-helpers.js";

/** Maximum number of agents that can be spawned in a single multi-agent call */
const MAX_CONCURRENT_AGENTS = 8;

/** Known agent type prefixes used in "agentType:task" spec format. */
const KNOWN_AGENT_PREFIXES = [
  "claude", "claude-code", "claudecode", "codex", "openai",
  "gemini", "google", "aider", "pi", "pi-ai", "piai",
  "pi-coding-agent", "picodingagent", "shell", "bash",
] as const;

/**
 * Strip an agent-type prefix from a spec string (e.g. "claude:Fix the bug" → "Fix the bug").
 * Returns the original string if no known prefix is found.
 */
function stripAgentPrefix(spec: string): string {
  const colonIdx = spec.indexOf(":");
  if (colonIdx <= 0 || colonIdx >= 20) return spec;
  const prefix = spec.slice(0, colonIdx).trim().toLowerCase();
  if ((KNOWN_AGENT_PREFIXES as readonly string[]).includes(prefix)) {
    return spec.slice(colonIdx + 1).trim();
  }
  return spec;
}

/**
 * Generate a shared context brief for a swarm of agents.
 * The LLM produces shared guidance (style, conventions, constraints) from
 * the user's request and subtask list. Task-type agnostic — works for coding,
 * research, writing, or any multi-agent workflow.
 */
async function generateSwarmContext(
  runtime: IAgentRuntime,
  subtasks: string[],
  userRequest: string,
): Promise<string> {
  const taskList = subtasks
    .map((t, i) => `  ${i + 1}. ${t}`)
    .join("\n");

  const prompt =
    `You are an AI orchestrator about to launch ${subtasks.length} parallel agents. ` +
    `Before they start, produce a brief shared context document so all agents stay aligned.\n\n` +
    `User's request: "${userRequest}"\n\n` +
    `Subtasks being assigned:\n${taskList}\n\n` +
    `Generate a concise shared context brief (3-8 bullet points) covering:\n` +
    `- Project intent and overall goal\n` +
    `- Key constraints or preferences from the user's request\n` +
    `- Conventions all agents should follow (naming, style, patterns, tone)\n` +
    `- How subtasks relate to each other (dependencies, shared interfaces, etc.)\n` +
    `- Any decisions that should be consistent across all agents\n\n` +
    `Only include what's relevant — skip categories that don't apply. ` +
    `Be specific and actionable, not generic. Keep it under 200 words.\n\n` +
    `Output ONLY the bullet points, no preamble.`;

  try {
    const result = await runtime.useModel(ModelType.TEXT_SMALL, {
      prompt,
      maxTokens: 400,
      temperature: 0.3,
    });
    return result?.trim() || "";
  } catch (err) {
    logger.warn(`Swarm context generation failed: ${err}`);
    return "";
  }
}

/** Shared context passed to both multi-agent and single-agent handlers */
export interface CodingTaskContext {
  runtime: IAgentRuntime;
  ptyService: PTYService;
  wsService: CodingWorkspaceService | undefined;
  credentials: AgentCredentials;
  customCredentials: Record<string, string> | undefined;
  callback: HandlerCallback | undefined;
  message: Memory;
  state: State | undefined;
  repo: string | undefined;
  defaultAgentType: CodingAgentType;
  rawAgentType: string;
  agentSelectionStrategy: AgentSelectionStrategy;
  memoryContent: string | undefined;
  approvalPreset: string | undefined;
  explicitLabel: string | undefined;
}

/**
 * Multi-agent mode handler.
 *
 * Parses pipe-delimited agent specs and spawns each agent in its own
 * workspace clone (or scratch directory).
 */
export async function handleMultiAgent(
  ctx: CodingTaskContext,
  agentsParam: string,
): Promise<ActionResult | undefined> {
  const {
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
    memoryContent,
    approvalPreset,
    explicitLabel,
  } = ctx;

  // Parse pipe-delimited agent specs: "task1 | task2 | agentType:task3"
  const agentSpecs = agentsParam
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);

  if (agentSpecs.length === 0) {
    if (callback) {
      await callback({
        text: "No agent tasks provided in agents parameter.",
      });
    }
    return { success: false, error: "EMPTY_AGENTS_PARAM" };
  }

  // Cap multi-agent count to the concurrency limit
  if (agentSpecs.length > MAX_CONCURRENT_AGENTS) {
    if (callback) {
      await callback({
        text: `Too many agents requested (${agentSpecs.length}). Maximum is ${MAX_CONCURRENT_AGENTS}.`,
      });
    }
    return { success: false, error: "TOO_MANY_AGENTS" };
  }

  if (repo && !wsService) {
    if (callback) {
      await callback({
        text: "Workspace Service is not available. Cannot clone repository.",
      });
    }
    return { success: false, error: "WORKSPACE_SERVICE_UNAVAILABLE" };
  }

  if (callback) {
    await callback({
      text: `Launching ${agentSpecs.length} agents${repo ? ` on ${repo}` : ""}...`,
    });
  }

  // Planning phase: generate shared context brief for multi-agent coordination.
  // Strip agent-type prefixes from specs to get clean subtask descriptions.
  const cleanSubtasks = agentSpecs.map(stripAgentPrefix);
  const userRequest = (message.content as { text?: string })?.text ?? agentsParam;
  const swarmContext = agentSpecs.length > 1
    ? await generateSwarmContext(runtime, cleanSubtasks, userRequest)
    : "";

  // Store swarm context on coordinator for use in decision prompts
  if (swarmContext) {
    const coordinator = getCoordinator(runtime);
    coordinator?.setSwarmContext(swarmContext);
  }

  const results: Array<{
    sessionId: string;
    agentType: string;
    workdir: string;
    workspaceId?: string;
    branch?: string;
    label: string;
    status: string;
    error?: string;
  }> = [];

  for (const [i, spec] of agentSpecs.entries()) {
    // Parse optional "agentType:task" prefix.
    // In fixed mode, ignore LLM-chosen prefixes — all agents use the
    // configured default. Only ranked mode allows per-subtask overrides.
    let specAgentType = defaultAgentType;
    let specPiRequested = isPiAgentType(rawAgentType);
    let specRequestedType = rawAgentType;
    let specTask = spec;
    const colonIdx = spec.indexOf(":");
    if (
      ctx.agentSelectionStrategy !== "fixed" &&
      colonIdx > 0 &&
      colonIdx < 20
    ) {
      const prefix = spec.slice(0, colonIdx).trim().toLowerCase();
      if ((KNOWN_AGENT_PREFIXES as readonly string[]).includes(prefix)) {
        specRequestedType = prefix;
        specPiRequested = isPiAgentType(prefix);
        specAgentType = normalizeAgentType(prefix);
        specTask = spec.slice(colonIdx + 1).trim();
      }
    } else if (ctx.agentSelectionStrategy === "fixed" && colonIdx > 0 && colonIdx < 20) {
      // Strip the prefix from the task text but keep the default agent type
      specTask = stripAgentPrefix(spec);
    }

    // Generate label for this specific agent
    const specLabel = explicitLabel
      ? `${explicitLabel}-${i + 1}`
      : generateLabel(repo, specTask);

    try {
      // Provision workspace (each agent gets its own clone or scratch dir)
      let workdir: string;
      let workspaceId: string | undefined;
      let branch: string | undefined;

      if (repo && wsService) {
        const workspace = await wsService.provisionWorkspace({ repo });
        workdir = workspace.path;
        workspaceId = workspace.id;
        branch = workspace.branch;
        wsService.setLabel(workspace.id, specLabel);
      } else {
        workdir = createScratchDir();
      }

      // Preflight check
      if (specAgentType !== "shell" && specAgentType !== "pi") {
        const [preflight] = await ptyService.checkAvailableAgents([
          specAgentType as Exclude<CodingAgentType, "shell" | "pi">,
        ]);
        if (preflight && !preflight.installed) {
          results.push({
            sessionId: "",
            agentType: specAgentType,
            workdir,
            label: specLabel,
            status: "failed",
            error: `${preflight.adapter} CLI is not installed`,
          });
          continue;
        }
      }

      // Check if coordinator is active — route blocking prompts through it
      const coordinator = getCoordinator(runtime);

      // Spawn the agent — prepend shared context brief if available
      const taskWithContext = swarmContext
        ? `${specTask}\n\n--- Shared Context (from project planning) ---\n${swarmContext}\n--- End Shared Context ---`
        : specTask;
      const initialTask = specPiRequested ? toPiCommand(taskWithContext) : taskWithContext;
      const displayType = specPiRequested ? "pi" : specAgentType;
      const session: SessionInfo = await ptyService.spawnSession({
        name: `coding-${Date.now()}-${i}`,
        agentType: specAgentType,
        workdir,
        initialTask,
        memoryContent,
        credentials,
        approvalPreset:
          (approvalPreset as ApprovalPreset | undefined) ??
          ptyService.defaultApprovalPreset,
        customCredentials,
        ...(coordinator ? { skipAdapterAutoResponse: true } : {}),
        metadata: {
          requestedType: specRequestedType,
          messageId: message.id,
          userId: (message as unknown as Record<string, unknown>).userId,
          workspaceId,
          label: specLabel,
          multiAgentIndex: i,
        },
      });

      // Register event handler
      const isScratch = !repo;
      const scratchDir = isScratch ? workdir : null;
      registerSessionEvents(
        ptyService,
        runtime,
        session.id,
        specLabel,
        scratchDir,
        callback,
        !!coordinator,
      );
      if (coordinator && specTask) {
        coordinator.registerTask(session.id, {
          agentType: specAgentType,
          label: specLabel,
          originalTask: specTask,
          workdir,
          repo,
        });
      }

      results.push({
        sessionId: session.id,
        agentType: displayType,
        workdir,
        workspaceId,
        branch,
        label: specLabel,
        status: session.status,
      });

      if (callback) {
        await callback({
          text: `[${i + 1}/${agentSpecs.length}] Spawned ${displayType} agent as "${specLabel}"`,
        });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        `[START_CODING_TASK] Failed to spawn agent ${i + 1}:`,
        errorMessage,
      );
      results.push({
        sessionId: "",
        agentType: specAgentType,
        workdir: "",
        label: specLabel,
        status: "failed",
        error: errorMessage,
      });
    }
  }

  // Store all sessions in state
  if (state) {
    state.codingSessions = results.filter((r) => r.sessionId);
  }

  const succeeded = results.filter((r) => r.sessionId);
  const failed = results.filter((r) => !r.sessionId);
  const summary = [
    `Launched ${succeeded.length}/${agentSpecs.length} agents${repo ? ` on ${repo}` : ""}:`,
    ...succeeded.map(
      (r) => `  - "${r.label}" (${r.agentType}) [session: ${r.sessionId}]`,
    ),
    ...(failed.length > 0
      ? [`Failed: ${failed.map((r) => `"${r.label}": ${r.error}`).join(", ")}`]
      : []),
  ].join("\n");

  if (callback) {
    await callback({ text: summary });
  }

  return {
    success: failed.length === 0,
    text: summary,
    data: { agents: results },
  };
}

/**
 * Single-agent mode handler.
 *
 * Provisions a workspace (clone or scratch) and spawns a single coding agent.
 */
export async function handleSingleAgent(
  ctx: CodingTaskContext,
  task: string | undefined,
): Promise<ActionResult | undefined> {
  logger.debug(
    `[START_CODING_TASK] handleSingleAgent called, agentType=${ctx.defaultAgentType}, task=${task ? "yes" : "none"}, repo=${ctx.repo ?? "none"}`,
  );
  const {
    runtime,
    ptyService,
    wsService,
    credentials,
    customCredentials,
    callback,
    message,
    state,
    repo,
    defaultAgentType: agentType,
    rawAgentType,
    memoryContent,
    approvalPreset,
    explicitLabel,
  } = ctx;

  // Generate or use explicit label
  const label = explicitLabel || generateLabel(repo, task);

  // --- Step 1: Resolve workspace directory ---
  let workdir: string;
  let workspaceId: string | undefined;
  let branch: string | undefined;

  if (repo) {
    if (!wsService) {
      if (callback) {
        await callback({
          text: "Workspace Service is not available. Cannot clone repository.",
        });
      }
      return { success: false, error: "WORKSPACE_SERVICE_UNAVAILABLE" };
    }

    try {
      if (callback) {
        await callback({ text: `Cloning ${repo}...` });
      }

      const workspace = await wsService.provisionWorkspace({ repo });
      workdir = workspace.path;
      workspaceId = workspace.id;
      branch = workspace.branch;

      wsService.setLabel(workspace.id, label);

      if (state) {
        state.codingWorkspace = {
          id: workspace.id,
          path: workspace.path,
          branch: workspace.branch,
          isWorktree: workspace.isWorktree,
          label,
        };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (callback) {
        await callback({
          text: `Failed to clone repository: ${errorMessage}`,
        });
      }
      return { success: false, error: errorMessage };
    }
  } else {
    workdir = createScratchDir();
  }

  // --- Step 2: Spawn the agent ---
  logger.debug(
    `[START_CODING_TASK] Spawning ${agentType} agent, task: ${task ? `"${task.slice(0, 80)}..."` : "(none)"}, workdir: ${workdir}`,
  );
  try {
    if (agentType !== "shell" && agentType !== "pi") {
      const [preflight] = await ptyService.checkAvailableAgents([
        agentType as Exclude<CodingAgentType, "shell" | "pi">,
      ]);
      if (preflight && !preflight.installed) {
        logger.warn(
          `[START_CODING_TASK] ${preflight.adapter} CLI not installed`,
        );
        if (callback) {
          await callback({
            text: `${preflight.adapter} CLI is not installed.\nInstall with: ${preflight.installCommand}\nDocs: ${preflight.docsUrl}`,
          });
        }
        return { success: false, error: "AGENT_NOT_INSTALLED" };
      }
      logger.debug(
        `[START_CODING_TASK] Preflight OK: ${preflight?.adapter} installed`,
      );
    }

    const piRequested = isPiAgentType(rawAgentType);
    const initialTask = piRequested ? toPiCommand(task) : task;
    const displayType = piRequested ? "pi" : agentType;

    // Check if coordinator is active — route blocking prompts through it
    const coordinator = getCoordinator(runtime);

    logger.debug(
      `[START_CODING_TASK] Calling spawnSession (${agentType}, coordinator=${!!coordinator})`,
    );
    const session: SessionInfo = await ptyService.spawnSession({
      name: `coding-${Date.now()}`,
      agentType,
      workdir,
      initialTask,
      memoryContent,
      credentials,
      approvalPreset:
        (approvalPreset as ApprovalPreset | undefined) ??
        ptyService.defaultApprovalPreset,
      customCredentials,
      ...(coordinator ? { skipAdapterAutoResponse: true } : {}),
      metadata: {
        requestedType: rawAgentType,
        messageId: message.id,
        userId: (message as unknown as Record<string, unknown>).userId,
        workspaceId,
        label,
      },
    });
    logger.debug(
      `[START_CODING_TASK] Session spawned: ${session.id} (${session.status})`,
    );

    // Register event handler
    const isScratchWorkspace = !repo;
    const scratchDir = isScratchWorkspace ? workdir : null;
    registerSessionEvents(
      ptyService,
      runtime,
      session.id,
      label,
      scratchDir,
      callback,
      !!coordinator,
    );
    if (coordinator && task) {
      coordinator.registerTask(session.id, {
        agentType,
        label,
        originalTask: task,
        workdir,
        repo,
      });
    }

    if (state) {
      state.codingSession = {
        id: session.id,
        agentType: session.agentType,
        workdir: session.workdir,
        status: session.status,
      };
    }

    const summary = repo
      ? `Cloned ${repo} and started ${displayType} agent as "${label}"${task ? ` with task: "${task}"` : ""}`
      : `Started ${displayType} agent as "${label}" in scratch workspace${task ? ` with task: "${task}"` : ""}`;

    if (callback) {
      await callback({ text: `${summary}\nSession ID: ${session.id}` });
    }

    return {
      success: true,
      text: summary,
      data: {
        sessionId: session.id,
        agentType: displayType,
        workdir: session.workdir,
        workspaceId,
        branch,
        label,
        status: session.status,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("[START_CODING_TASK] Failed to spawn agent:", errorMessage);

    if (callback) {
      await callback({
        text: `Failed to start coding agent: ${errorMessage}`,
      });
    }
    return { success: false, error: errorMessage };
  }
}
