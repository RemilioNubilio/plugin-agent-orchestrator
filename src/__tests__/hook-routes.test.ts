/**
 * Hook Routes tests
 *
 * Tests the /api/coding-agents/hooks endpoint that receives structured
 * hook events from Claude Code and Gemini CLI.
 */

import { beforeEach, describe, expect, it, jest } from "bun:test";
import { EventEmitter } from "node:events";

import type { RouteContext } from "../api/routes.js";

const { handleHookRoutes } = await import("../api/hook-routes.js");

// ---------------------------------------------------------------------------
// Mock request / response helpers (matches routes.test.ts patterns)
// ---------------------------------------------------------------------------

function createMockReq(
  method: string,
  body?: Record<string, unknown>,
  headers?: Record<string, string>,
  // biome-ignore lint/suspicious/noExplicitAny: test mock
): any {
  // biome-ignore lint/suspicious/noExplicitAny: EventEmitter needs dynamic props
  const req: any = new EventEmitter();
  req.method = method;
  req.url = "/api/coding-agents/hooks";
  req.headers = { host: "localhost:2138", ...headers };
  if (body) {
    setTimeout(() => {
      req.emit("data", JSON.stringify(body));
      req.emit("end");
    }, 0);
  } else {
    setTimeout(() => req.emit("end"), 0);
  }
  return req;
}

// biome-ignore lint/suspicious/noExplicitAny: test mock
function createMockRes(): any {
  const res = {
    writeHead: jest.fn(),
    end: jest.fn(),
    _getJson() {
      if (this.end.mock.calls.length > 0) {
        return JSON.parse(this.end.mock.calls[0][0]);
      }
      return null;
    },
    _getStatus() {
      if (this.writeHead.mock.calls.length > 0) {
        return this.writeHead.mock.calls[0][0];
      }
      return null;
    },
  };
  return res;
}

// ---------------------------------------------------------------------------
// Mock PTYService
// ---------------------------------------------------------------------------

function createMockPTYService() {
  return {
    handleHookEvent: jest.fn(),
    findSessionIdByCwd: jest.fn().mockReturnValue("s-123"),
  };
}

