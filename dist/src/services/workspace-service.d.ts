/**
 * Coding Workspace Service - Manages git workspaces for coding tasks
 *
 * Delegates to:
 * - workspace-github.ts  (issue management, OAuth, PAT auth)
 * - workspace-git-ops.ts (status, commit, push, PR creation)
 * - workspace-lifecycle.ts (GC, scratch dir cleanup)
 * - workspace-types.ts   (shared interface definitions)
 *
 * @module services/workspace-service
 */
import type { IAgentRuntime } from "@elizaos/core";
import { type CreateIssueOptions, type IssueComment, type IssueInfo, type IssueState, type PullRequestInfo, type WorkspaceEvent } from "git-workspace-service";
import type { AuthPromptCallback } from "./workspace-github.js";
export type { AuthPromptCallback } from "./workspace-github.js";
export type { CodingWorkspaceConfig, CommitOptions, PROptions, ProvisionWorkspaceOptions, PushOptions, WorkspaceResult, WorkspaceStatusResult, } from "./workspace-types.js";
import type { CodingWorkspaceConfig, CommitOptions, PROptions, ProvisionWorkspaceOptions, PushOptions, WorkspaceResult, WorkspaceStatusResult } from "./workspace-types.js";
type WorkspaceEventCallback = (event: WorkspaceEvent) => void;
export declare class CodingWorkspaceService {
    static serviceType: string;
    capabilityDescription: string;
    private runtime;
    private workspaceService;
    private credentialService;
    private githubClient;
    private githubAuthInProgress;
    private serviceConfig;
    private workspaces;
    private labels;
    private eventCallbacks;
    private authPromptCallback;
    constructor(runtime: IAgentRuntime, config?: CodingWorkspaceConfig);
    static start(runtime: IAgentRuntime): Promise<CodingWorkspaceService>;
    static stopRuntime(runtime: IAgentRuntime): Promise<void>;
    private initialize;
    stop(): Promise<void>;
    /** Provision a new workspace */
    provisionWorkspace(options: ProvisionWorkspaceOptions): Promise<WorkspaceResult>;
    getWorkspace(id: string): WorkspaceResult | undefined;
    listWorkspaces(): WorkspaceResult[];
    /**
     * Assign a semantic label to a workspace (e.g. "auth-bugfix").
     * If the label already exists, it is reassigned to the new workspace.
     */
    setLabel(workspaceId: string, label: string): void;
    getWorkspaceByLabel(label: string): WorkspaceResult | undefined;
    /** Resolve a workspace by label or ID. */
    resolveWorkspace(labelOrId: string): WorkspaceResult | undefined;
    getStatus(workspaceId: string): Promise<WorkspaceStatusResult>;
    commit(workspaceId: string, options: CommitOptions): Promise<string>;
    push(workspaceId: string, options?: PushOptions): Promise<void>;
    createPR(workspaceId: string, options: PROptions): Promise<PullRequestInfo>;
    private getGitHubContext;
    /** Set a callback to surface OAuth auth prompts to the user. */
    setAuthPromptCallback(callback: AuthPromptCallback): void;
    createIssue(repo: string, options: CreateIssueOptions): Promise<IssueInfo>;
    getIssue(repo: string, issueNumber: number): Promise<IssueInfo>;
    listIssues(repo: string, options?: {
        state?: IssueState | "all";
        labels?: string[];
        assignee?: string;
    }): Promise<IssueInfo[]>;
    updateIssue(repo: string, issueNumber: number, options: {
        title?: string;
        body?: string;
        state?: IssueState;
        labels?: string[];
        assignees?: string[];
    }): Promise<IssueInfo>;
    addComment(repo: string, issueNumber: number, body: string): Promise<IssueComment>;
    listComments(repo: string, issueNumber: number): Promise<IssueComment[]>;
    closeIssue(repo: string, issueNumber: number): Promise<IssueInfo>;
    reopenIssue(repo: string, issueNumber: number): Promise<IssueInfo>;
    addLabels(repo: string, issueNumber: number, labels: string[]): Promise<void>;
    removeWorkspace(workspaceId: string): Promise<void>;
    onEvent(callback: WorkspaceEventCallback): () => void;
    private emitEvent;
    /** Remove a scratch directory (non-git workspace) under the workspaces base dir. */
    removeScratchDir(dirPath: string): Promise<void>;
    /** GC orphaned workspace directories older than workspaceTtlMs. */
    private gcOrphanedWorkspaces;
    private log;
}
//# sourceMappingURL=workspace-service.d.ts.map