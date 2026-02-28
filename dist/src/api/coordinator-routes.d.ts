/**
 * Swarm Coordinator Route Handlers
 *
 * Provides SSE streaming and HTTP API for the coordination layer:
 * - SSE event stream for real-time dashboard
 * - Task status and context queries
 * - Pending confirmation management
 * - Supervision level control
 *
 * @module api/coordinator-routes
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { SwarmCoordinator } from "../services/swarm-coordinator.js";
import type { RouteContext } from "./routes.js";
/**
 * Handle coordinator routes (/api/coding-agents/coordinator/*)
 * Returns true if the route was handled, false otherwise.
 */
export declare function handleCoordinatorRoutes(req: IncomingMessage, res: ServerResponse, pathname: string, ctx: RouteContext & {
    coordinator?: SwarmCoordinator;
}): Promise<boolean>;
//# sourceMappingURL=coordinator-routes.d.ts.map