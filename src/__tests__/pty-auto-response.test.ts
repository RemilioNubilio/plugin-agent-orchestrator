import { describe, expect, it, jest } from "bun:test";
import type { BunCompatiblePTYManager } from "pty-manager";
import { pushDefaultRules } from "../services/pty-auto-response.js";

function createManager() {
  return {
    addAutoResponseRule: jest.fn(async () => undefined),
  } as unknown as BunCompatiblePTYManager;
}

describe("pushDefaultRules", () => {
  it("adds a persistent Codex trust retry rule ahead of adapter auto-responses", async () => {
    const manager = createManager();

    await pushDefaultRules(
      {
        manager,
        usingBunWorker: true,
        runtime: {
          getSetting: () => undefined,
        } as never,
        log: () => undefined,
      },
      "session-codex-1",
      "codex",
    );

    expect(manager.addAutoResponseRule).toHaveBeenCalledTimes(1);
    const [, rule] = (manager.addAutoResponseRule as ReturnType<typeof jest.fn>)
      .mock.calls[0];
    expect(rule.type).toBe("permission");
    expect(rule.keys).toEqual(["enter"]);
    expect(rule.once).toBeUndefined();
    expect(
      rule.pattern.test(
        "This folder comes with higher risk of prompt injection. 1. Yes, continue 2. No, quit",
      ),
    ).toBe(true);
  });

  it("does not add Codex trust retry rules for other agent types", async () => {
    const manager = createManager();

    await pushDefaultRules(
      {
        manager,
        usingBunWorker: true,
        runtime: {
          getSetting: () => undefined,
        } as never,
        log: () => undefined,
      },
      "session-claude-1",
      "claude",
    );

    expect(manager.addAutoResponseRule).not.toHaveBeenCalled();
  });
});
