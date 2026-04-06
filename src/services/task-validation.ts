import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import {
  type IAgentRuntime,
  ModelType,
} from "@elizaos/core";
import type {
  TaskArtifactRecord,
  TaskThreadDetail,
} from "./task-registry.js";
import type {
  SwarmCoordinatorContext,
  TaskContext,
} from "./swarm-coordinator.js";
import { withTrajectoryContext } from "./trajectory-context.js";

type ValidationVerdict = "pass" | "revise" | "escalate";

interface TrajectoryListItem {
  id: string;
  status: string;
  llmCallCount: number;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

interface ValidationResponse {
  verdict: ValidationVerdict;
  summary: string;
  followUpPrompt?: string;
  checklist?: string[];
}

export interface TaskValidationResult {
  verdict: ValidationVerdict;
  summary: string;
  followUpPrompt?: string;
  reportPath: string;
  artifacts: Array<{
    artifactType: string;
    title: string;
    path?: string | null;
    uri?: string | null;
    mimeType?: string | null;
    metadata?: Record<string, unknown>;
  }>;
}

export interface ValidateTaskCompletionInput {
  sessionId: string;
  taskCtx: TaskContext;
  completionReasoning: string;
  completionSummary: string;
  turnOutput: string;
}

type TrajectoryLoggerLike = {
  listTrajectories?: (options?: {
    limit?: number;
    offset?: number;
    search?: string;
    startDate?: string;
  }) => Promise<{ trajectories?: TrajectoryListItem[] } | null | undefined>;
};

function extractJsonBlock(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return (fenceMatch?.[1] ?? trimmed).trim();
}

function parseValidationResponse(raw: string): ValidationResponse | null {
  try {
    const parsed = JSON.parse(extractJsonBlock(raw)) as Partial<ValidationResponse>;
    const verdict = parsed.verdict;
    const summary = parsed.summary?.trim();
    if (
      (verdict !== "pass" && verdict !== "revise" && verdict !== "escalate") ||
      !summary
    ) {
      return null;
    }
    const followUpPrompt = parsed.followUpPrompt?.trim();
    const checklist = Array.isArray(parsed.checklist)
      ? parsed.checklist.filter(
          (item): item is string => typeof item === "string" && item.trim().length > 0,
        )
      : undefined;
    return {
      verdict,
      summary,
      ...(followUpPrompt ? { followUpPrompt } : {}),
      ...(checklist && checklist.length > 0 ? { checklist } : {}),
    };
  } catch {
    return null;
  }
}

function getValidationRootDir(): string {
  const stateDir =
    process.env.MILADY_STATE_DIR?.trim() ||
    process.env.ELIZA_STATE_DIR?.trim() ||
    path.join(homedir(), ".milady");
  return path.join(stateDir, "task-validation");
}

function truncate(text: string, limit = 1200): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= limit) return compact;
  return `${compact.slice(0, limit)}...`;
}

function pngHeaderValid(buffer: Uint8Array): boolean {
  if (buffer.length < 8) return false;
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  return signature.every((value, index) => buffer[index] === value);
}

function resolveLoopbackApiBase(): string {
  const port =
    process.env.MILADY_API_PORT?.trim() ||
    process.env.ELIZA_PORT?.trim() ||
    "31337";
  return `http://127.0.0.1:${port}`;
}

