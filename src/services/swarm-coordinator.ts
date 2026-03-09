/**
 * Swarm Coordinator — Event Bridge & Autonomous Coordination Loop
 *
 * Bridges PTY session events to:
 * 1. SSE clients (frontend dashboard) for real-time status
 * 2. LLM coordination decisions for unhandled blocking prompts
 *
 * The coordinator subscribes to PTYService session events and:
 * - Skips events already handled by auto-response rules (autoResponded=true)
 * - Routes unhandled blocking prompts through supervision levels:
 *   - autonomous: LLM decides immediately
 *   - confirm: queued for human approval
 *   - notify: broadcast only (no action)
 *
 * Heavy logic is extracted into:
 * - swarm-decision-loop.ts  (blocked, turn-complete, LLM decisions)
 * - swarm-idle-watchdog.ts  (idle session scanning)
 *
 * @module services/swarm-coordinator
 */

import type { ServerResponse } from "node:http";
import type { IAgentRuntime } from "@elizaos/core";
import { logger } from "@elizaos/core";
import { extractDevServerUrl } from "./ansi-utils.js";
import type { PTYService } from "./pty-service.js";
import type { CodingAgentType } from "./pty-types.js";
import type { CoordinationLLMResponse, SharedDecision } from "./swarm-coordinator-prompts.js";
import {
  checkAllTasksComplete,
  executeDecision as execDecision,
  handleBlocked,
  handleTurnComplete,
} from "./swarm-decision-loop.js";
import { scanIdleSessions } from "./swarm-idle-watchdog.js";

// ─── Types ───

/** Callback injected by server.ts to route chat messages to the user's conversation. */
export type ChatMessageCallback = (
  text: string,
  source?: string,
) => Promise<void>;

/** Callback injected by server.ts to relay coordinator events to WebSocket clients. */
export type WsBroadcastCallback = (event: SwarmEvent) => void;

/**
 * Callback injected by server.ts to route coordinator events through
 * Milaidy's full ElizaOS pipeline (conversation memory, personality, actions).
 * Returns a CoordinationLLMResponse parsed from Milaidy's natural language
 * response, or null if no actionable JSON block was found.
 */
export type AgentDecisionCallback = (
  eventDescription: string,
  sessionId: string,
  taskContext: TaskContext,
) => Promise<CoordinationLLMResponse | null>;

/** Per-task summary included in the swarm complete payload. */
export interface TaskCompletionSummary {
  sessionId: string;
  label: string;
  agentType: string;
  originalTask: string;
  status: string;
  completionSummary: string;
}

/** Callback fired when all tasks in a swarm reach terminal state. */
export type SwarmCompleteCallback = (payload: {
  tasks: TaskCompletionSummary[];
  total: number;
  completed: number;
  stopped: number;
  errored: number;
}) => Promise<void>;

export type SupervisionLevel = "autonomous" | "confirm" | "notify";

export interface TaskContext {
  sessionId: string;
  agentType: CodingAgentType;
  label: string;
  originalTask: string;
  workdir: string;
  /** Repository URL if provided, undefined for scratch directory tasks. */
  repo?: string;
  status: "active" | "completed" | "error" | "stopped";
  decisions: CoordinationDecision[];
  autoResolvedCount: number;
  registeredAt: number;
  /** Timestamp of the last session event (any type). Used by idle watchdog. */
  lastActivityAt: number;
  /** How many idle checks have been performed on this session. */
  idleCheckCount: number;
  /** True once the initial task has been delivered to the agent. */
  taskDelivered: boolean;
  /** Summary of what the agent accomplished, populated on completion. */
  completionSummary?: string;
  /** Index into sharedDecisions[] — tracks which decisions this agent has already seen. */
  lastSeenDecisionIndex: number;
}

export interface CoordinationDecision {
  timestamp: number;
  event: string;
  promptText: string;
  decision: "respond" | "escalate" | "ignore" | "complete" | "auto_resolved" | "stopped";
  response?: string;
  reasoning: string;
}

export interface SwarmEvent {
  type: string;
  sessionId: string;
  timestamp: number;
  data: unknown;
}

export interface PendingDecision {
  sessionId: string;
  promptText: string;
  recentOutput: string;
  llmDecision: CoordinationLLMResponse;
  taskContext: TaskContext;
  createdAt: number;
}

