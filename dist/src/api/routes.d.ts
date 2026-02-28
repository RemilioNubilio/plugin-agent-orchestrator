/**
 * Coding Agent API Routes — Dispatcher
 *
 * Provides shared helpers (parseBody, sendJson, sendError), types, and the
 * top-level route dispatcher that delegates to domain-specific route modules.
 *
 * @module api/routes
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { IAgentRuntime } from "@elizaos/core";
import type { PTYService } from "../services/pty-service.js";
import type { SwarmCoordinator } from "../services/swarm-coordinator.js";
import type { CodingWorkspaceService } from "../services/workspace-service.js";
export type JsonValue = string | number | boolean | null | JsonValue[] | {
    [key: string]: JsonValue;
};
export interface RouteContext {
    runtime: IAgentRuntime;
    ptyService: PTYService | null;
    workspaceService: CodingWorkspaceService | null;
    coordinator?: SwarmCoordinator;
}
export declare const MAX_BODY_SIZE: number;
export declare function parseBody(req: IncomingMessage): Promise<Record<string, unknown>>;
export declare function sendJson(res: ServerResponse, data: JsonValue, status?: number): void;
export declare function sendError(res: ServerResponse, message: string, status?: number): void;
/**
 * Handle coding agent routes
 * Returns true if the route was handled, false otherwise
 */
export declare function handleCodingAgentRoutes(req: IncomingMessage, res: ServerResponse, pathname: string, ctx: RouteContext): Promise<boolean>;
/**
 * Create route handler with services from runtime
 */
export declare function createCodingAgentRouteHandler(runtime: IAgentRuntime, coordinator?: SwarmCoordinator): (req: IncomingMessage, res: ServerResponse, pathname: string) => Promise<boolean>;
//# sourceMappingURL=routes.d.ts.map