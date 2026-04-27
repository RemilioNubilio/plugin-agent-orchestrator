/**
 * Tests for `resolveDefaultBranch` — the helper that asks `git ls-remote
 * --symref <repo> HEAD` what the default branch is so the orchestrator
 * stops hardcoding "main" and failing to clone repos whose default is
 * "alpha" / "develop" / "master".
 */

import { describe, expect, it, vi } from "vitest";

const mockExecFile = vi.hoisted(() =>
  vi.fn(
    (
      _file: string,
      _args: ReadonlyArray<string>,
      _opts: unknown,
      cb: (
        err: Error | null,
        stdout: string,
        stderr: string,
      ) => void,
    ) => {
      cb(null, "", "");
    },
  ),
);

vi.mock("node:child_process", () => ({ execFile: mockExecFile }));

const { resolveDefaultBranch } = await import("../services/workspace-service");

describe("resolveDefaultBranch", () => {
  it("parses the symref response and returns the default branch", async () => {
    mockExecFile.mockImplementationOnce((_file, _args, _opts, cb) => {
      cb(
        null,
        "ref: refs/heads/alpha\tHEAD\n0000000000000000000000000000000000000000\tHEAD\n",
        "",
      );
    });
    expect(
      await resolveDefaultBranch("https://github.com/elizaos-plugins/plugin-discord.git"),
    ).toBe("alpha");
  });

  it("handles repos that default to main", async () => {
    mockExecFile.mockImplementationOnce((_file, _args, _opts, cb) => {
      cb(
        null,
        "ref: refs/heads/main\tHEAD\n0000000000000000000000000000000000000000\tHEAD\n",
        "",
      );
    });
    expect(
      await resolveDefaultBranch("https://github.com/elizaOS/eliza.git"),
    ).toBe("main");
  });

  it("falls back to main when ls-remote fails (network error, private repo, etc.)", async () => {
    mockExecFile.mockImplementationOnce((_file, _args, _opts, cb) => {
      cb(new Error("fatal: could not read Username for ..."), "", "");
    });
    expect(await resolveDefaultBranch("https://example.invalid/repo.git")).toBe(
      "main",
    );
  });

  it("falls back to main when the response is unexpected", async () => {
    mockExecFile.mockImplementationOnce((_file, _args, _opts, cb) => {
      cb(null, "garbage output with no symref line\n", "");
    });
    expect(await resolveDefaultBranch("https://example.com/repo.git")).toBe(
      "main",
    );
  });
});