/**
 * Context interface exposing internal state and helpers to extracted modules.
 * Implemented by SwarmCoordinator — passed as `this` to module-level functions.
 */
export interface SwarmCoordinatorContext {
  readonly runtime: IAgentRuntime;
  readonly ptyService: PTYService | null;
  readonly tasks: Map<string, TaskContext>;
  readonly inFlightDecisions: Set<string>;
  readonly pendingDecisions: Map<string, PendingDecision>;
  /** Buffered task_complete events that arrived while an in-flight decision was running. */
  readonly pendingTurnComplete: Map<string, unknown>;
  /** Fingerprint of the last blocked prompt per session — for re-render dedup. */
  readonly lastBlockedPromptFingerprint: Map<string, string>;
  /** Buffered blocked events that arrived while an in-flight decision was running. */
  readonly pendingBlocked: Map<string, unknown>;
  /** Last-seen output snapshot per session — used by idle watchdog. */
  readonly lastSeenOutput: Map<string, string>;
  /** Timestamp of last tool_running chat notification per session — for throttling. */
  readonly lastToolNotification: Map<string, number>;

  /** Whether LLM decisions are paused (user sent a chat message). */
  readonly isPaused: boolean;

  /** Significant decisions shared across the swarm. */
  readonly sharedDecisions: SharedDecision[];

  /** Get the shared context brief from the planning phase. */
  getSwarmContext(): string;

  /**
   * Guard flag: whether the swarm_complete event has already been fired
   * for the current swarm lifecycle. Set to `true` by `checkAllTasksComplete()`
   * when all tasks reach terminal state. Reset to `false` by:
   * - `stop()` — full coordinator teardown
   * - `registerTask()` — when detecting a new swarm (all previous tasks terminal)
   */
  swarmCompleteNotified: boolean;

  broadcast(event: SwarmEvent): void;
  sendChatMessage(text: string, source?: string): void;
  log(message: string): void;
  getSupervisionLevel(): SupervisionLevel;
  getAgentDecisionCallback(): AgentDecisionCallback | null;
  getSwarmCompleteCallback(): SwarmCompleteCallback | null;
}

// ─── Constants ───

/** Time to buffer events for unregistered sessions (ms). */
const UNREGISTERED_BUFFER_MS = 2000;

/** How often the idle watchdog scans for idle sessions (ms). */
const IDLE_SCAN_INTERVAL_MS = 60 * 1000; // 1 minute

/** How long to wait before auto-resuming a paused coordinator (ms). */
const PAUSE_TIMEOUT_MS = 30_000;

// ─── Service ───

export class SwarmCoordinator implements SwarmCoordinatorContext {
  static serviceType = "SWARM_COORDINATOR";

  readonly runtime: IAgentRuntime;
  ptyService: PTYService | null = null;
  private unsubscribeEvents: (() => void) | null = null;

  /** Per-session task context. */
  readonly tasks: Map<string, TaskContext> = new Map();

  /** SSE clients receiving live events. */
  private sseClients: Set<ServerResponse> = new Set();

  /** Supervision level (default: autonomous). */
  private supervisionLevel: SupervisionLevel = "autonomous";

  /** Pending confirmations for "confirm" mode. */
  readonly pendingDecisions: Map<string, PendingDecision> = new Map();

  /** In-flight decision lock — prevents parallel LLM calls for same session. */
  readonly inFlightDecisions: Set<string> = new Set();

  /** Buffered task_complete events that arrived while an in-flight decision was running. */
  readonly pendingTurnComplete: Map<string, unknown> = new Map();

  /** Fingerprint of the last blocked prompt per session — for re-render dedup. */
  readonly lastBlockedPromptFingerprint: Map<string, string> = new Map();

  /** Buffered blocked events that arrived while an in-flight decision was running. */
  readonly pendingBlocked: Map<string, unknown> = new Map();

  /** Callback to send chat messages to the user's conversation UI. */
  private chatCallback: ChatMessageCallback | null = null;

  /** Callback to relay coordinator events to WebSocket clients. */
  private wsBroadcast: WsBroadcastCallback | null = null;

  /** Callback to route coordinator events through Milaidy's full pipeline. */
  private agentDecisionCb: AgentDecisionCallback | null = null;

