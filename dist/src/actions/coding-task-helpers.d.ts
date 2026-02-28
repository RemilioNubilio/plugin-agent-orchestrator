/**
 * Helper functions for the START_CODING_TASK action.
 *
 * - createScratchDir()      -- Creates a scratch sandbox directory for non-repo tasks
 * - generateLabel()         -- Generate a short semantic label from repo URL and/or task description
 * - registerSessionEvents() -- Register lifecycle event handlers for a spawned session
 *
 * @module actions/coding-task-helpers
 */
import { type HandlerCallback, type IAgentRuntime } from "@elizaos/core";
import type { PTYService } from "../services/pty-service.js";
/** Create a scratch sandbox directory for non-repo tasks */
export declare function createScratchDir(): string;
/**
 * Generate a short semantic label from repo URL and/or task description.
 * e.g. "git-workspace-service-testbed/hello-mima" or "scratch/react-research"
 */
export declare function generateLabel(repo: string | undefined, task: string | undefined): string;
/**
 * Register lifecycle event handlers for a spawned session.
 *
 * When `coordinatorActive` is true the SwarmCoordinator owns chat messaging
 * and session lifecycle for blocked / task_complete / error events.
 * This listener still handles scratch-dir cleanup regardless.
 */
export declare function registerSessionEvents(ptyService: PTYService, runtime: IAgentRuntime, sessionId: string, label: string, scratchDir: string | null, callback?: HandlerCallback, coordinatorActive?: boolean): void;
//# sourceMappingURL=coding-task-helpers.d.ts.map