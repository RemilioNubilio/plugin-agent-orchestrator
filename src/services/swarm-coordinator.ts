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
import { SwarmHistory } from "./swarm-history.js";
import {
  type CreateTaskThreadInput,
  type TaskThreadDetail,
  type TaskThreadStatus,
  type TaskThreadSummary,
  TaskRegistry,
} from "./task-registry.js";
import type { PTYService } from "./pty-service.js";
import type { CodingAgentType } from "./pty-types.js";
import type {
	CoordinationLLMResponse,
	SharedDecision,
} from "./swarm-coordinator-prompts.js";
import {
	checkAllTasksComplete,
	clearDeferredTurnCompleteTimers,
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
	threadId: string;
	sessionId: string;
	agentType: CodingAgentType;
	label: string;
	originalTask: string;
	workdir: string;
	/** Repository URL if provided, undefined for scratch directory tasks. */
	repo?: string;
	status:
		| "active"
		| "blocked"
		| "tool_running"
		| "completed"
		| "error"
		| "stopped";
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
	/** Timestamp of last coordinator-sent input. Used to suppress stall/turn-complete
	 *  events for a grace period so the agent has time to process the input. */
	lastInputSentAt?: number;
	/** Timestamp when the task was last transitioned to `stopped`. */
	stoppedAt?: number;
}

export interface CoordinationDecision {
	timestamp: number;
	event: string;
	promptText: string;
	decision:
		| "respond"
		| "escalate"
		| "ignore"
		| "complete"
		| "auto_resolved"
		| "stopped";
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
	readonly taskRegistry: TaskRegistry;
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
	recordDecision(
		taskCtx: TaskContext,
		decision: CoordinationDecision,
	): Promise<void>;
	syncTaskContext(taskCtx: TaskContext): Promise<void>;
}

// ─── Constants ───

/** Time to buffer events for unregistered sessions (ms). */
/** Exponential backoff delays for unregistered session buffer retries. */
const UNREGISTERED_RETRY_DELAYS = [2000, 4000, 8000, 16000];
/** Absolute maximum wait time before discarding unregistered events. */
const UNREGISTERED_MAX_TOTAL_MS = 30_000;

/** Coalesce rapid turn-complete events within this window (ms). */
const TURN_COMPLETE_COALESCE_MS = 500;

/** How often the idle watchdog scans for idle sessions (ms). */
const IDLE_SCAN_INTERVAL_MS = 60 * 1000; // 1 minute

/** How long to wait before auto-resuming a paused coordinator (ms). */
const PAUSE_TIMEOUT_MS = 30_000;
/** Max events to buffer before WS bridge is wired. */
const MAX_PRE_BRIDGE_BUFFER = 100;
/** Grace window where a late task_complete can recover a recently-stopped task. */
const STOPPED_RECOVERY_WINDOW_MS = 90_000;

// ─── Service ───

export class SwarmCoordinator implements SwarmCoordinatorContext {
	static serviceType = "SWARM_COORDINATOR";

	readonly runtime: IAgentRuntime;
	readonly taskRegistry: TaskRegistry;
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
	private pauseBuffer: Array<{
		sessionId: string;
		event: string;
		data: unknown;
	}> = [];

	/** Buffered broadcasts waiting for wsBroadcast to be wired. */
	private preBridgeBroadcastBuffer: SwarmEvent[] = [];

	/** Auto-resume timeout handle. */
	private pauseTimeout: ReturnType<typeof setTimeout> | null = null;

	/** Coordinator startup timestamp — ignore events from sessions created before this. */
	private readonly startedAt = Date.now();

	/** Active retry timers for unregistered session buffers. */
	private unregisteredRetryTimers: Map<
		string,
		ReturnType<typeof setTimeout>
	> = new Map();

	/** Turn-complete coalescing timers — debounces rapid events per session. */
	private turnCompleteCoalesceTimers: Map<
		string,
		ReturnType<typeof setTimeout>
	> = new Map();

	/** Persistent swarm history — JSONL log that survives restarts. */
	readonly history = new SwarmHistory();

