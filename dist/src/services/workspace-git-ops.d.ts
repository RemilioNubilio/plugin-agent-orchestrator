/**
 * Git operations for Coding Workspace Service
 *
 * Extracted from workspace-service.ts — provides git status, commit, push,
 * and PR creation as standalone functions operating on workspace paths.
 *
 * @module services/workspace-git-ops
 */
import type { PullRequestInfo, WorkspaceService } from "git-workspace-service";
import type { CommitOptions, PROptions, PushOptions, WorkspaceResult, WorkspaceStatusResult } from "./workspace-service.js";
/**
 * Get workspace git status (branch, staged/modified/untracked files).
 */
export declare function getStatus(workspacePath: string): Promise<WorkspaceStatusResult>;
/**
 * Commit changes in a workspace directory.
 * Returns the commit hash.
 */
export declare function commit(workspacePath: string, options: CommitOptions, log: (msg: string) => void): Promise<string>;
/**
 * Push changes to remote for a workspace.
 */
export declare function push(workspacePath: string, branch: string, options: PushOptions | undefined, log: (msg: string) => void): Promise<void>;
/**
 * Create a pull request for a workspace via the underlying WorkspaceService.
 */
export declare function createPR(workspaceService: WorkspaceService, workspace: WorkspaceResult, workspaceId: string, options: PROptions, log: (msg: string) => void): Promise<PullRequestInfo>;
//# sourceMappingURL=workspace-git-ops.d.ts.map