  /** Callback fired when all swarm tasks complete — for synthesis. */
  private swarmCompleteCb: SwarmCompleteCallback | null = null;

  /** Buffer for events arriving before task registration. */
  private unregisteredBuffer: Map<
    string,
    Array<{ event: string; data: unknown; receivedAt: number }>
  > = new Map();

  /** Idle watchdog timer handle. */
  private idleWatchdogTimer: ReturnType<typeof setInterval> | null = null;

  /** Last-seen output snapshot per session — used by idle watchdog to detect data flow. */
  readonly lastSeenOutput: Map<string, string> = new Map();

  /** Timestamp of last tool_running chat notification per session — for throttling. */
  readonly lastToolNotification: Map<string, number> = new Map();

  /** Whether LLM decisions are paused (user sent a chat message). */
  private _paused = false;

  /** Significant decisions shared across the swarm (Layer 2). */
  readonly sharedDecisions: SharedDecision[] = [];

  /** Shared context brief generated during swarm planning phase. */
  private _swarmContext = "";

  /** @see SwarmCoordinatorContext.swarmCompleteNotified */
  swarmCompleteNotified = false;

  /** Buffered events during pause — replayed on resume. */
  private pauseBuffer: Array<{ sessionId: string; event: string; data: unknown }> = [];

  /** Auto-resume timeout handle. */
  private pauseTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(runtime: IAgentRuntime) {
    this.runtime = runtime;
  }

  // ─── Chat Callback ───

  /** Inject a callback (from server.ts) to route messages to the user's chat UI. */
  setChatCallback(cb: ChatMessageCallback): void {
    this.chatCallback = cb;
    this.log("Chat callback wired");
  }

  /** Inject a callback (from server.ts) to relay events to WebSocket clients. */
  setWsBroadcast(cb: WsBroadcastCallback): void {
    this.wsBroadcast = cb;
    this.log("WS broadcast callback wired");
  }

  /** Inject a callback fired when all swarm tasks reach terminal state. */
  setSwarmCompleteCallback(cb: SwarmCompleteCallback): void {
    this.swarmCompleteCb = cb;
    this.log("Swarm complete callback wired");
  }

  /** Return the swarm complete callback (if wired). */
  getSwarmCompleteCallback(): SwarmCompleteCallback | null {
    return this.swarmCompleteCb;
  }

  /** Set the shared context brief for this swarm. */
  setSwarmContext(context: string): void {
    this._swarmContext = context;
    this.log(`Swarm context set (${context.length} chars)`);
  }

  /** Return the swarm planning context (if set). */
  getSwarmContext(): string {
    return this._swarmContext;
  }

  /** Inject a callback (from server.ts) to route events through Milaidy's pipeline. */
  setAgentDecisionCallback(cb: AgentDecisionCallback): void {
    this.agentDecisionCb = cb;
    this.log("Agent decision callback wired — events will route through Milaidy");
  }

  /** Return the agent decision callback (if wired). */
  getAgentDecisionCallback(): AgentDecisionCallback | null {
    return this.agentDecisionCb;
  }

  /** Null-safe wrapper — sends a message to the user's conversation if callback is set. */
  sendChatMessage(text: string, source?: string): void {
    if (!this.chatCallback) return;
    this.chatCallback(text, source).catch((err) => {
      this.log(`Failed to send chat message: ${err}`);
    });
  }

  // ─── Lifecycle ───

  /**
   * Initialize the coordinator by subscribing to PTY session events.
   * Called from plugin init after services are ready.
   */
  start(ptyService: PTYService): void {
    this.ptyService = ptyService;
    this.unsubscribeEvents = ptyService.onSessionEvent(
      (sessionId, event, data) => {
        this.handleSessionEvent(sessionId, event, data).catch((err) => {
          this.log(`Error handling event: ${err}`);
        });
      },
    );

    // Start idle watchdog
    this.idleWatchdogTimer = setInterval(() => {
      scanIdleSessions(this).catch((err) => {
        this.log(`Idle watchdog error: ${err}`);
      });
    }, IDLE_SCAN_INTERVAL_MS);

    this.log("SwarmCoordinator started");
  }

