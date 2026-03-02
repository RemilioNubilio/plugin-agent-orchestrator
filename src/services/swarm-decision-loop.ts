/**
 * Swarm Coordinator — Decision Loop & Blocked/Turn-Complete Handlers
 *
 * Extracted from swarm-coordinator.ts for modularity.
 * All functions are pure async helpers that receive a SwarmCoordinatorContext
 * to access shared state and services.
 *
 * @module services/swarm-decision-loop
 */

import * as path from "node:path";
import { ModelType } from "@elizaos/core";
import { cleanForChat, extractCompletionSummary } from "./ansi-utils.js";
import type {
  SwarmCoordinatorContext,
  TaskContext,
} from "./swarm-coordinator.js";
import {
  buildBlockedEventMessage,
  buildCoordinationPrompt,
  buildTurnCompleteEventMessage,
  buildTurnCompletePrompt,
  type CoordinationLLMResponse,
  type DecisionHistoryEntry,
  parseCoordinationResponse,
  type TaskContextSummary,
} from "./swarm-coordinator-prompts.js";
import {
  classifyEventTier,
  type TriageContext,
} from "./swarm-event-triage.js";

// ─── Constants ───

/** Maximum consecutive auto-responses before escalating to a human. */
const MAX_AUTO_RESPONSES = 10;

// ─── Helpers ───

/** Build a TaskContextSummary from a TaskContext. */
function toContextSummary(taskCtx: TaskContext): TaskContextSummary {
  return {
    sessionId: taskCtx.sessionId,
    agentType: taskCtx.agentType,
    label: taskCtx.label,
    originalTask: taskCtx.originalTask,
    workdir: taskCtx.workdir,
    repo: taskCtx.repo,
  };
}

/** Extract recent non-auto-resolved decisions as history entries. */
function toDecisionHistory(taskCtx: TaskContext): DecisionHistoryEntry[] {
  return taskCtx.decisions
    .filter((d) => d.decision !== "auto_resolved")
    .slice(-5)
    .map((d) => ({
      event: d.event,
      promptText: d.promptText,
      action: d.decision,
      response: d.response,
      reasoning: d.reasoning,
    }));
}

/** Format a decision's response for recording. */
function formatDecisionResponse(
  decision: CoordinationLLMResponse,
): string | undefined {
  if (decision.action !== "respond") return undefined;
  return decision.useKeys
    ? `keys:${decision.keys?.join(",")}`
    : decision.response;
}

/** Check if a permission prompt references paths outside the workspace. */
export function isOutOfScopeAccess(
  promptText: string,
  workdir: string,
): boolean {
  // Strip URLs so we don't false-positive on https://example.com/foo/bar
  const stripped = promptText.replace(/https?:\/\/\S+/g, "");

  // Match absolute paths: multi-segment (/dir/file) or well-known single-segment
  // roots that agents should never touch (/etc, /tmp, /var, /usr, /opt, /sys, /proc).
  const multiSegment = /\/[\w.-]+(?:\/[\w.-]+)+/g;
  const sensitiveRoots = /\b\/(etc|tmp|var|usr|opt|sys|proc|root)\b/g;
  const homeTilde = /~\/[\w.-]+/g;

  const matches = [
    ...(stripped.match(multiSegment) ?? []),
    ...(stripped.match(sensitiveRoots) ?? []).map((m) => m.trimStart()),
    ...(stripped.match(homeTilde) ?? []).map((m) =>
      m.replace("~", process.env.HOME ?? "/home/user"),
    ),
  ];
  if (matches.length === 0) return false;

  const resolvedWorkdir = path.resolve(workdir);
  return matches.some((p) => {
    const resolved = path.resolve(p);
    return (
      !resolved.startsWith(resolvedWorkdir + path.sep) &&
      resolved !== resolvedWorkdir
    );
  });
}

/**
 * Check if all registered tasks have reached a terminal state.
 * If so, send a swarm-wide summary message to the chat.
 */
