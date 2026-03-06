/**
 * Claude Code HTTP Hooks — Webhook Endpoint
 *
 * Receives structured hook events from Claude Code's HTTP hooks system.
 * Replaces fragile PTY output scraping for state detection with deterministic
 * event-driven signals.
 *
 * @module api/hook-routes
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteContext } from "./routes.js";
import { parseBody, sendError, sendJson } from "./routes.js";

/**
 * Claude Code hook event payload (subset of fields we use).
 * Full schema: https://docs.anthropic.com/en/docs/claude-code/hooks
 */
interface HookEventPayload {
  hook_event_name: string;
  session_id?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  notification_type?: string;
  message?: string;
}

/**
 * Handle Claude Code HTTP hook routes.
 * Returns true if the route was handled, false otherwise.
 */
export async function handleHookRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  ctx: RouteContext,
): Promise<boolean> {
  if (pathname !== "/api/coding-agents/hooks") return false;

  const method = req.method?.toUpperCase();
  if (method !== "POST") {
    sendError(res, "Method not allowed", 405);
    return true;
  }

  if (!ctx.ptyService) {
    sendError(res, "PTY Service not available", 503);
    return true;
  }

  let body: Record<string, unknown>;
  try {
    body = await parseBody(req);
  } catch (err) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to parse request body",
      400,
    );
    return true;
  }

  const payload = body as unknown as HookEventPayload;
  const eventName = payload.hook_event_name;
  if (!eventName) {
    sendError(res, "Missing hook_event_name", 400);
    return true;
  }

  // Look up PTY session: prefer explicit header, fall back to cwd-based lookup
  const headerSessionId = req.headers["x-parallax-session-id"] as
    | string
    | undefined;
  const sessionId = headerSessionId
    ? headerSessionId
    : payload.cwd
      ? ctx.ptyService.findSessionIdByCwd(payload.cwd)
      : undefined;

  if (!sessionId) {
    // Not fatal — the hook may fire before we've tracked the session.
    // Return success so Claude Code doesn't retry.
    sendJson(res, { status: "ignored", reason: "session_not_found" });
    return true;
  }

  // Dispatch by event type
  switch (eventName) {
    case "PermissionRequest": {
      // Auto-approve all tool permissions natively — no PTY keystroke needed.
      sendJson(res, {
        hookSpecificOutput: {
          hookEventName: "PermissionRequest",
          decision: { behavior: "allow" },
        },
      });
      ctx.ptyService.handleHookEvent(sessionId, "permission_approved", {
        tool: payload.tool_name,
      });
      return true;
    }

    case "PreToolUse": {
      // Track which tool is running — suppress stall detection.
      ctx.ptyService.handleHookEvent(sessionId, "tool_running", {
        toolName: payload.tool_name,
        source: "hook",
      });
      // Return allow decision so the tool proceeds without permission prompt.
      sendJson(res, {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
        },
      });
      return true;
    }

    case "Stop": {
      // Agent finished responding — mark task complete.
      ctx.ptyService.handleHookEvent(sessionId, "task_complete", {
        source: "hook",
      });
      sendJson(res, {});
      return true;
    }

    case "Notification": {
      // State change notifications (idle, permission, auth).
      ctx.ptyService.handleHookEvent(sessionId, "notification", {
        type: payload.notification_type,
        message: payload.message,
      });
      sendJson(res, {});
      return true;
    }

    case "TaskCompleted": {
      ctx.ptyService.handleHookEvent(sessionId, "task_complete", {
        source: "hook_task_completed",
      });
      sendJson(res, {});
      return true;
    }

    default: {
      // Unknown event — acknowledge without action.
      sendJson(res, { status: "ignored", reason: "unknown_event" });
      return true;
    }
  }
}
