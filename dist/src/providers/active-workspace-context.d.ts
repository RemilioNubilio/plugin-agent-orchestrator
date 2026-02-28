/**
 * Provider that injects active workspace and session context into every prompt.
 *
 * Mima needs to know what workspaces exist, which agents are running, and their
 * current status — without having to call LIST_AGENTS every message. This provider
 * reads from both the workspace service and PTY service to build a live context
 * summary that's always available in the prompt.
 *
 * @module providers/active-workspace-context
 */
import type { Provider } from "@elizaos/core";
export declare const activeWorkspaceContextProvider: Provider;
//# sourceMappingURL=active-workspace-context.d.ts.map