  stop(): void {
    if (this.idleWatchdogTimer) {
      clearInterval(this.idleWatchdogTimer);
      this.idleWatchdogTimer = null;
    }
    if (this.unsubscribeEvents) {
      this.unsubscribeEvents();
      this.unsubscribeEvents = null;
    }
    // Close all SSE connections
    for (const client of this.sseClients) {
      if (!client.writableEnded) {
        client.end();
      }
    }
    this.sseClients.clear();
    this.tasks.clear();
    this.pendingDecisions.clear();
    this.inFlightDecisions.clear();
    this.pendingTurnComplete.clear();
    this.lastBlockedPromptFingerprint.clear();
    this.pendingBlocked.clear();
    this.unregisteredBuffer.clear();
    this.lastSeenOutput.clear();
    this.lastToolNotification.clear();
    this.agentDecisionCb = null;
    this.sharedDecisions.length = 0;
    this._swarmContext = "";
    this.swarmCompleteNotified = false;
    // Clear pause state
    this._paused = false;
    if (this.pauseTimeout) {
      clearTimeout(this.pauseTimeout);
      this.pauseTimeout = null;
    }
    this.pauseBuffer = [];
    this.log("SwarmCoordinator stopped");
  }

  // ─── Pause / Resume ───

  /** Whether the coordinator is currently paused. */
  get isPaused(): boolean {
    return this._paused;
  }

  /** Pause LLM-based decisions. Auto-responses and broadcasts continue. */
  pause(): void {
    if (this._paused) return;
    this._paused = true;
    this.log("Coordinator paused — buffering LLM decisions until user message is processed");
    this.broadcast({ type: "coordinator_paused", sessionId: "", timestamp: Date.now(), data: {} });

    // Safety: auto-resume after timeout
    this.pauseTimeout = setTimeout(() => {
      if (this._paused) {
        this.log("Coordinator auto-resuming after timeout");
        this.resume();
      }
    }, PAUSE_TIMEOUT_MS);
  }

  /** Resume LLM-based decisions and replay buffered events. */
  resume(): void {
    if (!this._paused) return;
    this._paused = false;
    if (this.pauseTimeout) {
      clearTimeout(this.pauseTimeout);
      this.pauseTimeout = null;
    }

    this.log(`Coordinator resumed — replaying ${this.pauseBuffer.length} buffered events`);
    this.broadcast({ type: "coordinator_resumed", sessionId: "", timestamp: Date.now(), data: {} });

    // Replay buffered events
    const buffered = [...this.pauseBuffer];
    this.pauseBuffer = [];
    for (const entry of buffered) {
      this.handleSessionEvent(entry.sessionId, entry.event, entry.data).catch((err) => {
        this.log(`Error replaying buffered event: ${err}`);
      });
    }
  }

  // ─── Task Registration ───

  registerTask(
    sessionId: string,
    context: {
      agentType: CodingAgentType;
      label: string;
      originalTask: string;
      workdir: string;
      repo?: string;
    },
  ): void {
    // Reset swarm state when the first task of a new swarm is registered.
    // Check for terminal-only tasks (all previous tasks in completed/stopped/error)
    // rather than empty map, so reuse without stop() works.
    const allPreviousTerminal = this.tasks.size === 0 || Array.from(this.tasks.values()).every(
      (t) => t.status === "completed" || t.status === "stopped" || t.status === "error",
    );
    if (allPreviousTerminal) {
      this.swarmCompleteNotified = false;
      // Clear stale tasks and shared context from previous swarm
      if (this.tasks.size > 0) {
        this.tasks.clear();
        this.sharedDecisions.length = 0;
        this._swarmContext = "";
        this.log("Cleared stale swarm state for new swarm");
      }
    }

    this.tasks.set(sessionId, {
      sessionId,
      agentType: context.agentType,
      label: context.label,
      originalTask: context.originalTask,
      workdir: context.workdir,
      repo: context.repo,
      status: "active",
      decisions: [],
      autoResolvedCount: 0,
      registeredAt: Date.now(),
      lastActivityAt: Date.now(),
      idleCheckCount: 0,
      taskDelivered: false,
      lastSeenDecisionIndex: 0,
    });

    this.broadcast({
      type: "task_registered",
      sessionId,
      timestamp: Date.now(),
      data: {
        agentType: context.agentType,
        label: context.label,
        originalTask: context.originalTask,
      },
    });

    // Flush any buffered events for this session
    const buffered = this.unregisteredBuffer.get(sessionId);
    if (buffered) {
      this.unregisteredBuffer.delete(sessionId);
      for (const entry of buffered) {
        this.handleSessionEvent(sessionId, entry.event, entry.data).catch(
          (err) => {
            this.log(`Error replaying buffered event: ${err}`);
          },
        );
      }
    }
  }