export function checkAllTasksComplete(ctx: SwarmCoordinatorContext): void {
  const tasks = Array.from(ctx.tasks.values());
  if (tasks.length === 0) return;

  const terminalStates = new Set(["completed", "stopped", "error"]);
  const allDone = tasks.every((t) => terminalStates.has(t.status));
  if (!allDone) return;

  const completed = tasks.filter((t) => t.status === "completed");
  const stopped = tasks.filter((t) => t.status === "stopped");
  const errored = tasks.filter((t) => t.status === "error");

  const parts: string[] = [];
  if (completed.length > 0) {
    parts.push(`${completed.length} completed`);
  }
  if (stopped.length > 0) {
    parts.push(`${stopped.length} stopped`);
  }
  if (errored.length > 0) {
    parts.push(`${errored.length} errored`);
  }

  ctx.sendChatMessage(
    `All ${tasks.length} coding agents finished (${parts.join(", ")}). Review their work when you're ready.`,
    "coding-agent",
  );

  ctx.broadcast({
    type: "swarm_complete",
    sessionId: "",
    timestamp: Date.now(),
    data: {
      total: tasks.length,
      completed: completed.length,
      stopped: stopped.length,
      errored: errored.length,
    },
  });
}

/** Fetch recent PTY output, returning empty string on failure. */
async function fetchRecentOutput(
  ctx: SwarmCoordinatorContext,
  sessionId: string,
  lines = 50,
): Promise<string> {
  if (!ctx.ptyService) return "";
  try {
    return await ctx.ptyService.getSessionOutput(sessionId, lines);
  } catch {
    return "";
  }
}

// ─── LLM Decision ───

/**
 * Ask the LLM to make a coordination decision about a blocked agent.
 */
export async function makeCoordinationDecision(
  ctx: SwarmCoordinatorContext,
  taskCtx: TaskContext,
  promptText: string,
  recentOutput: string,
): Promise<CoordinationLLMResponse | null> {
  const prompt = buildCoordinationPrompt(
    toContextSummary(taskCtx),
    promptText,
    recentOutput,
    toDecisionHistory(taskCtx),
  );

  try {
    const result = await ctx.runtime.useModel(ModelType.TEXT_SMALL, {
      prompt,
    });
    return parseCoordinationResponse(result);
  } catch (err) {
    ctx.log(`LLM coordination call failed: ${err}`);
    return null;
  }
}

/**
 * Execute a coordination decision — send response, complete session, escalate, or ignore.
 */
export async function executeDecision(
  ctx: SwarmCoordinatorContext,
  sessionId: string,
  decision: CoordinationLLMResponse,
): Promise<void> {
  if (!ctx.ptyService) return;

  switch (decision.action) {
    case "respond":
      if (decision.useKeys && decision.keys) {
        await ctx.ptyService.sendKeysToSession(sessionId, decision.keys);
      } else if (decision.response !== undefined) {
        await ctx.ptyService.sendToSession(sessionId, decision.response);
      }
      break;

    case "complete": {
      // LLM recognized the task is done — trigger completion flow
      const taskCtx = ctx.tasks.get(sessionId);
      if (taskCtx) {
        taskCtx.status = "completed";
      }
      ctx.broadcast({
        type: "task_complete",
        sessionId,
        timestamp: Date.now(),
        data: { reasoning: decision.reasoning },
      });

      // Extract meaningful artifacts (PR URLs, commits) instead of
      // dumping raw terminal output which is full of TUI noise.
      let summary = "";
      try {
        const rawOutput = await ctx.ptyService.getSessionOutput(sessionId, 50);
        summary = extractCompletionSummary(rawOutput);
      } catch {
        /* ignore */
      }

      ctx.sendChatMessage(
        summary
          ? `Finished "${taskCtx?.label ?? sessionId}".\n\n${summary}`
          : `Finished "${taskCtx?.label ?? sessionId}".`,
        "coding-agent",
      );

      // Force-kill the session — task is done, nothing to save.
      // SIGKILL ensures the PTY and all child processes exit immediately,
      // preventing orphaned workspace processes.
      ctx.ptyService.stopSession(sessionId, /* force */ true).catch((err) => {
        ctx.log(`Failed to stop session after LLM-detected completion: ${err}`);
      });

      // Check if all tasks are now done — send a swarm-wide summary if so
      checkAllTasksComplete(ctx);
      break;
    }

    case "escalate":
      ctx.broadcast({
        type: "escalation",
        sessionId,
        timestamp: Date.now(),
        data: {
          reasoning: decision.reasoning,
        },
      });
      break;

    case "ignore":
      // No action needed
      break;
  }
}

