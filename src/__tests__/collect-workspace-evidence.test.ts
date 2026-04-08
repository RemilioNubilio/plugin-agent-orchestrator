/**
 * collectWorkspaceEvidence tests.
 *
 * The validator LLM was failing to pass tasks because Codex emits
 * `apply_patch` previews wrapped in TUI box-drawing that the model
 * couldn't reliably parse as evidence files exist. `collectWorkspaceEvidence`
 * reads the actual filesystem so the validator has ground truth
 * regardless of which coding CLI produced the work.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const { collectWorkspaceEvidence } = await import(
  "../services/task-validation.js"
);

describe("collectWorkspaceEvidence", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(path.join(tmpdir(), "workspace-evidence-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  it("returns an empty evidence record when workdir is undefined", async () => {
    const evidence = await collectWorkspaceEvidence(undefined);
    expect(evidence.workdir).toBe("");
    expect(evidence.files).toEqual([]);
    expect(evidence.fileCount).toBe(0);
    expect(evidence.isGitRepo).toBe(false);
    expect(evidence.notes).toContain("no workdir supplied");
  });

  it("lists files in a flat directory", async () => {
    await writeFile(path.join(workdir, "index.html"), "<!doctype html>");
    await writeFile(path.join(workdir, "script.js"), "console.log('hi')");
    await writeFile(path.join(workdir, "styles.css"), "body { margin: 0 }");

    const evidence = await collectWorkspaceEvidence(workdir);

    expect(evidence.workdir).toBe(workdir);
    expect(evidence.fileCount).toBe(3);
    expect(evidence.files).toEqual(["index.html", "script.js", "styles.css"]);
    expect(evidence.isGitRepo).toBe(false);
    expect(evidence.notes).toEqual([]);
  });

  it("walks nested subdirectories", async () => {
    await mkdir(path.join(workdir, "src/components"), { recursive: true });
    await writeFile(path.join(workdir, "package.json"), "{}");
    await writeFile(path.join(workdir, "src/index.ts"), "");
    await writeFile(path.join(workdir, "src/components/Button.tsx"), "");

    const evidence = await collectWorkspaceEvidence(workdir);

    expect(evidence.fileCount).toBe(3);
    expect(evidence.files).toEqual([
      "package.json",
      "src/components/Button.tsx",
      "src/index.ts",
    ]);
  });

  it("skips node_modules, .git, dist, build, .next, .turbo, __pycache__", async () => {
    // Create a realistic mess of dep/build artifacts.
    const skipDirs = [
      "node_modules",
      ".git",
      "dist",
      "build",
      ".next",
      ".turbo",
      "__pycache__",
    ];
    for (const dir of skipDirs) {
      await mkdir(path.join(workdir, dir), { recursive: true });
      await writeFile(path.join(workdir, dir, "junk.js"), "");
    }
    await writeFile(path.join(workdir, "real-file.ts"), "");

    const evidence = await collectWorkspaceEvidence(workdir);

    // Only the real file should be listed
    expect(evidence.files).toEqual(["real-file.ts"]);
    expect(evidence.fileCount).toBe(1);
  });

  it("caps the file listing at the limit while still counting total files", async () => {
    // Create 250 files (above the 200 limit).
    await Promise.all(
      Array.from({ length: 250 }, (_, i) =>
        writeFile(
          path.join(workdir, `file-${String(i).padStart(3, "0")}.txt`),
          "",
        ),
      ),
    );

    const evidence = await collectWorkspaceEvidence(workdir);

    expect(evidence.fileCount).toBe(250);
    expect(evidence.files.length).toBe(200);
    // Sorted, so first file is file-000.txt
    expect(evidence.files[0]).toBe("file-000.txt");
  });

  it("captures git status and diff for a git repo with changes", async () => {
    // Initialize a git repo with committed content and then stage changes.
    await execFileAsync("git", ["init", "-q", "--initial-branch=main"], {
      cwd: workdir,
    });
    await execFileAsync("git", ["config", "user.email", "t@t.test"], {
      cwd: workdir,
    });
    await execFileAsync("git", ["config", "user.name", "t"], { cwd: workdir });

    await writeFile(path.join(workdir, "existing.ts"), "export const x = 1;\n");
    await execFileAsync("git", ["add", "."], { cwd: workdir });
    await execFileAsync("git", ["commit", "-q", "-m", "initial"], {
      cwd: workdir,
    });

    // Now make the kinds of changes an agent would make.
    await writeFile(path.join(workdir, "existing.ts"), "export const x = 2;\n");
    await writeFile(path.join(workdir, "new-file.ts"), "export const y = 3;\n");

    const evidence = await collectWorkspaceEvidence(workdir);

    expect(evidence.isGitRepo).toBe(true);
    // Modified file and new untracked file should both show in status
    expect(evidence.gitStatus).toMatch(/existing\.ts/);
    expect(evidence.gitStatus).toMatch(/new-file\.ts/);
    // Diff stat should mention the modified file
    expect(evidence.gitDiffStat).toMatch(/existing\.ts/);
  });

  it("does not throw when workdir does not exist — records the error in notes", async () => {
    const bogus = path.join(workdir, "this-does-not-exist");
    const evidence = await collectWorkspaceEvidence(bogus);

    expect(evidence.files).toEqual([]);
    expect(evidence.notes.length).toBeGreaterThan(0);
    expect(evidence.notes[0]).toMatch(/not readable|not a directory/);
  });

  it("does not throw when workdir is a file instead of a directory", async () => {
    const filePath = path.join(workdir, "oops.txt");
    await writeFile(filePath, "this is a file, not a dir");

    const evidence = await collectWorkspaceEvidence(filePath);

    expect(evidence.files).toEqual([]);
    expect(evidence.notes.some((n) => /not a directory/.test(n))).toBe(true);
  });

  it("resolves a relative path to an absolute one in the returned workdir", async () => {
    // Tilde handling is covered separately via the workdir setup.
    // We verify resolution by passing a relative path and checking that
    // the returned `workdir` is absolute. We can't safely pass "~" here
    // because walking the real home directory is unbounded.
    await writeFile(path.join(workdir, "marker.txt"), "ok");
    const relative = path.relative(process.cwd(), workdir);
    const evidence = await collectWorkspaceEvidence(relative);
    expect(path.isAbsolute(evidence.workdir)).toBe(true);
    expect(evidence.files).toContain("marker.txt");
  });

  it("stops walking once the file ceiling is reached and notes truncation", async () => {
    // Create more files than the walk ceiling so we can verify it
    // short-circuits rather than enumerating everything.
    const { WORKSPACE_EVIDENCE_MAX_WALK } = (await import(
      "../services/task-validation.js"
    )) as { WORKSPACE_EVIDENCE_MAX_WALK?: number };
    const ceiling = WORKSPACE_EVIDENCE_MAX_WALK ?? 2_000;
    const toCreate = ceiling + 500;

    await Promise.all(
      Array.from({ length: toCreate }, (_, i) =>
        writeFile(path.join(workdir, `f-${i}.txt`), ""),
      ),
    );

    const evidence = await collectWorkspaceEvidence(workdir);

    // We should NOT have counted all files — the ceiling halted us.
    expect(evidence.fileCount).toBeLessThanOrEqual(ceiling);
    // Notes should surface the truncation.
    expect(
      evidence.notes.some((n) => /walk hit.*ceiling|truncated/.test(n)),
    ).toBe(true);
  });
});
