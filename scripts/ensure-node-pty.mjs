#!/usr/bin/env node
/**
 * Ensures node-pty's native addon is compiled.
 *
 * `bun install` does NOT run node-gyp for native modules, so we check for
 * the compiled `.node` binary and rebuild if it's missing.
 */
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// Check both direct and nested (inside pty-manager) locations
const candidates = [
  resolve(root, "node_modules", "node-pty"),
  resolve(root, "node_modules", "pty-manager", "node_modules", "node-pty"),
];

for (const ptyDir of candidates) {
  if (!existsSync(ptyDir)) continue;

  const binaryPath = resolve(ptyDir, "build", "Release", "pty.node");
  if (existsSync(binaryPath)) {
    console.log(`[ensure-node-pty] Native addon already built at ${ptyDir}`);
    continue;
  }

  console.log(`[ensure-node-pty] Building native addon at ${ptyDir}...`);
  try {
    execSync("node-gyp rebuild", {
      cwd: ptyDir,
      stdio: "inherit",
      timeout: 120_000,
    });
    console.log("[ensure-node-pty] Build complete.");
  } catch (err) {
    console.error(
      "[ensure-node-pty] Failed to build node-pty native addon.",
      "PTY-based coding agents will not work.",
      err.message,
    );
  }
}
