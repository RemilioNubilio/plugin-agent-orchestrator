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
import type { PTYService } from "./pty-service.js";
import type { CodingAgentType } from "./pty-types.js";
import type { CoordinationLLMResponse } from "./swarm-coordinator-prompts.js";
/** Callback injected by server.ts to route chat messages to the user's conversation. */
export type ChatMessageCallback = (text: string, source?: string) => Promise<void>;
/** Callback injected by server.ts to relay coordinator events to WebSocket clients. */
export type WsBroadcastCallback = (event: SwarmEvent) => void;
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
}
export interface CoordinationDecision {
    timestamp: number;
    event: string;
    promptText: string;
    decision: "respond" | "escalate" | "ignore" | "complete" | "auto_resolved";
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
    /** Last-seen output snapshot per session — used by idle watchdog. */
    readonly lastSeenOutput: Map<string, string>;
    /** Timestamp of last tool_running chat notification per session — for throttling. */
    readonly lastToolNotification: Map<string, number>;
    broadcast(event: SwarmEvent): void;
    sendChatMessage(text: string, source?: string): void;
    log(message: string): void;
    getSupervisionLevel(): SupervisionLevel;
}
export declare class SwarmCoordinator implements SwarmCoordinatorContext {
    static serviceType: string;
    readonly runtime: IAgentRuntime;
    ptyService: PTYService | null;
    private unsubscribeEvents;
    /** Per-session task context. */
    readonly tasks: Map<string, TaskContext>;
    /** SSE clients receiving live events. */
    private sseClients;
    /** Supervision level (default: autonomous). */
    private supervisionLevel;
    /** Pending confirmations for "confirm" mode. */
    readonly pendingDecisions: Map<string, PendingDecision>;
    /** In-flight decision lock — prevents parallel LLM calls for same session. */
    readonly inFlightDecisions: Set<string>;
    /** Callback to send chat messages to the user's conversation UI. */
    private chatCallback;
    /** Callback to relay coordinator events to WebSocket clients. */
    private wsBroadcast;
    /** Buffer for events arriving before task registration. */
    private unregisteredBuffer;
    /** Idle watchdog timer handle. */
    private idleWatchdogTimer;
    /** Last-seen output snapshot per session — used by idle watchdog to detect data flow. */
    readonly lastSeenOutput: Map<string, string>;
    /** Timestamp of last tool_running chat notification per session — for throttling. */
    readonly lastToolNotification: Map<string, number>;
    constructor(runtime: IAgentRuntime);
    /** Inject a callback (from server.ts) to route messages to the user's chat UI. */
    setChatCallback(cb: ChatMessageCallback): void;
    /** Inject a callback (from server.ts) to relay events to WebSocket clients. */
    setWsBroadcast(cb: WsBroadcastCallback): void;
    /** Null-safe wrapper — sends a message to the user's conversation if callback is set. */
    sendChatMessage(text: string, source?: string): void;
    /**
     * Initialize the coordinator by subscribing to PTY session events.
     * Called from plugin init after services are ready.
     */
    start(ptyService: PTYService): void;
    stop(): void;
    registerTask(sessionId: string, context: {
        agentType: CodingAgentType;
        label: string;
        originalTask: string;
        workdir: string;
        repo?: string;
    }): void;
    /**
     * Return the repo URL from the most recently registered task that had one.
     * Useful as a fallback when the user says "in the same repo" without a URL.
     */
    getLastUsedRepo(): string | undefined;
    getTaskContext(sessionId: string): TaskContext | undefined;
    getAllTaskContexts(): TaskContext[];
    /**
     * Register an SSE client. Returns an unsubscribe function.
     * Sends a snapshot of current state on connect.
     */
    addSseClient(res: ServerResponse): () => void;
    broadcast(event: SwarmEvent): void;
    private writeSseEvent;
    handleSessionEvent(sessionId: string, event: string, data: unknown): Promise<void>;
    makeCoordinationDecision(taskCtx: TaskContext, promptText: string, recentOutput: string): Promise<CoordinationLLMResponse | null>;
    executeDecision(sessionId: string, decision: CoordinationLLMResponse): Promise<void>;
    setSupervisionLevel(level: SupervisionLevel): void;
    getSupervisionLevel(): SupervisionLevel;
    getPendingConfirmations(): PendingDecision[];
    confirmDecision(sessionId: string, approved: boolean, override?: {
        response?: string;
        useKeys?: boolean;
        keys?: string[];
    }): Promise<void>;
    log(message: string): void;
}
//# sourceMappingURL=swarm-coordinator.d.ts.map