// ─── Event Handlers ───

/**
 * Handle a "blocked" session event — auto-resolved, escalated, or routed to decision loop.
 */
export async function handleBlocked(
  ctx: SwarmCoordinatorContext,
  sessionId: string,
  taskCtx: TaskContext,
  data: unknown,
): Promise<void> {
  // Event data from pty-init: { promptInfo: BlockingPromptInfo, autoResponded: boolean }
  const eventData = data as {
    promptInfo?: {
      type?: string;
      prompt?: string;
      canAutoRespond?: boolean;
      instructions?: string;
    };
    autoResponded?: boolean;
  };

  // Extract prompt text from promptInfo (the actual blocking prompt info object)
  const promptText =
    eventData.promptInfo?.prompt ?? eventData.promptInfo?.instructions ?? "";

  // Auto-responded by rules — log and broadcast, no LLM needed
  if (eventData.autoResponded) {
    // Safety: check if the auto-approved prompt accessed out-of-scope paths.
    // The approval already happened in pty-manager, but we can stop the session
    // and alert the user to prevent further damage.
    if (isOutOfScopeAccess(promptText, taskCtx.workdir)) {
      taskCtx.decisions.push({
        timestamp: Date.now(),
        event: "blocked",
        promptText,
        decision: "escalate",
        reasoning: `SECURITY: Auto-response approved access outside workspace (${taskCtx.workdir}). Session stopped.`,
      });

      ctx.broadcast({
        type: "escalation",
        sessionId,
        timestamp: Date.now(),
        data: {
          prompt: promptText,
          reason: "out_of_scope_auto_approved",
          workdir: taskCtx.workdir,
        },
      });

      ctx.sendChatMessage(
        `[${taskCtx.label}] WARNING: Auto-approved access to path outside workspace (${taskCtx.workdir}). ` +
          `Prompt: "${promptText.slice(0, 150)}". Stopping session for safety.`,
        "coding-agent",
      );

      // Stop the session to prevent further out-of-scope access
      taskCtx.status = "error";
      ctx.ptyService?.stopSession(sessionId).catch((err) => {
        ctx.log(
          `Failed to stop session after out-of-scope auto-approval: ${err}`,
        );
      });
      return;
    }

    taskCtx.autoResolvedCount++;
    taskCtx.decisions.push({
      timestamp: Date.now(),
      event: "blocked",
      promptText,
      decision: "auto_resolved",
      reasoning: "Handled by auto-response rules",
    });

    ctx.broadcast({
      type: "blocked_auto_resolved",
      sessionId,
      timestamp: Date.now(),
      data: {
        prompt: promptText,
        promptType: eventData.promptInfo?.type,
        autoResolvedCount: taskCtx.autoResolvedCount,
      },
    });

    // Throttled chat message: 1st, 2nd, then every 5th
    const count = taskCtx.autoResolvedCount;
    if (count <= 2 || count % 5 === 0) {
      const excerpt =
        promptText.length > 120 ? `${promptText.slice(0, 120)}...` : promptText;
      ctx.sendChatMessage(
        `[${taskCtx.label}] Approved: ${excerpt}`,
        "coding-agent",
      );
    }
    return;
  }

  // Broadcast that the agent is blocked (for all supervision levels)
  ctx.broadcast({
    type: "blocked",
    sessionId,
    timestamp: Date.now(),
    data: {
      prompt: promptText,
      promptType: eventData.promptInfo?.type,
      supervisionLevel: ctx.getSupervisionLevel(),
    },
  });

  // Safety check: escalate after too many consecutive auto-responses
  if (taskCtx.autoResolvedCount >= MAX_AUTO_RESPONSES) {
    taskCtx.decisions.push({
      timestamp: Date.now(),
      event: "blocked",
      promptText,
      decision: "escalate",
      reasoning: `Escalating after ${MAX_AUTO_RESPONSES} consecutive auto-responses`,
    });
    ctx.broadcast({
      type: "escalation",
      sessionId,
      timestamp: Date.now(),
      data: {
        prompt: promptText,
        reason: "max_auto_responses_exceeded",
      },
    });
    return;
  }

  // Route based on supervision level
  switch (ctx.getSupervisionLevel()) {
    case "autonomous":
      await handleAutonomousDecision(ctx, sessionId, taskCtx, promptText, "", eventData.promptInfo?.type);
      break;

    case "confirm":
      await handleConfirmDecision(ctx, sessionId, taskCtx, promptText, "", eventData.promptInfo?.type);
      break;

    case "notify":
      // Notify mode — broadcast only, no action
      taskCtx.decisions.push({
        timestamp: Date.now(),
        event: "blocked",
        promptText,
        decision: "escalate",
        reasoning: "Supervision level is notify — broadcasting only",
      });
      break;
  }
}

