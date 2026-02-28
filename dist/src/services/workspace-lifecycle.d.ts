/**
 * Workspace lifecycle utilities — garbage collection and scratch directory cleanup.
 *
 * Extracted from workspace-service.ts to reduce module size.
 *
 * @module services/workspace-lifecycle
 */
/**
 * Remove a scratch directory (non-git workspace used for ad-hoc tasks).
 * Safe to call for any path under the workspaces base dir.
 */
export declare function removeScratchDir(dirPath: string, baseDir: string, log: (msg: string) => void): Promise<void>;
/**
 * Garbage-collect orphaned workspace directories.
 * Removes directories older than the given TTL that aren't tracked by the current session.
 */
export declare function gcOrphanedWorkspaces(baseDir: string, workspaceTtlMs: number, trackedWorkspaceIds: Set<string>, log: (msg: string) => void): Promise<void>;
//# sourceMappingURL=workspace-lifecycle.d.ts.map