	constructor(runtime: IAgentRuntime) {
		this.runtime = runtime;
		this.taskRegistry = new TaskRegistry(runtime);
	}

	// ─── Chat Callback ───

	/** Inject a callback (from server.ts) to route messages to the user's chat UI. */
	/** Track whether we've already wired the scratch decision callback. */
	private scratchDecisionWired = false;

	setChatCallback(cb: ChatMessageCallback): void {
		this.chatCallback = cb;
		this.log("Chat callback wired");
		// Try wiring scratch decision callback now, retry lazily if service not ready
		this.wireScratchDecisionCallback();
	}

	/**
	 * Wire the scratch workspace save prompt callback.
	 * Called eagerly from setChatCallback and lazily from handleSessionEvent
	 * in case the workspace service wasn't ready at chat-callback time.
	 */
	private wireScratchDecisionCallback(): void {
		if (this.scratchDecisionWired || !this.chatCallback) return;
		const wsService = this.runtime.getService("CODING_WORKSPACE_SERVICE") as
			unknown as { setScratchDecisionCallback?: (cb: (record: { label: string; path: string; expiresAt?: number }) => Promise<void>) => void } | undefined;
		if (wsService?.setScratchDecisionCallback) {
			const chatCb = this.chatCallback;
			wsService.setScratchDecisionCallback(async (record) => {
				const ttlNote = record.expiresAt
					? (() => {
						const remainMs = record.expiresAt - Date.now();
						const hours = Math.round(remainMs / (60 * 60 * 1000));
						return hours >= 1
							? `It will be automatically cleaned up in ~${hours} hour${hours === 1 ? "" : "s"}.`
							: `It will be automatically cleaned up shortly.`;
					})()
					: "It will be automatically cleaned up after the configured retention period.";
				await chatCb(
					`Task "${record.label}" finished. Code is at \`${record.path}\`.\n` +
					`${ttlNote} To keep it, say "keep the workspace" or manage it in Settings -> Task Agents.`,
					"task-agent",
				);
			});
			this.scratchDecisionWired = true;
			this.log("Scratch decision callback wired");
		}
	}

