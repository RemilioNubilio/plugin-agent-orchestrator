/**
 * Issue Route Handlers
 *
 * Handles routes for GitHub issue management:
 * - List issues, create issue
 * - Get issue, comment on issue, close issue
 *
 * @module api/issue-routes
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteContext } from "./routes.js";
/**
 * Handle issue routes (/api/issues/*)
 * Returns true if the route was handled, false otherwise
 */
export declare function handleIssueRoutes(req: IncomingMessage, res: ServerResponse, pathname: string, ctx: RouteContext): Promise<boolean>;
//# sourceMappingURL=issue-routes.d.ts.map