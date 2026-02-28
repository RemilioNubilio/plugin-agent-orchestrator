/**
 * Coding Agent Route Handlers
 *
 * Handles routes for PTY-based coding agent management:
 * - Preflight checks, metrics, workspace files
 * - Approval presets and config
 * - Agent CRUD: list, spawn, get, send, stop, output
 *
 * @module api/agent-routes
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteContext } from "./routes.js";
/**
 * Handle coding agent routes (/api/coding-agents/*)
 * Returns true if the route was handled, false otherwise
 */
export declare function handleAgentRoutes(req: IncomingMessage, res: ServerResponse, pathname: string, ctx: RouteContext): Promise<boolean>;
//# sourceMappingURL=agent-routes.d.ts.map