  /**
   * Return the repo URL from the most recently registered task that had one.
   * Useful as a fallback when the user says "in the same repo" without a URL.
   */
  getLastUsedRepo(): string | undefined {
    let latest: TaskContext | undefined;
    for (const task of this.tasks.values()) {
      if (
        task.repo &&
        (!latest || task.registeredAt > latest.registeredAt)
      ) {
        latest = task;
      }
    }
    return latest?.repo;
  }

  getTaskContext(sessionId: string): TaskContext | undefined {
    return this.tasks.get(sessionId);
  }

  getAllTaskContexts(): TaskContext[] {
    return Array.from(this.tasks.values());
  }

  // ─── SSE Client Management ───

  /**
   * Register an SSE client. Returns an unsubscribe function.
   * Sends a snapshot of current state on connect.
   */
  addSseClient(res: ServerResponse): () => void {
    this.sseClients.add(res);

    // Send snapshot on connect
    const snapshot: SwarmEvent = {
      type: "snapshot",
      sessionId: "*",
      timestamp: Date.now(),
      data: {
        tasks: this.getAllTaskContexts(),
        supervisionLevel: this.supervisionLevel,
        pendingCount: this.pendingDecisions.size,
      },
    };
    this.writeSseEvent(res, snapshot);

    // Remove on close
    const cleanup = () => {
      this.sseClients.delete(res);
    };
    res.on("close", cleanup);

    return cleanup;
  }

  broadcast(event: SwarmEvent): void {
    const dead: ServerResponse[] = [];
    for (const client of this.sseClients) {
      if (client.writableEnded) {
        dead.push(client);
        continue;
      }
      this.writeSseEvent(client, event);
    }
    // Cleanup dead connections
    for (const d of dead) {
      this.sseClients.delete(d);
    }
    // Relay to WebSocket clients
    this.wsBroadcast?.(event);
  }

  private writeSseEvent(res: ServerResponse, event: SwarmEvent): void {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {
      // Connection may have closed
    }
  }

  // ─── Event Handling ───