// ─── Turn Completion Assessment ───

/**
 * Handle a turn completion event. Instead of immediately stopping the session,
 * ask the LLM whether the overall task is done or the agent needs more turns.
 */
export async function handleTurnComplete(
  ctx: SwarmCoordinatorContext,
  sessionId: string,
  taskCtx: TaskContext,
  data: unknown,
): Promise<void> {
  // Debounce — skip if already assessing this session
  if (ctx.inFlightDecisions.has(sessionId)) {
    ctx.log(`Skipping turn-complete assessment for ${sessionId} (in-flight)`);
    return;
  }

  ctx.inFlightDecisions.add(sessionId);
  try {
    ctx.log(
      `Turn complete for "${taskCtx.label}" — assessing whether task is done`,
    );

    // Get the turn output — prefer the captured response, fall back to PTY output
    const rawResponse = (data as { response?: string }).response ?? "";
    let turnOutput = cleanForChat(rawResponse);
    if (!turnOutput) {
      const raw = await fetchRecentOutput(ctx, sessionId);
      turnOutput = cleanForChat(raw);
    }

    // Triage: route to small LLM (routine) or Milaidy pipeline (creative)
    const agentDecisionCb = ctx.getAgentDecisionCallback();
    let decision: CoordinationLLMResponse | null = null;
    let decisionFromPipeline = false;

    const triageCtx: TriageContext = {
      eventType: "turn_complete",
      promptText: "",
      recentOutput: turnOutput,
      originalTask: taskCtx.originalTask,
    };
    const tier = agentDecisionCb
      ? await classifyEventTier(ctx.runtime, triageCtx, ctx.log)
      : "routine"; // No pipeline → always small LLM

    if (tier === "routine") {
      const prompt = buildTurnCompletePrompt(
        toContextSummary(taskCtx),
        turnOutput,
        toDecisionHistory(taskCtx),
      );
      try {
        const result = await ctx.runtime.useModel(ModelType.TEXT_SMALL, {
          prompt,
        });
        decision = parseCoordinationResponse(result);
      } catch (err) {
        ctx.log(`Turn-complete LLM call failed: ${err}`);
      }
    } else {
      // Creative — try Milaidy pipeline, fall back to small LLM
      if (agentDecisionCb) {
        const eventMessage = buildTurnCompleteEventMessage(
          toContextSummary(taskCtx),
          turnOutput,
          toDecisionHistory(taskCtx),
        );
        try {
          decision = await agentDecisionCb(eventMessage, sessionId, taskCtx);
          if (decision) decisionFromPipeline = true;
        } catch (err) {
          ctx.log(`Agent decision callback failed for turn-complete: ${err} — falling back to small LLM`);
        }
      }

      if (!decision) {
        const prompt = buildTurnCompletePrompt(
          toContextSummary(taskCtx),
          turnOutput,
          toDecisionHistory(taskCtx),
        );
        try {
          const result = await ctx.runtime.useModel(ModelType.TEXT_SMALL, {
            prompt,
          });
          decision = parseCoordinationResponse(result);
        } catch (err) {
          ctx.log(`Turn-complete LLM fallback call failed: ${err}`);
        }
      }
    }

    if (!decision) {
      // Both paths failed — escalate so a human can decide rather than
      // prematurely completing unfinished work on a transient LLM failure.
      ctx.log(
        `Turn-complete for "${taskCtx.label}": all decision paths failed — escalating`,
      );
      decision = {
        action: "escalate",
        reasoning: "All decision paths returned invalid response — escalating for human review",
      };
    }

    // Log the decision
    ctx.log(
      `Turn assessment for "${taskCtx.label}": ${decision.action}${
        decision.action === "respond"
          ? ` → "${(decision.response ?? "").slice(0, 80)}"`
          : ""
      } — ${decision.reasoning.slice(0, 120)}`,
    );

    // Record
    taskCtx.decisions.push({
      timestamp: Date.now(),
      event: "turn_complete",
      promptText: "Agent finished a turn",
      decision: decision.action,
      response: formatDecisionResponse(decision),
      reasoning: decision.reasoning,
    });

    ctx.broadcast({
      type: "turn_assessment",
      sessionId,
      timestamp: Date.now(),
      data: {
        action: decision.action,
        reasoning: decision.reasoning,
      },
    });

    // Send chat message for small-LLM decisions only.
    // When Milaidy's pipeline handled it, she already spoke via WS broadcast.
    if (!decisionFromPipeline) {
      if (decision.action === "respond") {
        const instruction = decision.response ?? "";
        const preview =
          instruction.length > 120
            ? `${instruction.slice(0, 120)}...`
            : instruction;
        ctx.sendChatMessage(
          `[${taskCtx.label}] Turn done, continuing: ${preview}`,
          "coding-agent",
        );
      } else if (decision.action === "escalate") {
        ctx.sendChatMessage(
          `[${taskCtx.label}] Turn finished — needs your attention: ${decision.reasoning}`,
          "coding-agent",
        );
      }
    }
    // "complete" chat message is handled by executeDecision

    await executeDecision(ctx, sessionId, decision);
  } finally {
    ctx.inFlightDecisions.delete(sessionId);
  }
}

