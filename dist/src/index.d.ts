/**
 * Coding Agent Plugin for Milady
 *
 * Provides orchestration capabilities for CLI-based coding agents:
 * - PTY session management (spawn, control, monitor coding agents)
 * - Git workspace provisioning (clone, branch, PR creation)
 * - GitHub issue management (create, list, update, close)
 * - Integration with Claude Code, Codex, Gemini CLI, Aider, Pi, etc.
 *
 * @module @elizaos/plugin-agent-orchestrator
 */
import type { Plugin } from "@elizaos/core";
export declare const codingAgentPlugin: Plugin;
export default codingAgentPlugin;
export type { AdapterType, AgentCredentials, AgentFileDescriptor, ApprovalConfig, ApprovalPreset, PreflightResult, PresetDefinition, RiskLevel, ToolCategory, WriteMemoryOptions, } from "coding-agent-adapters";
export { finalizeWorkspaceAction } from "./actions/finalize-workspace.js";
export { listAgentsAction } from "./actions/list-agents.js";
export { manageIssuesAction } from "./actions/manage-issues.js";
export { provisionWorkspaceAction } from "./actions/provision-workspace.js";
export { sendToAgentAction } from "./actions/send-to-agent.js";
export { spawnAgentAction } from "./actions/spawn-agent.js";
export { startCodingTaskAction } from "./actions/start-coding-task.js";
export { stopAgentAction } from "./actions/stop-agent.js";
export { createCodingAgentRouteHandler, handleCodingAgentRoutes, } from "./api/routes.js";
export type { CodingAgentType, PTYServiceConfig, SessionEventName, SessionInfo, SpawnSessionOptions, } from "./services/pty-service.js";
export { getCoordinator, PTYService } from "./services/pty-service.js";
export type { ChatMessageCallback, CoordinationDecision, PendingDecision, SupervisionLevel, SwarmEvent, TaskContext, WsBroadcastCallback, } from "./services/swarm-coordinator.js";
export { SwarmCoordinator } from "./services/swarm-coordinator.js";
export type { CoordinationLLMResponse } from "./services/swarm-coordinator-prompts.js";
export type { AuthPromptCallback, CodingWorkspaceConfig, CommitOptions, ProvisionWorkspaceOptions, PushOptions, WorkspaceResult, } from "./services/workspace-service.js";
export { CodingWorkspaceService } from "./services/workspace-service.js";
//# sourceMappingURL=index.d.ts.map