function makeCtx(
  overrides: Partial<RouteContext> = {},
): RouteContext {
  return {
    runtime: {} as RouteContext["runtime"],
    // biome-ignore lint/suspicious/noExplicitAny: mock
    ptyService: createMockPTYService() as any,
    workspaceService: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleHookRoutes", () => {
  let ctx: RouteContext;

  beforeEach(() => {
    ctx = makeCtx();
  });

  // =========================================================================
  // Routing & validation
  // =========================================================================

  describe("routing and validation", () => {
    it("returns false for non-hook paths", async () => {
      const req = createMockReq("POST", { hook_event_name: "Stop" });
      const res = createMockRes();

      const handled = await handleHookRoutes(
        req,
        res,
        "/api/coding-agents",
        ctx,
      );

      expect(handled).toBe(false);
    });

    it("rejects non-POST methods with 405", async () => {
      const req = createMockReq("GET");
      const res = createMockRes();

      await handleHookRoutes(req, res, "/api/coding-agents/hooks", ctx);

      expect(res._getStatus()).toBe(405);
    });

    it("returns 503 when PTY service is null", async () => {
      const ctxNoPTY = makeCtx({ ptyService: null });
      const req = createMockReq("POST", { hook_event_name: "Stop" });
      const res = createMockRes();

      await handleHookRoutes(req, res, "/api/coding-agents/hooks", ctxNoPTY);

      expect(res._getStatus()).toBe(503);
    });

    it("returns 400 when hook_event_name is missing", async () => {
      const req = createMockReq("POST", { some_field: "value" });
      const res = createMockRes();

      await handleHookRoutes(req, res, "/api/coding-agents/hooks", ctx);

      expect(res._getStatus()).toBe(400);
      expect(res._getJson().error).toContain("hook_event_name");
    });
  });

  // =========================================================================
  // Session lookup
  // =========================================================================

  describe("session lookup", () => {
    it("uses X-Parallax-Session-Id header when present", async () => {
      const req = createMockReq(
        "POST",
        { hook_event_name: "Stop" },
        { "x-parallax-session-id": "s-header" },
      );
      const res = createMockRes();

      await handleHookRoutes(req, res, "/api/coding-agents/hooks", ctx);

      // biome-ignore lint/suspicious/noExplicitAny: accessing mock
      const pty = ctx.ptyService as any;
      expect(pty.handleHookEvent).toHaveBeenCalledWith(
        "s-header",
        "task_complete",
        expect.anything(),
      );
      // Should NOT have called findSessionIdByCwd
      expect(pty.findSessionIdByCwd).not.toHaveBeenCalled();
    });

    it("falls back to cwd-based lookup when no header", async () => {
      const req = createMockReq("POST", {
        hook_event_name: "Stop",
        cwd: "/workspace/project",
      });
      const res = createMockRes();

      await handleHookRoutes(req, res, "/api/coding-agents/hooks", ctx);

      // biome-ignore lint/suspicious/noExplicitAny: accessing mock
      const pty = ctx.ptyService as any;
      expect(pty.findSessionIdByCwd).toHaveBeenCalledWith("/workspace/project");
      expect(pty.handleHookEvent).toHaveBeenCalledWith(
        "s-123",
        "task_complete",
        expect.anything(),
      );
    });

    it("returns ignored when session not found", async () => {
      // biome-ignore lint/suspicious/noExplicitAny: accessing mock
      (ctx.ptyService as any).findSessionIdByCwd.mockReturnValue(undefined);

      const req = createMockReq("POST", {
        hook_event_name: "Stop",
        cwd: "/unknown/path",
      });
      const res = createMockRes();

      await handleHookRoutes(req, res, "/api/coding-agents/hooks", ctx);

      expect(res._getStatus()).toBe(200);
      expect(res._getJson().status).toBe("ignored");
      expect(res._getJson().reason).toBe("session_not_found");
    });
  });

  // =========================================================================
  // Claude Code events
  // =========================================================================

  describe("Claude Code events", () => {
    it("PermissionRequest returns allow decision and fires permission_approved", async () => {
      const req = createMockReq(
        "POST",
        {
          hook_event_name: "PermissionRequest",
          tool_name: "Edit",
        },
        { "x-parallax-session-id": "s-1" },
      );
      const res = createMockRes();

      await handleHookRoutes(req, res, "/api/coding-agents/hooks", ctx);

      const json = res._getJson();
      expect(json.hookSpecificOutput.decision.behavior).toBe("allow");

      // biome-ignore lint/suspicious/noExplicitAny: accessing mock
      const pty = ctx.ptyService as any;
      expect(pty.handleHookEvent).toHaveBeenCalledWith(
        "s-1",
        "permission_approved",
        { tool: "Edit" },
      );
    });

    it("PreToolUse returns allow and fires tool_running", async () => {
      const req = createMockReq(
        "POST",
        {
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
        },
        { "x-parallax-session-id": "s-1" },
      );
      const res = createMockRes();

      await handleHookRoutes(req, res, "/api/coding-agents/hooks", ctx);

      const json = res._getJson();
      expect(json.hookSpecificOutput.permissionDecision).toBe("allow");

      // biome-ignore lint/suspicious/noExplicitAny: accessing mock
      const pty = ctx.ptyService as any;
      expect(pty.handleHookEvent).toHaveBeenCalledWith(
        "s-1",
        "tool_running",
        { toolName: "Bash", source: "hook" },
      );
    });

    it("Stop fires task_complete", async () => {
      const req = createMockReq(
        "POST",
        { hook_event_name: "Stop" },
        { "x-parallax-session-id": "s-1" },
      );
      const res = createMockRes();

      await handleHookRoutes(req, res, "/api/coding-agents/hooks", ctx);

      // biome-ignore lint/suspicious/noExplicitAny: accessing mock
      const pty = ctx.ptyService as any;
      expect(pty.handleHookEvent).toHaveBeenCalledWith(
        "s-1",
        "task_complete",
        { source: "hook" },
      );
    });

    it("TaskCompleted fires task_complete", async () => {
      const req = createMockReq(
        "POST",
        { hook_event_name: "TaskCompleted" },
        { "x-parallax-session-id": "s-1" },
      );
      const res = createMockRes();

      await handleHookRoutes(req, res, "/api/coding-agents/hooks", ctx);

      // biome-ignore lint/suspicious/noExplicitAny: accessing mock
      const pty = ctx.ptyService as any;
      expect(pty.handleHookEvent).toHaveBeenCalledWith(
        "s-1",
        "task_complete",
        { source: "hook_task_completed" },
      );
    });
  });

  // =========================================================================
  // Gemini CLI events
  // =========================================================================

  describe("Gemini CLI events", () => {
    it("BeforeTool fires tool_running with gemini source", async () => {
      const req = createMockReq(
        "POST",
        {
          hook_event_name: "BeforeTool",
          toolName: "shell",
        },
        { "x-parallax-session-id": "s-1" },
      );
      const res = createMockRes();

      await handleHookRoutes(req, res, "/api/coding-agents/hooks", ctx);

      // biome-ignore lint/suspicious/noExplicitAny: accessing mock
      const pty = ctx.ptyService as any;
      expect(pty.handleHookEvent).toHaveBeenCalledWith(
        "s-1",
        "tool_running",
        { toolName: "shell", source: "gemini_hook" },
      );
      expect(res._getJson().decision).toBe("allow");
    });

    it("AfterTool fires notification with tool_complete type", async () => {
      const req = createMockReq(
        "POST",
        {
          hook_event_name: "AfterTool",
          toolName: "shell",
        },
        { "x-parallax-session-id": "s-1" },
      );
      const res = createMockRes();

      await handleHookRoutes(req, res, "/api/coding-agents/hooks", ctx);

      // biome-ignore lint/suspicious/noExplicitAny: accessing mock
      const pty = ctx.ptyService as any;
      expect(pty.handleHookEvent).toHaveBeenCalledWith(
        "s-1",
        "notification",
        { type: "tool_complete", message: "Tool shell finished" },
      );
    });

    it("AfterAgent fires task_complete", async () => {
      const req = createMockReq(
        "POST",
        { hook_event_name: "AfterAgent" },
        { "x-parallax-session-id": "s-1" },
      );
      const res = createMockRes();

      await handleHookRoutes(req, res, "/api/coding-agents/hooks", ctx);

      // biome-ignore lint/suspicious/noExplicitAny: accessing mock
      const pty = ctx.ptyService as any;
      expect(pty.handleHookEvent).toHaveBeenCalledWith(
        "s-1",
        "task_complete",
        { source: "gemini_hook" },
      );
    });

    it("SessionEnd fires session_end", async () => {
      const req = createMockReq(
        "POST",
        { hook_event_name: "SessionEnd" },
        { "x-parallax-session-id": "s-1" },
      );
      const res = createMockRes();

      await handleHookRoutes(req, res, "/api/coding-agents/hooks", ctx);

      // biome-ignore lint/suspicious/noExplicitAny: accessing mock
      const pty = ctx.ptyService as any;
      expect(pty.handleHookEvent).toHaveBeenCalledWith(
        "s-1",
        "session_end",
        { source: "hook" },
      );
    });
  });

  // =========================================================================
  // Shared events
  // =========================================================================

  describe("Notification events", () => {
    it("ToolPermission notification auto-approves", async () => {
      const req = createMockReq(
        "POST",
        {
          hook_event_name: "Notification",
          notification_type: "ToolPermission",
          tool_name: "WriteFile",
        },
        { "x-parallax-session-id": "s-1" },
      );
      const res = createMockRes();

      await handleHookRoutes(req, res, "/api/coding-agents/hooks", ctx);

      // biome-ignore lint/suspicious/noExplicitAny: accessing mock
      const pty = ctx.ptyService as any;
      expect(pty.handleHookEvent).toHaveBeenCalledWith(
        "s-1",
        "permission_approved",
        { tool: "WriteFile" },
      );
      expect(res._getJson().decision).toBe("allow");
    });

    it("Gemini camelCase notificationType also works", async () => {
      const req = createMockReq(
        "POST",
        {
          hook_event_name: "Notification",
          notificationType: "ToolPermission",
          toolName: "shell",
        },
        { "x-parallax-session-id": "s-1" },
      );
      const res = createMockRes();

      await handleHookRoutes(req, res, "/api/coding-agents/hooks", ctx);

      // biome-ignore lint/suspicious/noExplicitAny: accessing mock
      const pty = ctx.ptyService as any;
      expect(pty.handleHookEvent).toHaveBeenCalledWith(
        "s-1",
        "permission_approved",
        { tool: "shell" },
      );
    });

    it("generic Notification forwards as notification event", async () => {
      const req = createMockReq(
        "POST",
        {
          hook_event_name: "Notification",
          notification_type: "idle",
          message: "Agent is idle",
        },
        { "x-parallax-session-id": "s-1" },
      );
      const res = createMockRes();

      await handleHookRoutes(req, res, "/api/coding-agents/hooks", ctx);

      // biome-ignore lint/suspicious/noExplicitAny: accessing mock
      const pty = ctx.ptyService as any;
      expect(pty.handleHookEvent).toHaveBeenCalledWith(
        "s-1",
        "notification",
        { type: "idle", message: "Agent is idle" },
      );
    });
  });

  // =========================================================================
  // Unknown events
  // =========================================================================

  describe("unknown events", () => {
    it("returns ignored for unrecognized hook_event_name", async () => {
      const req = createMockReq(
        "POST",
        { hook_event_name: "SomeFutureEvent" },
        { "x-parallax-session-id": "s-1" },
      );
      const res = createMockRes();

      await handleHookRoutes(req, res, "/api/coding-agents/hooks", ctx);

      expect(res._getJson().status).toBe("ignored");
      expect(res._getJson().reason).toBe("unknown_event");
    });
  });
});