// ─── Autonomous / Confirm Decision Flows ───

/**
 * Handle an autonomous decision for a blocked session — call the LLM and execute immediately.
 */
export async function handleAutonomousDecision(
  ctx: SwarmCoordinatorContext,
  sessionId: string,
  taskCtx: TaskContext,
  promptText: string,
  recentOutput: string,
  promptType?: string,
): Promise<void> {
  // Debounce: skip if decision already in-flight for this session
  if (ctx.inFlightDecisions.has(sessionId)) {
    ctx.log(`Skipping duplicate decision for ${sessionId} (in-flight)`);
    return;
  }

  ctx.inFlightDecisions.add(sessionId);
  try {
    // Get recent output from PTY if not provided
    let output = recentOutput;
    if (!output) {
      output = await fetchRecentOutput(ctx, sessionId);
    }

    // Triage: route to small LLM (routine) or Milaidy pipeline (creative).
    // Track source so we skip duplicate chat messages when Milaidy already spoke.
    const agentDecisionCb = ctx.getAgentDecisionCallback();
    let decision: CoordinationLLMResponse | null = null;
    let decisionFromPipeline = false;

    const triageCtx: TriageContext = {
      eventType: "blocked",
      promptText,
      promptType,
      recentOutput: output,
      originalTask: taskCtx.originalTask,
    };
    const tier = agentDecisionCb
      ? await classifyEventTier(ctx.runtime, triageCtx, ctx.log)
      : "routine"; // No pipeline → always small LLM

    if (tier === "routine") {
      decision = await makeCoordinationDecision(
        ctx,
        taskCtx,
        promptText,
        output,
      );
    } else {
      // Creative — try Milaidy pipeline, fall back to small LLM
      if (agentDecisionCb) {
        const eventMessage = buildBlockedEventMessage(
          toContextSummary(taskCtx),
          promptText,
          output,
          toDecisionHistory(taskCtx),
        );
        try {
          decision = await agentDecisionCb(eventMessage, sessionId, taskCtx);
          if (decision) decisionFromPipeline = true;
        } catch (err) {
          ctx.log(`Agent decision callback failed: ${err} — falling back to small LLM`);
        }
      }

      if (!decision) {
        decision = await makeCoordinationDecision(
          ctx,
          taskCtx,
          promptText,
          output,
        );
      }
    }

    if (!decision) {
      // All decision paths returned invalid response — escalate
      taskCtx.decisions.push({
        timestamp: Date.now(),
        event: "blocked",
        promptText,
        decision: "escalate",
        reasoning: "All decision paths returned invalid coordination response",
      });
      ctx.broadcast({
        type: "escalation",
        sessionId,
        timestamp: Date.now(),
        data: {
          prompt: promptText,
          reason: "invalid_llm_response",
        },
      });
      return;
    }

    // Guard: decline + redirect if the prompt references out-of-scope paths.
    // Instead of stalling via escalate, tell the agent "no" and point it to the
    // workspace. Also notify the human in case broader access was intended.
    if (
      decision.action === "respond" &&
      isOutOfScopeAccess(promptText, taskCtx.workdir)
    ) {
      decision = {
        action: "respond",
        response: `No — that path is outside your workspace. Use ${taskCtx.workdir} instead. Create any files or directories you need there.`,
        reasoning: `Declined out-of-scope access (outside ${taskCtx.workdir}) and redirected agent to workspace.`,
      };
      // Surface to human so they can grant broader access if intended
      ctx.sendChatMessage(
        `[${taskCtx.label}] Declined out-of-scope access and redirected to workspace (${taskCtx.workdir}). If you intended broader access, send the agent an override.`,
        "coding-agent",
      );
    }

    // Record the decision
    taskCtx.decisions.push({
      timestamp: Date.now(),
      event: "blocked",
      promptText,
      decision: decision.action,
      response: formatDecisionResponse(decision),
      reasoning: decision.reasoning,
    });

    // Reset auto-resolved count on manual decision
    taskCtx.autoResolvedCount = 0;

    // Broadcast the decision
    ctx.broadcast({
      type: "coordination_decision",
      sessionId,
      timestamp: Date.now(),
      data: {
        action: decision.action,
        response: decision.response,
        useKeys: decision.useKeys,
        keys: decision.keys,
        reasoning: decision.reasoning,
      },
    });

    // Send chat message for small-LLM decisions only.
    // When Milaidy's pipeline handled it, she already spoke via WS broadcast.
    if (!decisionFromPipeline) {
      if (decision.action === "respond") {
        const actionDesc = decision.useKeys
          ? `Sent keys: ${decision.keys?.join(", ")}`
          : decision.response
            ? `Responded: ${decision.response.length > 100 ? `${decision.response.slice(0, 100)}...` : decision.response}`
            : "Responded";
        const reasonExcerpt =
          decision.reasoning.length > 150
            ? `${decision.reasoning.slice(0, 150)}...`
            : decision.reasoning;
        ctx.sendChatMessage(
          `[${taskCtx.label}] ${actionDesc} — ${reasonExcerpt}`,
          "coding-agent",
        );
      } else if (decision.action === "escalate") {
        ctx.sendChatMessage(
          `[${taskCtx.label}] Needs your attention: ${decision.reasoning}`,
          "coding-agent",
        );
      }
    }

    // Execute
    await executeDecision(ctx, sessionId, decision);
  } finally {
    ctx.inFlightDecisions.delete(sessionId);
  }
}

