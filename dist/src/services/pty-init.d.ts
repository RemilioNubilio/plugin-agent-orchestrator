/**
 * PTY manager initialization — extracted from PTYService.initialize().
 *
 * Creates either a BunCompatiblePTYManager (for Bun runtime) or PTYManager
 * (for Node), wires up event handlers, and returns the configured manager.
 *
 * @module services/pty-init
 */
import { BunCompatiblePTYManager, PTYManager, type StallClassification } from "pty-manager";
import type { PTYServiceConfig } from "./pty-types.js";
/**
 * All callbacks and state that the initialization logic needs
 * from the surrounding PTYService instance.
 */
export interface InitContext {
    serviceConfig: PTYServiceConfig;
    classifyStall: (sessionId: string, recentOutput: string) => Promise<StallClassification | null>;
    emitEvent: (sessionId: string, event: string, data: unknown) => void;
    handleGeminiAuth: (sessionId: string) => void;
    sessionOutputBuffers: Map<string, string[]>;
    taskResponseMarkers: Map<string, number>;
    metricsTracker: {
        recordCompletion(type: string, method: string, durationMs: number): void;
    };
    traceEntries: Array<string | Record<string, unknown>>;
    maxTraceEntries: number;
    log: (msg: string) => void;
}
/** Value returned by {@link initializePTYManager}. */
export interface InitResult {
    manager: PTYManager | BunCompatiblePTYManager;
    usingBunWorker: boolean;
}
/**
 * Create and configure a PTY manager for the current runtime.
 *
 * - **Bun**: instantiates a {@link BunCompatiblePTYManager} that spawns a
 *   Node worker process and communicates via JSON-RPC over stdio.
 * - **Node**: instantiates a {@link PTYManager} directly and registers
 *   all built-in adapters in-process.
 */
export declare function initializePTYManager(ctx: InitContext): Promise<InitResult>;
//# sourceMappingURL=pty-init.d.ts.map