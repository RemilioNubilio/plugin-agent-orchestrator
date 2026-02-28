/** @module services/pty-service */
import { type IAgentRuntime } from "@elizaos/core";
import { type AdapterType, type AgentFileDescriptor, type ApprovalConfig, type ApprovalPreset, type PreflightResult, type WriteMemoryOptions } from "coding-agent-adapters";
import { PTYConsoleBridge } from "pty-console";
import type { SessionFilter, SessionMessage } from "pty-manager";
import { type AgentSelectionStrategy } from "./agent-selection.js";
import type { CodingAgentType, PTYServiceConfig, SessionEventCallback, SessionInfo, SpawnSessionOptions } from "./pty-types.js";
import { SwarmCoordinator } from "./swarm-coordinator.js";
export type { CodingAgentType, PTYServiceConfig, SessionEventName, SessionInfo, SpawnSessionOptions, } from "./pty-types.js";
export { normalizeAgentType } from "./pty-types.js";
/**
 * Retrieve the SwarmCoordinator from the PTYService registered on the runtime.
 * Returns undefined if PTYService or coordinator is not available.
 */
export declare function getCoordinator(runtime: IAgentRuntime): SwarmCoordinator | undefined;
export declare class PTYService {
    static serviceType: string;
    capabilityDescription: string;
    private runtime;
    private manager;
    private usingBunWorker;
    private serviceConfig;
    private sessionMetadata;
    private sessionWorkdirs;
    private eventCallbacks;
    private outputUnsubscribers;
    private sessionOutputBuffers;
    private adapterCache;
    /** Tracks the buffer index when a task was sent, so we can capture the response on completion */
    private taskResponseMarkers;
    /** Captures "Task completion trace" log entries from worker stderr (rolling, capped at 200) */
    private traceEntries;
    private static readonly MAX_TRACE_ENTRIES;
    /** Lightweight per-agent-type metrics for observability */
    private metricsTracker;
    /** Console bridge for terminal output streaming and buffered hydration */
    consoleBridge: PTYConsoleBridge | null;
    /** Swarm coordinator instance (if active). Accessed via getCoordinator(runtime). */
    coordinator: SwarmCoordinator | null;
    constructor(runtime: IAgentRuntime, config?: PTYServiceConfig);
    static start(runtime: IAgentRuntime): Promise<PTYService>;
    static stopRuntime(runtime: IAgentRuntime): Promise<void>;
    private initialize;
    stop(): Promise<void>;
    private generateSessionId;
    /** Build a SessionIOContext from current instance state. */
    private ioContext;
    /**
     * Spawn a new PTY session for a coding agent
     */
    spawnSession(options: SpawnSessionOptions): Promise<SessionInfo>;
    private autoResponseContext;
    private pushDefaultRules;
    private handleGeminiAuth;
    sendToSession(sessionId: string, input: string): Promise<SessionMessage | undefined>;
    sendKeysToSession(sessionId: string, keys: string | string[]): Promise<void>;
    stopSession(sessionId: string): Promise<void>;
    /** Default approval preset — runtime env var takes precedence over config. */
    get defaultApprovalPreset(): ApprovalPreset;
    /** Agent selection strategy — env var takes precedence. */
    get agentSelectionStrategy(): AgentSelectionStrategy;
    /** Default agent type when strategy is "fixed" — env var takes precedence. */
    get defaultAgentType(): AdapterType;
    /**
     * Resolve which agent type to use when the caller didn't specify one.
     *
     * - **fixed**: returns `defaultAgentType` immediately
     * - **ranked**: fetches preflight data, scores installed agents via
     *   metrics, and returns the highest scorer
     */
    resolveAgentType(): Promise<string>;
    getSession(sessionId: string): SessionInfo | undefined;
    listSessions(filter?: SessionFilter): Promise<SessionInfo[]>;
    subscribeToOutput(sessionId: string, callback: (data: string) => void): () => void;
    getSessionOutput(sessionId: string, lines?: number): Promise<string>;
    isSessionBlocked(sessionId: string): boolean;
    checkAvailableAgents(types?: AdapterType[]): Promise<PreflightResult[]>;
    getSupportedAgentTypes(): CodingAgentType[];
    private classifyStall;
    private getAdapter;
    getWorkspaceFiles(agentType: AdapterType): AgentFileDescriptor[];
    getMemoryFilePath(agentType: AdapterType): string;
    getApprovalConfig(agentType: AdapterType, preset: ApprovalPreset): ApprovalConfig;
    writeMemoryFile(agentType: AdapterType, workspacePath: string, content: string, options?: WriteMemoryOptions): Promise<string>;
    onSessionEvent(callback: SessionEventCallback): () => void;
    registerAdapter(adapter: unknown): void;
    private toSessionInfo;
    private emitEvent;
    getAgentMetrics(): Record<string, Omit<import("./agent-metrics.js").AgentMetrics, "totalCompletionMs">>;
    private log;
}
//# sourceMappingURL=pty-service.d.ts.map