/**
 * Handle a confirm-mode decision — call LLM, then queue for human approval.
 */
export async function handleConfirmDecision(
  ctx: SwarmCoordinatorContext,
  sessionId: string,
  taskCtx: TaskContext,
  promptText: string,
  recentOutput: string,
  promptType?: string,
): Promise<void> {
  // Debounce
  if (ctx.inFlightDecisions.has(sessionId)) return;

  ctx.inFlightDecisions.add(sessionId);
  try {
    let output = recentOutput;
    if (!output) {
      output = await fetchRecentOutput(ctx, sessionId);
    }

    // Triage: route to small LLM (routine) or Milaidy pipeline (creative)
    const agentDecisionCb = ctx.getAgentDecisionCallback();
    let decision: CoordinationLLMResponse | null = null;
    let decisionFromPipeline = false;

    const triageCtx: TriageContext = {
      eventType: "blocked",
      promptText,
      promptType,
      recentOutput: output,
      originalTask: taskCtx.originalTask,
    };
    const tier = agentDecisionCb
      ? await classifyEventTier(ctx.runtime, triageCtx, ctx.log)
      : "routine"; // No pipeline → always small LLM

    if (tier === "routine") {
      decision = await makeCoordinationDecision(
        ctx,
        taskCtx,
        promptText,
        output,
      );
    } else {
      // Creative — try Milaidy pipeline, fall back to small LLM
      if (agentDecisionCb) {
        const eventMessage = buildBlockedEventMessage(
          toContextSummary(taskCtx),
          promptText,
          output,
          toDecisionHistory(taskCtx),
        );
        try {
          decision = await agentDecisionCb(eventMessage, sessionId, taskCtx);
          if (decision) decisionFromPipeline = true;
        } catch (err) {
          ctx.log(`Agent decision callback failed (confirm): ${err} — falling back to small LLM`);
        }
      }

      if (!decision) {
        decision = await makeCoordinationDecision(
          ctx,
          taskCtx,
          promptText,
          output,
        );
      }
    }

    if (!decision) {
      // Queue for human with no suggestion
      ctx.pendingDecisions.set(sessionId, {
        sessionId,
        promptText,
        recentOutput: output,
        llmDecision: {
          action: "escalate",
          reasoning: "All decision paths returned invalid response — needs human review",
        },
        taskContext: taskCtx,
        createdAt: Date.now(),
      });
    } else {
      // Queue the LLM's suggestion for human approval
      ctx.pendingDecisions.set(sessionId, {
        sessionId,
        promptText,
        recentOutput: output,
        llmDecision: decision,
        taskContext: taskCtx,
        createdAt: Date.now(),
      });
    }

    // When Milaidy's pipeline made the suggestion, she already spoke via WS broadcast.
    // Only broadcast the pending_confirmation event for small-LLM suggestions or
    // always broadcast it (the UI needs it regardless) but skip any chat messages.
    ctx.broadcast({
      type: "pending_confirmation",
      sessionId,
      timestamp: Date.now(),
      data: {
        prompt: promptText,
        suggestedAction: decision?.action,
        suggestedResponse: decision?.response,
        reasoning: decision?.reasoning,
        fromPipeline: decisionFromPipeline,
      },
    });
  } finally {
    ctx.inFlightDecisions.delete(sessionId);
  }
}
