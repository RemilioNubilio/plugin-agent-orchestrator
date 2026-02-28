/**
 * Swarm Coordinator — Idle Watchdog
 *
 * Extracted from swarm-coordinator.ts for modularity.
 * Scans active sessions for idle ones and asks the LLM to assess their state.
 *
 * @module services/swarm-idle-watchdog
 */
import type { SwarmCoordinatorContext, TaskContext } from "./swarm-coordinator.js";
/** How long a session can be idle before the watchdog checks on it (ms). */
export declare const IDLE_THRESHOLD_MS: number;
/** Max idle checks before force-escalating a session. */
export declare const MAX_IDLE_CHECKS = 4;
/**
 * Scan all active sessions for idle ones. Called periodically by the watchdog timer.
 */
export declare function scanIdleSessions(ctx: SwarmCoordinatorContext): Promise<void>;
/**
 * Handle an idle session by asking the LLM to assess its state.
 */
export declare function handleIdleCheck(ctx: SwarmCoordinatorContext, taskCtx: TaskContext, idleMinutes: number): Promise<void>;
//# sourceMappingURL=swarm-idle-watchdog.d.ts.map