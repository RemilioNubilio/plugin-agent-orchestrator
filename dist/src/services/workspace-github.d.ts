/**
 * GitHub integration for Coding Workspace Service
 *
 * Extracted from workspace-service.ts — provides GitHub API access
 * via PAT or OAuth device flow, plus all issue management operations.
 *
 * @module services/workspace-github
 */
import type { IAgentRuntime } from "@elizaos/core";
import { type CreateIssueOptions, GitHubPatClient, type IssueComment, type IssueInfo, type IssueState } from "git-workspace-service";
/**
 * Callback for surfacing auth prompts to the user.
 * Returns the auth prompt text so Milady can relay it through chat.
 */
export type AuthPromptCallback = (prompt: {
    verificationUri: string;
    userCode: string;
    expiresIn: number;
}) => void;
/**
 * Context object passed by CodingWorkspaceService into every GitHub function.
 * Lets us keep the extracted functions stateless while still mutating shared state.
 */
export interface GitHubContext {
    runtime: IAgentRuntime;
    githubClient: GitHubPatClient | null;
    setGithubClient: (client: GitHubPatClient) => void;
    githubAuthInProgress: Promise<GitHubPatClient> | null;
    setGithubAuthInProgress: (p: Promise<GitHubPatClient> | null) => void;
    authPromptCallback: AuthPromptCallback | null;
    log: (msg: string) => void;
}
export declare function parseOwnerRepo(repo: string): {
    owner: string;
    repo: string;
};
export declare function ensureGitHubClient(ctx: GitHubContext): Promise<GitHubPatClient>;
export declare function performOAuthFlow(ctx: GitHubContext, clientId: string): Promise<GitHubPatClient>;
export declare function createIssue(ctx: GitHubContext, repo: string, options: CreateIssueOptions): Promise<IssueInfo>;
export declare function getIssue(ctx: GitHubContext, repo: string, issueNumber: number): Promise<IssueInfo>;
export declare function listIssues(ctx: GitHubContext, repo: string, options?: {
    state?: IssueState | "all";
    labels?: string[];
    assignee?: string;
}): Promise<IssueInfo[]>;
export declare function updateIssue(ctx: GitHubContext, repo: string, issueNumber: number, options: {
    title?: string;
    body?: string;
    state?: IssueState;
    labels?: string[];
    assignees?: string[];
}): Promise<IssueInfo>;
export declare function addComment(ctx: GitHubContext, repo: string, issueNumber: number, body: string): Promise<IssueComment>;
export declare function listComments(ctx: GitHubContext, repo: string, issueNumber: number): Promise<IssueComment[]>;
export declare function closeIssue(ctx: GitHubContext, repo: string, issueNumber: number): Promise<IssueInfo>;
export declare function reopenIssue(ctx: GitHubContext, repo: string, issueNumber: number): Promise<IssueInfo>;
export declare function addLabels(ctx: GitHubContext, repo: string, issueNumber: number, labels: string[]): Promise<void>;
//# sourceMappingURL=workspace-github.d.ts.map