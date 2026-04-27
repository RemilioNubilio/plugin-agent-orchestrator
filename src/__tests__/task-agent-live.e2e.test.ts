/**
 * Opt-in live smoke tests for real Claude Code and Codex sessions.
 *
 * These are skipped by default. Run with:
 *   ORCHESTRATOR_LIVE=1 bun test src/__tests__/task-agent-live.e2e.test.ts
 */

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";

const RUN_LIVE = process.env.ORCHESTRATOR_LIVE === "1";
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..", "..");
const runNodeTsxScript = path.join(
  repoRoot,
  "packages",
  "app-core",
  "scripts",
  "run-node-tsx.mjs",
);
const liveSmokeScript = path.join(
  repoRoot,
  "packages",
  "app-core",
  "test",
  "scripts",
  "task-agent-live-smoke.ts",
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function codexHasStoredAuth(): boolean {
  if (process.env.OPENAI_API_KEY?.trim()) {
    return true;
  }
  try {
    const authPath = path.join(os.homedir(), ".codex", "auth.json");
    const raw = fs.readFileSync(authPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return false;
    const apiKey = parsed.OPENAI_API_KEY;
    if (typeof apiKey === "string" && apiKey.trim().length > 0) return true;
    const tokens = parsed.tokens;
    return (
      parsed.auth_mode === "chatgpt" &&
      isRecord(tokens) &&
      typeof tokens.access_token === "string" &&
      tokens.access_token.trim().length > 0 &&
      typeof tokens.refresh_token === "string" &&
      tokens.refresh_token.trim().length > 0
    );
  } catch {
    return false;
  }
}

function claudeHasDeterministicAuth(): boolean {
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    return true;
  }
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim()) {
    return true;
  }
  return (
    fs.existsSync(path.join(os.homedir(), ".claude", ".credentials.json")) ||
    fs.existsSync(path.join(os.homedir(), ".claude.json"))
  );
}

function isFrameworkAuthenticated(framework: Framework): boolean {
  if (framework === "claude" && !claudeHasDeterministicAuth()) {
    return false;
  }
  if (
    framework === "claude" &&
    (process.env.ANTHROPIC_API_KEY?.trim() ||
      process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim())
  ) {
    return true;
  }

  try {
    if (framework === "claude") {
      const output = execFileSync("claude", ["auth", "status"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 5_000,
      });
      return /"loggedIn"\s*:\s*true|\blogged in\b/i.test(output);
    }

    if (codexHasStoredAuth()) {
      return true;
    }

    const output = execFileSync("codex", ["login", "status"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5_000,
    });
    return /\blogged in\b/i.test(output);
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "";
    return (
      !/\bnot logged in\b|\bno stored credentials\b|\bunauthenticated\b/i.test(
        detail,
      ) &&
      framework === "codex" &&
      codexHasStoredAuth()
    );
  }
}

const claudeLiveDescribe =
  RUN_LIVE && isFrameworkAuthenticated("claude") ? describe : describe.skip;
const codexLiveDescribe =
  RUN_LIVE && isFrameworkAuthenticated("codex") ? describe : describe.skip;

async function runLiveSmokeScript(
  framework: "claude" | "codex",
  mode: "sequential" | "web" | "counter-app",
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const bunBinary = process.execPath;
    const child = spawn(
      bunBinary,
      [
        runNodeTsxScript,
        liveSmokeScript,
        "--framework",
        framework,
        "--mode",
        mode,
      ],
      {
        cwd: repoRoot,
        env: { ...process.env, ORCHESTRATOR_LIVE: "1", PWD: repoRoot },
        stdio: "inherit",
      },
    );

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(
          new Error(
            `${framework} ${mode} live smoke exited via signal ${signal}`,
          ),
        );
        return;
      }
      try {
        assert.equal(
          code,
          0,
          `${framework} ${mode} live smoke exited with code ${code ?? -1}`,
        );
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
}

claudeLiveDescribe("task-agent live smoke (claude)", () => {
  it(
    "keeps a Claude Code session alive across sequential tracked tasks",
    async () => {
      await runLiveSmokeScript("claude", "sequential");
    },
    12 * 60 * 1000,
  );

  it(
    "has Claude Code research a page and serve a generated webpage",
    async () => {
      await runLiveSmokeScript("claude", "web");
    },
    12 * 60 * 1000,
  );

  it(
    "has Claude Code create a counter app and load it through APP",
    async () => {
      await runLiveSmokeScript("claude", "counter-app");
    },
    25 * 60 * 1000,
  );
});

codexLiveDescribe("task-agent live smoke (codex)", () => {
  it(
    "keeps a Codex session alive across sequential tracked tasks",
    async () => {
      await runLiveSmokeScript("codex", "sequential");
    },
    12 * 60 * 1000,
  );

  it(
    "has Codex research a page and serve a generated webpage",
    async () => {
      await runLiveSmokeScript("codex", "web");
    },
    12 * 60 * 1000,
  );

  it(
    "has Codex create a counter app and load it through APP",
    async () => {
      await runLiveSmokeScript("codex", "counter-app");
    },
    25 * 60 * 1000,
  );
});
