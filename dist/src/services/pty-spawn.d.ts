/**
 * PTY session spawning logic — extracted from PTYService for maintainability.
 *
 * Contains the deferred task delivery, retry logic, per-agent settle delays,
 * and session buffer setup that runs during spawnSession().
 *
 * @module services/pty-spawn
 */
import type { AdapterType, BaseCodingAdapter } from "coding-agent-adapters";
import type { BunCompatiblePTYManager, PTYManager, SessionHandle, SpawnConfig, WorkerSessionHandle } from "pty-manager";
import type { PTYServiceConfig, SessionInfo, SpawnSessionOptions } from "./pty-types.js";
/**
 * Build a sanitized base environment from process.env, keeping only
 * safe system variables. Agent-specific credentials are injected
 * separately by the adapter's getEnv().
 */
export declare function buildSanitizedBaseEnv(): Record<string, string>;
export interface SpawnContext {
    manager: PTYManager | BunCompatiblePTYManager;
    usingBunWorker: boolean;
    serviceConfig: PTYServiceConfig;
    sessionMetadata: Map<string, Record<string, unknown>>;
    sessionWorkdirs: Map<string, string>;
    sessionOutputBuffers: Map<string, string[]>;
    outputUnsubscribers: Map<string, () => void>;
    taskResponseMarkers: Map<string, number>;
    getAdapter: (agentType: AdapterType) => BaseCodingAdapter;
    sendToSession: (sessionId: string, input: string) => Promise<unknown>;
    sendKeysToSession: (sessionId: string, keys: string | string[]) => Promise<void>;
    pushDefaultRules: (sessionId: string, agentType: string) => Promise<void>;
    toSessionInfo: (session: SessionHandle | WorkerSessionHandle, workdir?: string) => SessionInfo;
    log: (msg: string) => void;
}
/**
 * Set up session output buffering for Bun worker path.
 */
export declare function setupOutputBuffer(ctx: SpawnContext, sessionId: string): void;
/**
 * Set up deferred task delivery with retry logic.
 * IMPORTANT: Must be called BEFORE pushDefaultRules (which has a 1500ms sleep),
 * otherwise session_ready fires during pushDefaultRules and the listener misses it.
 */
export declare function setupDeferredTaskDelivery(ctx: SpawnContext, session: SessionHandle | WorkerSessionHandle, task: string, agentType: string): void;
/**
 * Build the SpawnConfig and env vars from SpawnSessionOptions.
 */
export declare function buildSpawnConfig(sessionId: string, options: SpawnSessionOptions, workdir: string): SpawnConfig & {
    id: string;
};
//# sourceMappingURL=pty-spawn.d.ts.map