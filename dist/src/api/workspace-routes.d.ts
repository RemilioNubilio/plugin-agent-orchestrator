/**
 * Workspace Route Handlers
 *
 * Handles routes for git workspace management:
 * - Provision (clone repos, create worktrees)
 * - Get status, commit, push, create PR, delete
 *
 * @module api/workspace-routes
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteContext } from "./routes.js";
/**
 * Handle workspace routes (/api/workspace/*)
 * Returns true if the route was handled, false otherwise
 */
export declare function handleWorkspaceRoutes(req: IncomingMessage, res: ServerResponse, pathname: string, ctx: RouteContext): Promise<boolean>;
//# sourceMappingURL=workspace-routes.d.ts.map