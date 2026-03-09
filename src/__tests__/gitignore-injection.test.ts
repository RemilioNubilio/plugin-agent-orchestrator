import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Tests for the orchestrator .gitignore injection logic.
 *
 * Since ensureOrchestratorGitignore is a private method on PTYService,
 * we extract and test the core logic directly.
 */

const GITIGNORE_MARKER =
  "# orchestrator-injected (do not commit agent config/memory files)";

const ORCHESTRATOR_ENTRIES = [
  "",
  GITIGNORE_MARKER,
  "CLAUDE.md",
  ".claude/",
  "GEMINI.md",
  ".gemini/",
  ".aider*",
];

/** Replicate the core logic of ensureOrchestratorGitignore for testing. */
async function ensureOrchestratorGitignore(workdir: string): Promise<void> {
  const gitignorePath = join(workdir, ".gitignore");

  let existing = "";
  try {
    existing = await readFile(gitignorePath, "utf-8");
  } catch {
    // No .gitignore yet
  }

  if (existing.includes(GITIGNORE_MARKER)) return;

  await writeFile(
    gitignorePath,
    existing + ORCHESTRATOR_ENTRIES.join("\n") + "\n",
    "utf-8",
  );
}

describe("gitignore injection", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "gitignore-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("creates .gitignore when none exists", async () => {
    await ensureOrchestratorGitignore(tempDir);

    const content = await readFile(join(tempDir, ".gitignore"), "utf-8");
    expect(content).toContain(GITIGNORE_MARKER);
    expect(content).toContain("CLAUDE.md");
    expect(content).toContain(".claude/");
    expect(content).toContain("GEMINI.md");
    expect(content).toContain(".gemini/");
    expect(content).toContain(".aider*");
  });

  it("appends to existing .gitignore", async () => {
    const existingContent = "node_modules/\n.env\n";
    await writeFile(join(tempDir, ".gitignore"), existingContent, "utf-8");

    await ensureOrchestratorGitignore(tempDir);

    const content = await readFile(join(tempDir, ".gitignore"), "utf-8");
    // Existing content preserved
    expect(content).toStartWith("node_modules/\n.env\n");
    // New entries appended
    expect(content).toContain(GITIGNORE_MARKER);
    expect(content).toContain("CLAUDE.md");
  });

  it("is idempotent — does not duplicate entries", async () => {
    await ensureOrchestratorGitignore(tempDir);
    await ensureOrchestratorGitignore(tempDir);

    const content = await readFile(join(tempDir, ".gitignore"), "utf-8");
    const markerCount = content.split(GITIGNORE_MARKER).length - 1;
    expect(markerCount).toBe(1);
  });

  it("skips if marker already present from manual edit", async () => {
    const manualContent = `node_modules/\n${GITIGNORE_MARKER}\nCLAUDE.md\n`;
    await writeFile(join(tempDir, ".gitignore"), manualContent, "utf-8");

    await ensureOrchestratorGitignore(tempDir);

    const content = await readFile(join(tempDir, ".gitignore"), "utf-8");
    expect(content).toBe(manualContent); // Unchanged
  });
});
