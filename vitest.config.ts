import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "src/__tests__/task-agent-live.e2e.test.ts",
      "src/__tests__/task-agent-frameworks.test.ts",
      "src/__tests__/skill-manifest.test.ts",
      "src/__tests__/skill-recommender.test.ts",
      "src/__tests__/skill-callback.test.ts",
      "src/__tests__/split-multi-intent.test.ts",
      "src/__tests__/pr39-followups.test.ts",
      "src/__tests__/task-agent-auth.test.ts",
      "src/__tests__/pty-spawn-path-fallback.test.ts",
    ],
  },
});
