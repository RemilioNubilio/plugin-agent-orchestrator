import { describe, expect, it, jest } from "bun:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  assistTaskAgentBrowserLogin,
  launchTaskAgentAuthFlow,
  probeTaskAgentAuth,
} from "../services/task-agent-auth.js";

class FakeChildProcess extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;

  kill() {
    this.killed = true;
    this.emit("exit", 0, null);
    return true;
  }
}

describe("task-agent-auth", () => {
  it("probes Claude auth via the live CLI status command", async () => {
    const status = await probeTaskAgentAuth("claude", {
      deps: {
        execFile: jest.fn(async () => ({
          stdout: JSON.stringify({
            loggedIn: true,
            authMethod: "claude.ai",
          }),
          stderr: "",
        })),
      },
    });

    expect(status).toEqual({
      status: "authenticated",
      method: "claude.ai",
    });
  });

  it("launches the Claude auth helper with the correct command and captures the login URL", async () => {
    const child = new FakeChildProcess();
    const spawn = jest.fn(() => {
      queueMicrotask(() => {
        child.stdout.write(
          "Opening browser to sign in…\nIf the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true\n",
        );
      });
      return child as never;
    });

    const launched = await launchTaskAgentAuthFlow("claude", {
      deps: { spawn },
    });

    expect(spawn).toHaveBeenCalledWith(
      "claude",
      ["auth", "login", "--claudeai"],
      expect.objectContaining({
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
    expect(launched.result.launched).toBe(true);
    expect(launched.result.url).toBe(
      "https://claude.com/cai/oauth/authorize?code=true",
    );
    launched.handle?.stop();
  });

  it("opens the auth URL in the browser workspace and clicks a trusted first-party button", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tab: { id: "btab-auth-1" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ value: { waitedMs: 10_000 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tab: { id: "btab-auth-1" } }),
      });

    const assisted = await assistTaskAgentBrowserLogin(
      "claude",
      "http://127.0.0.1:4444/login",
      {
        runtime: {
          getSetting: () => "31337",
        } as never,
        deps: {
          fetch: fetchMock as never,
        },
      },
    );

    expect(assisted).toEqual({
      opened: true,
      clicked: true,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:31337/api/browser-workspace/command",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual(
      expect.objectContaining({
        subaction: "click",
        id: "btab-auth-1",
      }),
    );
  });

  it("supports configured auth hosts, selectors, and browser API base URL overrides", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tab: { id: "btab-auth-2" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ value: { waitedMs: 750 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tab: { id: "btab-auth-2" } }),
      });

    const assisted = await assistTaskAgentBrowserLogin(
      "claude",
      "https://auth.example/login",
      {
        env: {
          MILADY_TASK_AGENT_AUTH_API_BASE_URL: "https://agent.example/base/",
          MILADY_TASK_AGENT_AUTH_TRUSTED_HOSTS: "auth.example",
          MILADY_TASK_AGENT_AUTH_SELECTORS_CLAUDE:
            'role=button[name="Approve access"]',
        } as NodeJS.ProcessEnv,
        deps: {
          fetch: fetchMock as never,
        },
      },
    );

    expect(assisted).toEqual({
      opened: true,
      clicked: true,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://agent.example/base/api/browser-workspace/command",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual(
      expect.objectContaining({
        subaction: "click",
        id: "btab-auth-2",
        selector: 'role=button[name="Approve access"]',
      }),
    );
  });
});