  async handleSessionEvent(
    sessionId: string,
    event: string,
    data: unknown,
  ): Promise<void> {
    const taskCtx = this.tasks.get(sessionId);

    // Buffer events for unregistered sessions (race condition guard)
    if (!taskCtx) {
      if (
        event === "blocked" ||
        event === "task_complete" ||
        event === "error"
      ) {
        let buffer = this.unregisteredBuffer.get(sessionId);
        if (!buffer) {
          buffer = [];
          this.unregisteredBuffer.set(sessionId, buffer);
        }
        buffer.push({ event, data, receivedAt: Date.now() });

        // Re-check after delay
        setTimeout(() => {
          const stillBuffered = this.unregisteredBuffer.get(sessionId);
          if (stillBuffered && stillBuffered.length > 0) {
            const ctx = this.tasks.get(sessionId);
            if (ctx) {
              // Task was registered — flush
              this.unregisteredBuffer.delete(sessionId);
              for (const entry of stillBuffered) {
                this.handleSessionEvent(
                  sessionId,
                  entry.event,
                  entry.data,
                ).catch(() => {});
              }
            } else {
              // Still no task context — discard
              this.unregisteredBuffer.delete(sessionId);
              this.log(
                `Discarding ${stillBuffered.length} buffered events for unregistered session ${sessionId}`,
              );
            }
          }
        }, UNREGISTERED_BUFFER_MS);
      }
      return;
    }

    // Skip decision-making events for terminal states, but always allow
    // "stopped" and "error" through — they're definitive lifecycle signals
    // that the frontend needs to close consoles and clean up.
    if (taskCtx.status === "stopped" || taskCtx.status === "error" || taskCtx.status === "completed") {
      if (event !== "stopped" && event !== "error") {
        this.log(`Ignoring "${event}" for ${taskCtx.label} (status: ${taskCtx.status})`);
        return;
      }
    }

    // Update activity timestamp — resets idle watchdog for this session.
    // This runs before buffering so buffered events still reset the idle timer.
    taskCtx.lastActivityAt = Date.now();
    taskCtx.idleCheckCount = 0;

    // Buffer decision-making events when paused (user sent a chat message).
    // Auto-responses still flow through handleBlocked — only LLM decisions are deferred.
    if (this._paused && (event === "blocked" || event === "task_complete")) {
      // Auto-responded blocked events don't need LLM — let them through
      const eventData = data as { autoResponded?: boolean };
      if (!(event === "blocked" && eventData.autoResponded)) {
        // Broadcast buffered state for dashboard visibility
        this.broadcast({
          type: event === "blocked" ? "blocked_buffered" : "turn_complete_buffered",
          sessionId,
          timestamp: Date.now(),
          data,
        });
        this.pauseBuffer.push({ sessionId, event, data });
        this.log(`Buffered "${event}" for ${taskCtx.label} (coordinator paused)`);
        return;
      }
      // Auto-responded: fall through to normal handling below
    }

    // Route by event type
    switch (event) {
      case "blocked":
        await handleBlocked(this, sessionId, taskCtx, data);
        break;

      case "task_complete": {
        // The adapter detected a turn completion (agent back at idle prompt).
        // Don't immediately stop — ask the LLM if the overall task is done
        // or if the agent needs more turns.
        this.broadcast({
          type: "turn_complete",
          sessionId,
          timestamp: Date.now(),
          data,
        });

        await handleTurnComplete(this, sessionId, taskCtx, data);
        break;
      }

      case "error": {
        taskCtx.status = "error";
        this.broadcast({
          type: "error",
          sessionId,
          timestamp: Date.now(),
          data,
        });

        // Send error message to chat UI
        const errorMsg =
          (data as { message?: string }).message ?? "unknown error";
        this.sendChatMessage(
          `"${taskCtx.label}" hit an error: ${errorMsg}`,
          "coding-agent",
        );
        checkAllTasksComplete(this);
        break;
      }

      case "stopped":
        // Don't downgrade "completed" or "error" to "stopped" — the async
        // stopSession fires after executeDecision already marked the task.
        if (taskCtx.status !== "completed" && taskCtx.status !== "error") {
          taskCtx.status = "stopped";
        }
        this.inFlightDecisions.delete(sessionId);
        this.broadcast({
          type: "stopped",
          sessionId,
          timestamp: Date.now(),
          data,
        });
        checkAllTasksComplete(this);
        break;

      case "ready":
        this.broadcast({
          type: "ready",
          sessionId,
          timestamp: Date.now(),
          data,
        });
        break;

      case "tool_running": {
        // Agent is actively working via an external tool — keep watchdog happy
        taskCtx.lastActivityAt = Date.now();
        taskCtx.idleCheckCount = 0;

        this.broadcast({
          type: "tool_running",
          sessionId,
          timestamp: Date.now(),
          data,
        });

        // Hook-sourced tool_running events fire for every tool call.
        // Only broadcast to SSE (for activity box) — skip chat messages.
        const toolData = data as {
          toolName?: string;
          description?: string;
          source?: string;
        };
        if (toolData.source === "hook") {
          break;
        }

        // Throttle chat notifications: at most one per 30s per session.
        // Suppress during the first 10s after registration — startup status
        // lines (e.g. "Claude in Chrome enabled") can trigger tool_running
        // before the agent has actually begun working.
        const now = Date.now();
        const STARTUP_GRACE_MS = 10_000;
        if (now - taskCtx.registeredAt < STARTUP_GRACE_MS) {
          break;
        }
        const lastNotif = this.lastToolNotification.get(sessionId) ?? 0;
        if (now - lastNotif > 30_000) {
          this.lastToolNotification.set(sessionId, now);
          const toolDesc =
            toolData.description ?? toolData.toolName ?? "an external tool";

          // Try to extract a dev server URL from recent output
          let urlSuffix = "";
          if (this.ptyService) {
            try {
              const recentOutput = await this.ptyService.getSessionOutput(
                sessionId,
                50,
              );
              const devUrl = extractDevServerUrl(recentOutput);
              if (devUrl) {
                urlSuffix = ` Dev server running at ${devUrl}`;
              }
            } catch {
              // Best-effort — don't block on failure
            }
          }

          this.log(
            `[${taskCtx.label}] Running ${toolDesc}.${urlSuffix} The agent is working outside the terminal.`,
          );
        }
        break;
      }

      default:
        // Broadcast unknown events for observability
        this.broadcast({
          type: event,
          sessionId,
          timestamp: Date.now(),
          data,
        });
    }
  }

