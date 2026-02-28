/**
 * Handler logic for the START_CODING_TASK action.
 *
 * - handleMultiAgent()  -- Multi-agent mode (pipe-delimited `agents` param)
 * - handleSingleAgent() -- Single-agent mode (standard handler path)
 *
 * @module actions/coding-task-handlers
 */
import { type ActionResult, type HandlerCallback, type IAgentRuntime, type Memory, type State } from "@elizaos/core";
import type { AgentCredentials } from "coding-agent-adapters";
import type { PTYService } from "../services/pty-service.js";
import { type CodingAgentType } from "../services/pty-types.js";
import type { CodingWorkspaceService } from "../services/workspace-service.js";
/** Shared context passed to both multi-agent and single-agent handlers */
export interface CodingTaskContext {
    runtime: IAgentRuntime;
    ptyService: PTYService;
    wsService: CodingWorkspaceService | undefined;
    credentials: AgentCredentials;
    customCredentials: Record<string, string> | undefined;
    callback: HandlerCallback | undefined;
    message: Memory;
    state: State | undefined;
    repo: string | undefined;
    defaultAgentType: CodingAgentType;
    rawAgentType: string;
    memoryContent: string | undefined;
    approvalPreset: string | undefined;
    explicitLabel: string | undefined;
}
/**
 * Multi-agent mode handler.
 *
 * Parses pipe-delimited agent specs and spawns each agent in its own
 * workspace clone (or scratch directory).
 */
export declare function handleMultiAgent(ctx: CodingTaskContext, agentsParam: string): Promise<ActionResult | undefined>;
/**
 * Single-agent mode handler.
 *
 * Provisions a workspace (clone or scratch) and spawns a single coding agent.
 */
export declare function handleSingleAgent(ctx: CodingTaskContext, task: string | undefined): Promise<ActionResult | undefined>;
//# sourceMappingURL=coding-task-handlers.d.ts.map