function resolveAuthHeaders(): HeadersInit | undefined {
  const token =
    process.env.ELIZA_API_TOKEN?.trim() ||
    process.env.MILADY_API_TOKEN?.trim() ||
    process.env.MILADY_API_AUTH_TOKEN?.trim();
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

async function captureValidationScreenshot(
  threadId: string,
  sessionId: string,
): Promise<
  | {
      path: string;
      sizeBytes: number;
      verified: boolean;
    }
  | null
> {
  const response = await fetch(`${resolveLoopbackApiBase()}/api/dev/cursor-screenshot`, {
    headers: resolveAuthHeaders(),
  });
  if (!response.ok) {
    return null;
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0) {
    return null;
  }

  const dir = path.join(getValidationRootDir(), threadId);
  await mkdir(dir, { recursive: true });
  const screenshotPath = path.join(
    dir,
    `screenshot-${sessionId}-${Date.now()}.png`,
  );
  await writeFile(screenshotPath, bytes);

  return {
    path: screenshotPath,
    sizeBytes: bytes.length,
    verified: pngHeaderValid(bytes) && bytes.length > 1024,
  };
}

async function listRelevantTrajectories(
  runtime: IAgentRuntime,
  task: TaskContext,
  thread: TaskThreadDetail | null,
): Promise<TrajectoryListItem[]> {
  const logger = runtime.getService("trajectory_logger") as
    | TrajectoryLoggerLike
    | null
    | undefined;
  if (!logger?.listTrajectories) {
    return [];
  }

  const searchTerms = [
    task.sessionId,
    task.threadId,
    task.label,
    task.originalTask,
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));

  const seen = new Set<string>();
  const trajectories: TrajectoryListItem[] = [];
  for (const search of searchTerms) {
    const result = await logger.listTrajectories({
      limit: 10,
      search,
      ...(thread?.createdAt ? { startDate: thread.createdAt } : {}),
    });
    for (const item of result?.trajectories ?? []) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      const metadata = (item.metadata ?? {}) as Record<string, unknown>;
      const orchestrator = metadata.orchestrator as Record<string, unknown> | undefined;
      const sessionMatches =
        orchestrator?.sessionId === task.sessionId ||
        metadata.sessionId === task.sessionId;
      const labelMatches =
        orchestrator?.taskLabel === task.label || metadata.taskLabel === task.label;
      if (!sessionMatches && !labelMatches && search !== task.sessionId) {
        continue;
      }
      trajectories.push(item);
      if (trajectories.length >= 3) {
        return trajectories;
      }
    }
  }

  return trajectories;
}

function buildValidationPrompt(
  task: TaskContext,
  thread: TaskThreadDetail | null,
  completionReasoning: string,
  completionSummary: string,
  turnOutput: string,
  trajectories: TrajectoryListItem[],
  screenshot: Awaited<ReturnType<typeof captureValidationScreenshot>>,
): string {
  const acceptanceCriteria =
    thread?.acceptanceCriteria?.length
      ? thread.acceptanceCriteria.map((item) => `- ${item}`).join("\n")
      : "- Complete the user's request\n- Verify the result with available evidence\n- Do not claim success if important work is still missing";
  const trajectoryBlock =
    trajectories.length > 0
      ? trajectories
          .map(
            (item) =>
              `- ${item.id} | status=${item.status} | llmCalls=${item.llmCallCount} | createdAt=${item.createdAt}`,
          )
          .join("\n")
      : "- none";
  const transcriptPreview =
    thread?.transcripts?.slice(-8).map((entry) => {
      const content = truncate(entry.content, 220);
      return `- [${entry.direction}] ${content}`;
    }).join("\n") ?? "- none";
  const artifactBlock =
    thread?.artifacts?.slice(-8).map((artifact: TaskArtifactRecord) => {
      const locator = artifact.path ?? artifact.uri ?? "inline";
      return `- ${artifact.artifactType}: ${artifact.title} (${locator})`;
    }).join("\n") ?? "- none";

  return [
    "You are validating whether an orchestrated task is actually finished.",
    "Return strict JSON only with this shape:",
    '{"verdict":"pass|revise|escalate","summary":"short summary","followUpPrompt":"only if verdict=revise","checklist":["optional evidence notes"]}',
    "",
    `Task title: ${task.label}`,
    `Original request: ${task.originalTask}`,
    `Completion reasoning: ${completionReasoning || "none"}`,
    `Completion summary: ${completionSummary || "none"}`,
    "",
    "Acceptance criteria:",
    acceptanceCriteria,
    "",
    "Latest turn output excerpt:",
    truncate(turnOutput || completionSummary || completionReasoning || "none", 2400),
    "",
    "Recent transcript excerpt:",
    transcriptPreview,
    "",
    "Existing task artifacts:",
    artifactBlock,
    "",
    "Related trajectories:",
    trajectoryBlock,
    "",
    "Screenshot evidence:",
    screenshot
      ? `- captured=${screenshot.verified} path=${screenshot.path} sizeBytes=${screenshot.sizeBytes}`
      : "- unavailable",
    "",
    "Rules:",
    "- Pass only if the task appears complete and the available evidence supports that claim.",
    "- Revise if the agent should keep working. In that case, provide a direct follow-up prompt.",
    "- Escalate if the task cannot be validated from available evidence and needs human review.",
    "- Be skeptical. Missing tests or missing verification should usually mean revise or escalate, not pass.",
  ].join("\n");
}

