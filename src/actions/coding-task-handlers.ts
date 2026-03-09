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
import { withTrajectoryContext } from "../services/trajectory-context.js";
import {
  formatPastExperience,
  queryPastExperience,
} from "../services/trajectory-feedback.js";
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
 * Build CLAUDE.md instructions that tell a swarm agent how to coordinate.
 * Each agent gets awareness of its role within the swarm and instructions
 * to surface design decisions explicitly so the orchestrator can share them.
 */
function buildSwarmMemoryInstructions(
  agentLabel: string,
  agentTask: string,
  allSubtasks: string[],
  agentIndex: number,
): string {
  const siblingTasks = allSubtasks
    .filter((_, i) => i !== agentIndex)
    .map((t, i) => `  ${i + 1}. ${t}`)
    .join("\n");

  return (
    `# Swarm Coordination\n\n` +
    `You are agent "${agentLabel}" in a multi-agent swarm of ${allSubtasks.length} agents.\n` +
    `Your task: ${agentTask}\n\n` +
    `Other agents are working on:\n${siblingTasks}\n\n` +
    `## Coordination Rules\n\n` +
    `- **Follow the Shared Context exactly.** The planning brief above contains ` +
    `concrete decisions (names, file paths, APIs, conventions). Use them as-is.\n` +
    `- **Surface design decisions.** If you need to make a creative or architectural ` +
    `choice not covered by the Shared Context (naming something, choosing a library, ` +
    `designing an interface, picking an approach), state your decision clearly in your ` +
    `output so the orchestrator can share it with sibling agents. Write it as:\n` +
    `  "DECISION: [brief description of what you decided and why]"\n` +
    `- **Don't contradict sibling work.** If the orchestrator tells you about decisions ` +
    `other agents have made, align with them.\n` +
    `- **Ask when uncertain.** If your task depends on another agent's output and you ` +
    `don't have enough context, ask rather than guessing.\n`
  );
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
    `Generate a concise shared context brief (3-10 bullet points) covering:\n` +
    `- Project intent and overall goal\n` +
    `- Key constraints or preferences from the user's request\n` +
    `- Conventions all agents should follow (naming, style, patterns, tone)\n` +
    `- How subtasks relate to each other (dependencies, shared interfaces, etc.)\n` +
    `- Any decisions that should be consistent across all agents\n\n` +
    `CRITICAL — Concrete Decisions:\n` +
    `If any subtask involves creative choices (naming a feature, choosing an approach, ` +
    `designing an API, picking a concept), YOU must make those decisions NOW in this brief. ` +
    `Do NOT leave creative choices to individual agents — they run in parallel and will ` +
    `each make different choices, causing inconsistency.\n` +
    `For example: if one agent builds a feature and another writes tests for it, ` +
    `decide the feature name, file paths, function signatures, and key design choices here ` +
    `so both agents use the same names and structure.\n\n` +
    `Only include what's relevant — skip categories that don't apply. ` +
    `Be specific and actionable, not generic. Be as detailed as the task requires — ` +
    `a trivial task needs a few bullets, a complex task deserves a thorough roadmap.\n\n` +
    `Output ONLY the bullet points, no preamble.`;

  try {
    const result = await withTrajectoryContext(
      runtime,
      { source: "orchestrator", decisionType: "swarm-context-generation" },
      () =>
        runtime.useModel(ModelType.TEXT_SMALL, {
          prompt,
          temperature: 0.3,
        }),
    );
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

  // Query past orchestrator experience for trajectory feedback injection.
  // This feeds lessons from previous agent sessions back into new agents,
  // preventing repeated mistakes and maintaining consistency with past decisions.
  const pastExperience = await queryPastExperience(runtime, {
    taskDescription: userRequest,
    lookbackHours: 48,
    maxEntries: 8,
    repo,
  });
  const pastExperienceBlock = formatPastExperience(pastExperience);

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

      // Append swarm coordination instructions to agent memory so the agent
      // knows to surface design decisions explicitly for the orchestrator.
      const swarmMemory = agentSpecs.length > 1
        ? buildSwarmMemoryInstructions(specLabel, specTask, cleanSubtasks, i)
        : undefined;
      const agentMemory = [memoryContent, swarmMemory, pastExperienceBlock]
        .filter(Boolean)
        .join("\n\n") || undefined;

      const session: SessionInfo = await ptyService.spawnSession({
        name: `coding-${Date.now()}-${i}`,
        agentType: specAgentType,
        workdir,
        initialTask,
        memoryContent: agentMemory,
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

    // Query past experience for trajectory feedback injection
    const pastExperience = await queryPastExperience(runtime, {
      taskDescription: task,
      lookbackHours: 48,
      maxEntries: 6,
      repo,
    });
    const pastExperienceBlock = formatPastExperience(pastExperience);
    const agentMemory = [memoryContent, pastExperienceBlock]
      .filter(Boolean)
      .join("\n\n") || undefined;

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
      memoryContent: agentMemory,
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