	/** Inject a callback (from server.ts) to relay events to WebSocket clients. */
	setWsBroadcast(cb: WsBroadcastCallback): void {
		this.wsBroadcast = cb;
		// Replay any events that were broadcast before the bridge was wired
		if (this.preBridgeBroadcastBuffer.length > 0) {
			this.log(
				`WS broadcast callback wired — replaying ${this.preBridgeBroadcastBuffer.length} buffered event(s)`,
			);
			for (const event of this.preBridgeBroadcastBuffer) {
				cb(event);
			}
			this.preBridgeBroadcastBuffer.length = 0;
		} else {
			this.log("WS broadcast callback wired");
		}
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
		this.log(
			"Agent decision callback wired — events will route through Milaidy",
		);
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
	async start(ptyService: PTYService): Promise<void> {
		await this.taskRegistry.ensureSchema();
		await this.taskRegistry.recoverInterruptedTasks();
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

	async stop(): Promise<void> {
		const persistOnShutdown = Array.from(this.tasks.values())
			.filter(
				(task) =>
					task.status === "active" ||
					task.status === "blocked" ||
					task.status === "tool_running",
			)
			.map(async (task) => {
				task.status = "stopped";
				task.stoppedAt = Date.now();
				await this.taskRegistry.updateSession(task.sessionId, {
					status: "interrupted",
					lastActivityAt: task.lastActivityAt,
					idleCheckCount: task.idleCheckCount,
					taskDelivered: task.taskDelivered,
					autoResolvedCount: task.autoResolvedCount,
					decisionCount: task.decisions.length,
					completionSummary: task.completionSummary ?? null,
					lastSeenDecisionIndex: task.lastSeenDecisionIndex,
					lastInputSentAt: task.lastInputSentAt,
					stoppedAt: task.stoppedAt,
				});
				await this.taskRegistry.appendEvent({
					threadId: task.threadId,
					sessionId: task.sessionId,
					eventType: "session_interrupted",
					summary: "Session interrupted during coordinator shutdown",
					data: { reason: "coordinator_shutdown" },
				});
			});
		await Promise.allSettled(persistOnShutdown);
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
		clearDeferredTurnCompleteTimers();
		this.lastBlockedPromptFingerprint.clear();
		this.pendingBlocked.clear();
		this.unregisteredBuffer.clear();
		for (const timer of this.unregisteredRetryTimers.values()) {
			clearTimeout(timer);
		}
		this.unregisteredRetryTimers.clear();
		for (const timer of this.turnCompleteCoalesceTimers.values()) {
			clearTimeout(timer);
		}
		this.turnCompleteCoalesceTimers.clear();
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
		this.preBridgeBroadcastBuffer.length = 0;
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
		this.log(
			"Coordinator paused — buffering LLM decisions until user message is processed",
		);
		this.broadcast({
			type: "coordinator_paused",
			sessionId: "",
			timestamp: Date.now(),
			data: {},
		});

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

		this.log(
			`Coordinator resumed — replaying ${this.pauseBuffer.length} buffered events`,
		);
		this.broadcast({
			type: "coordinator_resumed",
			sessionId: "",
			timestamp: Date.now(),
			data: {},
		});

		// Replay buffered events
		const buffered = [...this.pauseBuffer];
		this.pauseBuffer = [];
		for (const entry of buffered) {
			this.handleSessionEvent(entry.sessionId, entry.event, entry.data).catch(
				(err) => {
					this.log(`Error replaying buffered event: ${err}`);
				},
			);
		}
	}

	// ─── Task Registration ───

	async registerTask(
		sessionId: string,
		context: {
			threadId: string;
			agentType: CodingAgentType;
			label: string;
			originalTask: string;
			workdir: string;
			repo?: string;
		},
	): Promise<void> {
		const threadId = context.threadId?.trim() || sessionId;
		// Reset swarm state when the first task of a new swarm is registered.
		// Check for terminal-only tasks (all previous tasks in completed/stopped/error)
		// rather than empty map, so reuse without stop() works.
		const allPreviousTerminal =
			this.tasks.size === 0 ||
			Array.from(this.tasks.values()).every(
				(t) =>
					t.status === "completed" ||
					t.status === "stopped" ||
					t.status === "error",
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
			threadId,
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

		// Persist last used repo so it survives task cleanup
		if (context.repo) {
			this._lastUsedRepo = context.repo;
		}

		// Log to persistent history (fire-and-forget)
		this.history.append({
			timestamp: Date.now(),
			type: "task_registered",
			sessionId,
			label: context.label,
			agentType: context.agentType,
			repo: context.repo,
			workdir: context.workdir,
			originalTask: context.originalTask,
		}).catch(() => {});

		const taskCtx = this.tasks.get(sessionId);
		const persistPromise = taskCtx
			? (async () => {
					const existingThread = await this.taskRegistry.getThreadRecord(threadId);
					if (!existingThread) {
						await this.taskRegistry.createThread({
							id: threadId,
							title: context.label,
							originalRequest: context.originalTask,
							kind: "coding",
							metadata: {
								repo: context.repo ?? null,
								source: "register-task-fallback",
							},
						});
					}
					await Promise.all([
						this.taskRegistry.registerSession({
						threadId: taskCtx.threadId,
						sessionId,
						framework: context.agentType,
						label: context.label,
						originalTask: context.originalTask,
						workdir: context.workdir,
						repo: context.repo,
						status: "active",
						decisionCount: 0,
						autoResolvedCount: 0,
						registeredAt: taskCtx.registeredAt,
						lastActivityAt: taskCtx.lastActivityAt,
						idleCheckCount: taskCtx.idleCheckCount,
						taskDelivered: false,
						lastSeenDecisionIndex: 0,
						metadata: {},
					}),
						this.taskRegistry.appendEvent({
						threadId,
						sessionId,
						eventType: "task_registered",
						timestamp: Date.now(),
						summary: `Registered task "${context.label}"`,
						data: {
							label: context.label,
							originalTask: context.originalTask,
							repo: context.repo ?? null,
						},
					}),
					]);
			  })()
			: Promise.resolve();
		void persistPromise.catch((err) => {
			this.log(`Failed to persist task registration for ${sessionId}: ${err}`);
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

		// Cancel any pending retry timer and flush buffered events
		const retryTimer = this.unregisteredRetryTimers.get(sessionId);
		if (retryTimer) {
			clearTimeout(retryTimer);
			this.unregisteredRetryTimers.delete(sessionId);
		}
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
		await persistPromise;
	}

	/**
	 * Return the repo URL from the most recently registered task that had one.
	 * Useful as a fallback when the user says "in the same repo" without a URL.
	 */
	/**
	 * Persisted separately from tasks so it survives task cleanup.
	 * Updated whenever a task with a repo is registered.
	 */
	private _lastUsedRepo: string | undefined;

	getLastUsedRepo(): string | undefined {
		// Check active tasks first (freshest), fall back to in-memory persisted value
		let latest: TaskContext | undefined;
		for (const task of this.tasks.values()) {
			if (task.repo && (!latest || task.registeredAt > latest.registeredAt)) {
				latest = task;
			}
		}
		return latest?.repo ?? this._lastUsedRepo;
	}

	/**
	 * Async version that also checks disk history — survives process restarts.
	 * Callers that can await should prefer this over the sync version.
	 */
	async getLastUsedRepoAsync(): Promise<string | undefined> {
		const memoryRepo = this.getLastUsedRepo();
		if (memoryRepo) return memoryRepo;
		try {
			return (await this.taskRegistry.getLastUsedRepo()) ?? (await this.history.getLastUsedRepo());
		} catch {
			return undefined;
		}
	}

	getTaskContext(sessionId: string): TaskContext | undefined {
		return this.tasks.get(sessionId);
	}

	getAllTaskContexts(): TaskContext[] {
		return Array.from(this.tasks.values());
	}

	async createTaskThread(
		input: CreateTaskThreadInput,
	): Promise<TaskThreadSummary> {
		const thread = await this.taskRegistry.createThread(input);
		const summary = await this.taskRegistry.getThreadSummary(thread.id);
		if (!summary) {
			throw new Error(`Failed to load task thread ${thread.id}`);
		}
		return summary;
	}

	async listTaskThreads(options?: {
		includeArchived?: boolean;
		status?: TaskThreadStatus;
		search?: string;
		limit?: number;
	}): Promise<TaskThreadSummary[]> {
		return this.taskRegistry.listThreads(options);
	}

	async getTaskThread(threadId: string): Promise<TaskThreadDetail | null> {
		return this.taskRegistry.getThread(threadId);
	}

	async archiveTaskThread(threadId: string): Promise<void> {
		await this.taskRegistry.archiveThread(threadId);
	}

	async reopenTaskThread(threadId: string): Promise<void> {
		await this.taskRegistry.reopenThread(threadId);
	}

	async syncTaskContext(taskCtx: TaskContext): Promise<void> {
		await this.taskRegistry.updateSession(taskCtx.sessionId, {
			status:
				taskCtx.status === "completed"
					? "completed"
					: taskCtx.status === "error"
						? "error"
						: taskCtx.status === "stopped"
							? "stopped"
							: taskCtx.status === "blocked"
								? "blocked"
								: taskCtx.status === "tool_running"
									? "tool_running"
							: "active",
			decisionCount: taskCtx.decisions.length,
			autoResolvedCount: taskCtx.autoResolvedCount,
			lastActivityAt: taskCtx.lastActivityAt,
			idleCheckCount: taskCtx.idleCheckCount,
			taskDelivered: taskCtx.taskDelivered,
			completionSummary: taskCtx.completionSummary ?? null,
			lastSeenDecisionIndex: taskCtx.lastSeenDecisionIndex,
			lastInputSentAt: taskCtx.lastInputSentAt,
			stoppedAt: taskCtx.stoppedAt,
		});
	}

	async recordDecision(
		taskCtx: TaskContext,
		decision: CoordinationDecision,
	): Promise<void> {
		taskCtx.decisions.push(decision);
		await this.taskRegistry.recordDecision({
			threadId: taskCtx.threadId,
			sessionId: taskCtx.sessionId,
			timestamp: decision.timestamp,
			event: decision.event,
			promptText: decision.promptText,
			decision: decision.decision,
			response: decision.response,
			reasoning: decision.reasoning,
		});
		await this.syncTaskContext(taskCtx);
	}

	async setTaskDelivered(sessionId: string): Promise<void> {
		const taskCtx = this.tasks.get(sessionId);
		if (!taskCtx) return;
		taskCtx.taskDelivered = true;
		await this.syncTaskContext(taskCtx);
	}

	// ─── Unregistered Buffer Retry ───

	/**
	 * Schedule a retry check for buffered events from an unregistered session.
	 * Uses exponential backoff: 2s → 4s → 8s → 16s, max 30s total.
	 */
	private scheduleUnregisteredRetry(
		sessionId: string,
		attempt: number,
	): void {
		const delay =
			UNREGISTERED_RETRY_DELAYS[
				Math.min(attempt, UNREGISTERED_RETRY_DELAYS.length - 1)
			];

		const timer = setTimeout(() => {
			this.unregisteredRetryTimers.delete(sessionId);
			const stillBuffered = this.unregisteredBuffer.get(sessionId);
			if (!stillBuffered || stillBuffered.length === 0) return;

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
				return;
			}

			// Check if we've exceeded the absolute max wait
			const oldest = stillBuffered[0].receivedAt;
			const totalElapsed = Date.now() - oldest;
			if (totalElapsed >= UNREGISTERED_MAX_TOTAL_MS) {
				this.unregisteredBuffer.delete(sessionId);
				this.log(
					`Discarding ${stillBuffered.length} buffered events for unregistered session ${sessionId} after ${Math.round(totalElapsed / 1000)}s`,
				);
				return;
			}

			// Schedule next retry
			this.log(
				`Retry ${attempt + 1} for unregistered session ${sessionId} (next in ${delay}ms)`,
			);
			this.scheduleUnregisteredRetry(sessionId, attempt + 1);
		}, delay);

		this.unregisteredRetryTimers.set(sessionId, timer);
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
		// Relay to WebSocket clients — buffer if bridge isn't wired yet
		if (this.wsBroadcast) {
			this.wsBroadcast(event);
		} else if (this.preBridgeBroadcastBuffer.length < MAX_PRE_BRIDGE_BUFFER) {
			this.preBridgeBroadcastBuffer.push(event);
		}
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
		// Lazy-wire scratch decision callback if not yet connected
		if (!this.scratchDecisionWired) {
			this.wireScratchDecisionCallback();
		}

		// Ignore events from sessions created before this coordinator started.
		// Session IDs are formatted as "pty-{timestamp}-{hex}" — extract the timestamp.
		const tsMatch = sessionId.match(/^pty-(\d+)-/);
		if (tsMatch) {
			const sessionCreatedAt = Number(tsMatch[1]);
			if (sessionCreatedAt < this.startedAt - 60_000) {
				// Session is from before this coordinator's lifetime (with 1min grace)
				return;
			}
		}

		const taskCtx = this.tasks.get(sessionId);

		// Buffer events for unregistered sessions with exponential backoff retry.
		// Events arriving before registerTask() are buffered and retried at
		// 2s → 4s → 8s → 16s intervals (max 30s total) before being discarded.
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

				// Only schedule retry if not already retrying for this session
				if (!this.unregisteredRetryTimers.has(sessionId)) {
					this.scheduleUnregisteredRetry(sessionId, 0);
				}
			}
			return;
		}

		// Skip decision-making events for terminal states, but always allow
		// "stopped" and "error" through — they're definitive lifecycle signals
		// that the frontend needs to close consoles and clean up.
		// Exception: allow a late "task_complete" to recover a recently-stopped task.
		let recoveredFromStopped = false;
		if (
			taskCtx.status === "stopped" ||
			taskCtx.status === "error" ||
			taskCtx.status === "completed"
		) {
			if (taskCtx.status === "stopped" && event === "task_complete") {
				const stoppedAt = taskCtx.stoppedAt ?? 0;
				const ageMs = Date.now() - stoppedAt;
				if (stoppedAt > 0 && ageMs <= STOPPED_RECOVERY_WINDOW_MS) {
					this.log(
						`Recovering "${taskCtx.label}" from stopped on late task_complete (${Math.round(ageMs / 1000)}s old)`,
					);
					taskCtx.status = "active";
					taskCtx.stoppedAt = undefined;
					recoveredFromStopped = true;
				} else {
					this.log(
						`Ignoring "${event}" for ${taskCtx.label} (status: stopped, age=${Math.round(ageMs / 1000)}s)`,
					);
					return;
				}
			}
			if (!recoveredFromStopped && event !== "stopped" && event !== "error") {
				this.log(
					`Ignoring "${event}" for ${taskCtx.label} (status: ${taskCtx.status})`,
				);
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
					type:
						event === "blocked" ? "blocked_buffered" : "turn_complete_buffered",
					sessionId,
					timestamp: Date.now(),
					data,
				});
				this.pauseBuffer.push({ sessionId, event, data });
				this.log(
					`Buffered "${event}" for ${taskCtx.label} (coordinator paused)`,
				);
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
				// Broadcast immediately for UI visibility, but coalesce the
				// expensive LLM assessment — rapid turn-complete events within
				// 500ms are debounced so only the last one triggers an LLM call.
				this.broadcast({
					type: "turn_complete",
					sessionId,
					timestamp: Date.now(),
					data,
				});

				const existingCoalesce =
					this.turnCompleteCoalesceTimers.get(sessionId);
				if (existingCoalesce) clearTimeout(existingCoalesce);

				const coalescedData = data;
				const coalesceTimer = setTimeout(() => {
					this.turnCompleteCoalesceTimers.delete(sessionId);
					const currentTask = this.tasks.get(sessionId);
					if (currentTask && currentTask.status === "active") {
						handleTurnComplete(
							this,
							sessionId,
							currentTask,
							coalescedData,
						).catch((err) => {
							this.log(`Coalesced turn-complete failed: ${err}`);
						});
					}
				}, TURN_COMPLETE_COALESCE_MS);
				this.turnCompleteCoalesceTimers.set(sessionId, coalesceTimer);
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
				await this.taskRegistry.appendEvent({
					threadId: taskCtx.threadId,
					sessionId,
					eventType: "task_status_changed",
					summary: `Task "${taskCtx.label}" errored`,
					data: { status: "error", message: errorMsg },
				});
				checkAllTasksComplete(this);
				break;
			}

			case "stopped":
				// Don't downgrade "completed" or "error" to "stopped" — the async
				// stopSession fires after executeDecision already marked the task.
				if (taskCtx.status !== "completed" && taskCtx.status !== "error") {
					taskCtx.status = "stopped";
					taskCtx.stoppedAt = Date.now();
				}
				this.inFlightDecisions.delete(sessionId);
				this.broadcast({
					type: "stopped",
					sessionId,
					timestamp: Date.now(),
					data,
				});
				await this.taskRegistry.appendEvent({
					threadId: taskCtx.threadId,
					sessionId,
					eventType: "task_status_changed",
					summary: `Task "${taskCtx.label}" stopped`,
					data: { status: taskCtx.status },
				});
				checkAllTasksComplete(this);
				break;

			case "ready":
				taskCtx.status = "active";
				this.broadcast({
					type: "ready",
					sessionId,
					timestamp: Date.now(),
					data,
				});
				await this.taskRegistry.appendEvent({
					threadId: taskCtx.threadId,
					sessionId,
					eventType: "session_updated",
					summary: `Session "${taskCtx.label}" ready`,
					data: { status: "ready" },
				});
				break;

			case "tool_running": {
				// Agent is actively working via an external tool — keep watchdog happy
				taskCtx.status = "tool_running";
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
		await this.syncTaskContext(taskCtx);
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
				taskCtx.status = "active";
				taskCtx.autoResolvedCount = 0;
				await this.recordDecision(taskCtx, {
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
				taskCtx.status = "blocked";
				await this.recordDecision(taskCtx, {
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
