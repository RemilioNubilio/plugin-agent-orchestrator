/**
 * Session I/O helpers — extracted from PTYService for maintainability.
 *
 * Standalone functions for sending input/keys to sessions and stopping
 * sessions. Each function takes a {@link SessionIOContext} that provides
 * the manager instance and shared state maps.
 *
 * @module services/pty-session-io
 */
import type { BunCompatiblePTYManager, PTYManager, SessionMessage } from "pty-manager";
/**
 * Shared context required by all session I/O functions.
 * Built inline from PTYService instance fields.
 */
export interface SessionIOContext {
    manager: PTYManager | BunCompatiblePTYManager;
    usingBunWorker: boolean;
    sessionOutputBuffers: Map<string, string[]>;
    taskResponseMarkers: Map<string, number>;
    outputUnsubscribers: Map<string, () => void>;
}
/**
 * Send text input to a session.
 *
 * Marks the buffer position for task response capture, then writes the
 * input via the appropriate manager API.
 */
export declare function sendToSession(ctx: SessionIOContext, sessionId: string, input: string): Promise<SessionMessage | undefined>;
/**
 * Send key sequences to a session (for special keys like arrows, enter, etc.).
 */
export declare function sendKeysToSession(ctx: SessionIOContext, sessionId: string, keys: string | string[]): Promise<void>;
/**
 * Stop a PTY session and clean up all associated state.
 */
export declare function stopSession(ctx: SessionIOContext, sessionId: string, sessionMetadata: Map<string, Record<string, unknown>>, sessionWorkdirs: Map<string, string>, log: (msg: string) => void): Promise<void>;
/**
 * Subscribe to live output from a session.
 * Returns an unsubscribe function.
 */
export declare function subscribeToOutput(ctx: SessionIOContext, sessionId: string, callback: (data: string) => void): () => void;
/**
 * Get buffered or logged output from a session.
 */
export declare function getSessionOutput(ctx: SessionIOContext, sessionId: string, lines?: number): Promise<string>;
//# sourceMappingURL=pty-session-io.d.ts.map