/**
 * Swarm Coordinator — Decision Loop & Blocked/Turn-Complete Handlers
 *
 * Extracted from swarm-coordinator.ts for modularity.
 * All functions are pure async helpers that receive a SwarmCoordinatorContext
 * to access shared state and services.
 *
 * @module services/swarm-decision-loop
 */
import type { SwarmCoordinatorContext, TaskContext } from "./swarm-coordinator.js";
import { type CoordinationLLMResponse } from "./swarm-coordinator-prompts.js";
/** Check if a permission prompt references paths outside the workspace. */
export declare function isOutOfScopeAccess(promptText: string, workdir: string): boolean;
/**
 * Ask the LLM to make a coordination decision about a blocked agent.
 */
export declare function makeCoordinationDecision(ctx: SwarmCoordinatorContext, taskCtx: TaskContext, promptText: string, recentOutput: string): Promise<CoordinationLLMResponse | null>;
/**
 * Execute a coordination decision — send response, complete session, escalate, or ignore.
 */
export declare function executeDecision(ctx: SwarmCoordinatorContext, sessionId: string, decision: CoordinationLLMResponse): Promise<void>;
/**
 * Handle a "blocked" session event — auto-resolved, escalated, or routed to decision loop.
 */
export declare function handleBlocked(ctx: SwarmCoordinatorContext, sessionId: string, taskCtx: TaskContext, data: unknown): Promise<void>;
/**
 * Handle a turn completion event. Instead of immediately stopping the session,
 * ask the LLM whether the overall task is done or the agent needs more turns.
 */
export declare function handleTurnComplete(ctx: SwarmCoordinatorContext, sessionId: string, taskCtx: TaskContext, data: unknown): Promise<void>;
/**
 * Handle an autonomous decision for a blocked session — call the LLM and execute immediately.
 */
export declare function handleAutonomousDecision(ctx: SwarmCoordinatorContext, sessionId: string, taskCtx: TaskContext, promptText: string, recentOutput: string): Promise<void>;
/**
 * Handle a confirm-mode decision — call LLM, then queue for human approval.
 */
export declare function handleConfirmDecision(ctx: SwarmCoordinatorContext, sessionId: string, taskCtx: TaskContext, promptText: string, recentOutput: string): Promise<void>;
//# sourceMappingURL=swarm-decision-loop.d.ts.map