  // ─── LLM Decision (delegated) ───

  async makeCoordinationDecision(
    taskCtx: TaskContext,
    promptText: string,
    recentOutput: string,
  ): Promise<CoordinationLLMResponse | null> {
    // Re-export for backward compatibility — delegates to module function
    const { makeCoordinationDecision: mkDecision } = await import(
      "./swarm-decision-loop.js"
    );
    return mkDecision(this, taskCtx, promptText, recentOutput);
  }

  async executeDecision(
    sessionId: string,
    decision: CoordinationLLMResponse,
  ): Promise<void> {
    return execDecision(this, sessionId, decision);
  }

  /**
   * Public entry point for external callers (e.g. server.ts) to execute
   * a coordination decision on a session. Wraps the internal executeDecision.
   */
  async executeEventDecision(
    sessionId: string,
    decision: CoordinationLLMResponse,
  ): Promise<void> {
    return execDecision(this, sessionId, decision);
  }

  // ─── Supervision ───

  setSupervisionLevel(level: SupervisionLevel): void {
    this.supervisionLevel = level;
    this.broadcast({
      type: "supervision_changed",
      sessionId: "*",
      timestamp: Date.now(),
      data: { level },
    });
    this.log(`Supervision level set to: ${level}`);
  }

  getSupervisionLevel(): SupervisionLevel {
    return this.supervisionLevel;
  }

  // ─── Confirmation Queue ───

  getPendingConfirmations(): PendingDecision[] {
    return Array.from(this.pendingDecisions.values());
  }

  async confirmDecision(
    sessionId: string,
    approved: boolean,
    override?: { response?: string; useKeys?: boolean; keys?: string[] },
  ): Promise<void> {
    const pending = this.pendingDecisions.get(sessionId);
    if (!pending) {
      throw new Error(`No pending decision for session ${sessionId}`);
    }

    this.pendingDecisions.delete(sessionId);
    const taskCtx = this.tasks.get(sessionId);

    if (approved) {
      // Use override if provided, otherwise use LLM suggestion
      const decision: CoordinationLLMResponse = override
        ? {
            action: "respond",
            response: override.response,
            useKeys: override.useKeys,
            keys: override.keys,
            reasoning: "Human-approved (with override)",
          }
        : pending.llmDecision;

      if (taskCtx) {
        taskCtx.decisions.push({
          timestamp: Date.now(),
          event: "blocked",
          promptText: pending.promptText,
          decision: decision.action,
          response:
            decision.action === "respond"
              ? decision.useKeys
                ? `keys:${decision.keys?.join(",")}`
                : decision.response
              : undefined,
          reasoning: `Human-approved: ${decision.reasoning}`,
        });
        taskCtx.autoResolvedCount = 0;
      }

      await this.executeDecision(sessionId, decision);

      this.broadcast({
        type: "confirmation_approved",
        sessionId,
        timestamp: Date.now(),
        data: {
          action: decision.action,
          response: decision.response,
          useKeys: decision.useKeys,
          keys: decision.keys,
        },
      });
    } else {
      // Rejected — record and broadcast
      if (taskCtx) {
        taskCtx.decisions.push({
          timestamp: Date.now(),
          event: "blocked",
          promptText: pending.promptText,
          decision: "escalate",
          reasoning: "Human rejected the suggested action",
        });
      }

      this.broadcast({
        type: "confirmation_rejected",
        sessionId,
        timestamp: Date.now(),
        data: { prompt: pending.promptText },
      });
    }
  }

  // ─── Internal ───

  log(message: string): void {
    logger.info(`[SwarmCoordinator] ${message}`);
  }
}