async function persistValidationReport(
  threadId: string,
  sessionId: string,
  report: Record<string, unknown>,
): Promise<string> {
  const dir = path.join(getValidationRootDir(), threadId);
  await mkdir(dir, { recursive: true });
  const reportPath = path.join(
    dir,
    `validation-${sessionId}-${Date.now()}.json`,
  );
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  return reportPath;
}

export async function validateTaskCompletion(
  ctx: SwarmCoordinatorContext,
  input: ValidateTaskCompletionInput,
): Promise<TaskValidationResult> {
  const { sessionId, taskCtx, completionReasoning, completionSummary, turnOutput } =
    input;
  const thread = await ctx.taskRegistry.getThread(taskCtx.threadId);
  const trajectories = await listRelevantTrajectories(ctx.runtime, taskCtx, thread);
  const screenshot = await captureValidationScreenshot(taskCtx.threadId, sessionId).catch(
    () => null,
  );

  const prompt = buildValidationPrompt(
    taskCtx,
    thread,
    completionReasoning,
    completionSummary,
    turnOutput,
    trajectories,
    screenshot,
  );
  const rawValidation = await withTrajectoryContext(
    ctx.runtime,
    {
      source: "orchestrator",
      decisionType: "task-validation",
      sessionId,
      taskLabel: taskCtx.label,
      repo: taskCtx.repo,
      workdir: taskCtx.workdir,
      originalTask: taskCtx.originalTask,
    },
    () => ctx.runtime.useModel(ModelType.TEXT_SMALL, { prompt }),
  );

  const parsed = parseValidationResponse(rawValidation);
  const verdict: ValidationResponse =
    parsed ?? {
      verdict: "escalate",
      summary:
        "Validation model returned an invalid response, so this task needs human review.",
    };

  const report = {
    version: 1,
    createdAt: new Date().toISOString(),
    threadId: taskCtx.threadId,
    sessionId,
    label: taskCtx.label,
    originalTask: taskCtx.originalTask,
    completionReasoning,
    completionSummary,
    verdict: verdict.verdict,
    summary: verdict.summary,
    followUpPrompt: verdict.followUpPrompt ?? null,
    acceptanceCriteria: thread?.acceptanceCriteria ?? [],
    evidence: {
      transcriptCount: thread?.transcripts.length ?? 0,
      decisionCount: thread?.decisions.length ?? 0,
      eventCount: thread?.events.length ?? 0,
      artifactCount: thread?.artifacts.length ?? 0,
      screenshot: screenshot
        ? {
            path: screenshot.path,
            sizeBytes: screenshot.sizeBytes,
            verified: screenshot.verified,
          }
        : null,
      trajectories: trajectories.map((item) => ({
        id: item.id,
        status: item.status,
        llmCallCount: item.llmCallCount,
        createdAt: item.createdAt,
      })),
      checklist: verdict.checklist ?? [],
      turnOutputExcerpt: truncate(turnOutput || completionSummary || completionReasoning || ""),
    },
  };
  const reportPath = await persistValidationReport(taskCtx.threadId, sessionId, report);

  const artifacts: TaskValidationResult["artifacts"] = [
    {
      artifactType: "validation_report",
      title: `Validation report for ${taskCtx.label}`,
      path: reportPath,
      mimeType: "application/json",
      metadata: {
        verdict: verdict.verdict,
        summary: verdict.summary,
      },
    },
    ...trajectories.map((item) => ({
      artifactType: "trajectory_link",
      title: `Trajectory ${item.id}`,
      uri: `/api/trajectories/${encodeURIComponent(item.id)}`,
      metadata: {
        trajectoryId: item.id,
        status: item.status,
        llmCallCount: item.llmCallCount,
      },
    })),
  ];

  if (screenshot) {
    artifacts.push({
      artifactType: "screenshot",
      title: `Validation screenshot for ${taskCtx.label}`,
      path: screenshot.path,
      mimeType: "image/png",
      metadata: {
        verified: screenshot.verified,
        sizeBytes: screenshot.sizeBytes,
      },
    });
  }

  return {
    verdict: verdict.verdict,
    summary: verdict.summary,
    ...(verdict.followUpPrompt ? { followUpPrompt: verdict.followUpPrompt } : {}),
    reportPath,
    artifacts,
  };
}
