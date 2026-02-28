/**
 * START_CODING_TASK action - Unified action to set up and launch coding agents
 *
 * Combines workspace provisioning and agent spawning into a single atomic action.
 * - If a repo URL is provided, clones it into a fresh workspace
 * - If no repo, creates a scratch sandbox directory
 * - Spawns the specified coding agent(s) in that workspace with the given task
 * - Supports multi-agent mode via pipe-delimited `agents` param
 *
 * This eliminates the need for multi-action chaining (PROVISION_WORKSPACE -> SPAWN_CODING_AGENT)
 * and ensures agents always run in an isolated directory.
 *
 * @module actions/start-coding-task
 */
import type { Action } from "@elizaos/core";
export declare const startCodingTaskAction: Action;
//# sourceMappingURL=start-coding-task.d.ts.map