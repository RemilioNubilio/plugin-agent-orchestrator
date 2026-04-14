import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type {
  Action,
  ActionResult,
  Content,
  HandlerCallback,
  HandlerOptions,
  IAgentRuntime,
  Memory,
  Service,
  State,
  Task,
  UUID,
} from "@elizaos/core";
import { startCodingTaskAction } from "./actions/start-coding-task.js";

type JsonPrimitive = string | number | boolean | null;
type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue | undefined };

export type TaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "paused"
  | "cancelled";

export type TaskUserStatus = "open" | "done";

export interface TaskStep {
  id: string;
  description: string;
  status: TaskStatus;
  output?: string;
  metadata?: Record<string, JsonValue>;
}

export interface TaskResult {
  success: boolean;
  summary: string;
  filesModified: string[];
  filesCreated: string[];
  error?: string;
  metadata?: Record<string, JsonValue>;
}

export interface OrchestratedTask {
  id: string;
  name: string;
  description: string;
  roomId?: string;
  providerId: string;
  requiredCapabilities?: string[];
  metadata: Record<string, JsonValue>;
}

export interface ProviderTaskExecutionContext {
  runtime: IAgentRuntime;
  taskId: string;
  getWorkingDirectory: () => string;
  appendOutput: (text: string) => Promise<void>;
  updateProgress: (progress: number) => Promise<void>;
  isCancelled: () => boolean;
  isPaused: () => boolean;
  waitIfPaused: () => Promise<void>;
}

export interface AgentProvider {
  id: string;
  label: string;
  executeTask: (
    task: OrchestratedTask,
    ctx: ProviderTaskExecutionContext,
  ) => Promise<TaskResult>;
}

interface LegacyTaskMetadata {
  status: TaskStatus;
  progress: number;
  output: string[];
  steps: TaskStep[];
  result?: TaskResult;
  userStatus: TaskUserStatus;
  userStatusUpdatedAt?: number;
  filesModified: string[];
  filesCreated: string[];
  workingDirectory: string;
  subAgentType?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  providerId: string;
  providerLabel: string;
  requiredCapabilities?: string[];
}

type LegacyTask = Omit<Task, "metadata"> & {
  metadata: LegacyTaskMetadata;
};

type LegacyTaskEvent =
  | "task:created"
  | "task:started"
  | "task:progress"
  | "task:output"
  | "task:completed"
  | "task:failed"
  | "task:cancelled"
  | "task:paused"
  | "task:resumed";

type LegacyTaskAction = Action & {
  handler: (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: HandlerOptions,
    callback?: HandlerCallback,
  ) => Promise<ActionResult | undefined>;
};

type LegacyConfig = {
  providers: AgentProvider[];
  defaultProviderId?: string;
  getWorkingDirectory?: () => string;
  activeProviderEnvVar?: string;
};

type ExecutionState = {
  cancelled: boolean;
  paused: boolean;
  waitingResolvers: Array<() => void>;
};

const DEFAULT_ACTIVE_PROVIDER_ENV = "ELIZA_CODE_ACTIVE_SUB_AGENT";

let legacyConfig: LegacyConfig = {
  providers: [],
  defaultProviderId: undefined,
  getWorkingDirectory: () => process.cwd(),
  activeProviderEnvVar: DEFAULT_ACTIVE_PROVIDER_ENV,
};

function getLegacyConfig(): LegacyConfig {
  return legacyConfig;
}

function resolveOptions(
  options?: HandlerOptions,
): Record<string, unknown> | undefined {
  const raw = options as unknown as
    | Record<string, unknown>
    | { parameters?: Record<string, unknown> }
    | undefined;
  if (!raw) return undefined;
  if (
    "parameters" in raw &&
    raw.parameters &&
    typeof raw.parameters === "object"
  ) {
    return raw.parameters as Record<string, unknown>;
  }
  return raw;
}

function getMessageText(message: Memory): string {
  const content = message.content as Record<string, unknown> | undefined;
  const text = content?.text;
  return typeof text === "string" ? text : "";
}

function shouldCreateTaskFromText(text: string): boolean {
  return (
    /\.(html|css|js|jsx|ts|tsx|py|rs|md)\b/i.test(text) ||
    /\b(build|create|scaffold|project|app|game|feature|workflow)\b/i.test(text)
  );
}

function normalizeProviderId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveConfiguredProvider(
  requestedProviderId?: string,
): AgentProvider {
  const config = getLegacyConfig();
  const envProviderId = normalizeProviderId(
    process.env[config.activeProviderEnvVar ?? DEFAULT_ACTIVE_PROVIDER_ENV],
  );
  const providerId =
    normalizeProviderId(requestedProviderId) ??
    envProviderId ??
    normalizeProviderId(config.defaultProviderId) ??
    config.providers[0]?.id;
  const provider = config.providers.find((entry) => entry.id === providerId);
  if (!provider) {
    throw new Error(
      providerId
        ? `Unknown provider: ${providerId}`
        : "No agent orchestrator providers are configured",
    );
  }
  return provider;
}

function summarizeTaskSearch(task: LegacyTask): string {
  return `- ${task.name} [${task.metadata.status}] (${task.metadata.progress}%)`;
}

async function ensureCodeTaskService(
  runtime: IAgentRuntime,
): Promise<AgentOrchestratorService> {
  const existing = runtime.getService("CODE_TASK") as
    | AgentOrchestratorService
    | null;
  if (existing) {
    return existing;
  }
  return AgentOrchestratorService.start(runtime);
}

export function configureAgentOrchestratorPlugin(config: LegacyConfig): void {
  legacyConfig = {
    providers: config.providers,
    defaultProviderId: config.defaultProviderId,
    getWorkingDirectory: config.getWorkingDirectory ?? (() => process.cwd()),
    activeProviderEnvVar:
      config.activeProviderEnvVar ?? DEFAULT_ACTIVE_PROVIDER_ENV,
  };
}

export function createSubAgentProvider(
  runtime: IAgentRuntime,
  id: string,
  agentType: string,
  label: string,
): AgentProvider {
  return {
    id,
    label,
    async executeTask(task, ctx): Promise<TaskResult> {
      const roomId = (task.roomId ?? runtime.agentId) as UUID;
      const callbackLines: string[] = [];
      const syntheticMemory = {
        id: randomUUID() as UUID,
        roomId,
        entityId: runtime.agentId,
        agentId: runtime.agentId,
        createdAt: Date.now(),
        content: {
          text: task.description,
          task: task.description,
          agentType,
          label: task.name,
        } as Content,
      } as Memory;

      const result = (await startCodingTaskAction.handler(
        runtime,
        syntheticMemory,
        undefined,
        {
          parameters: {
            task: task.description,
            agentType,
            label: task.name,
          },
        },
        async (content) => {
          if (typeof content.text === "string" && content.text.trim()) {
            callbackLines.push(content.text);
          }
          return [];
        },
      )) as
        | {
            success?: boolean;
            text?: string;
            error?: string;
            data?: {
              agents?: Array<{ sessionId?: string }>;
            };
          }
        | undefined;

      if (callbackLines.length > 0) {
        await ctx.appendOutput(callbackLines.join("\n"));
      }

      const sessionId = result?.data?.agents?.[0]?.sessionId;
      const summary =
        result?.text ??
        (sessionId
          ? `Started ${label} task session ${sessionId}`
          : `Started ${label} task`);

      return {
        success: result?.success !== false,
        summary,
        filesCreated: [],
        filesModified: [],
        ...(result?.error ? { error: result.error } : {}),
        ...(sessionId ? { metadata: { sessionId } } : {}),
      };
    },
  };
}

export class AgentOrchestratorService extends EventEmitter {
  static serviceType = "CODE_TASK";

  readonly capabilityDescription =
    "Compatibility task service for orchestrator-backed code tasks";

  private readonly runtime: IAgentRuntime;
  private currentTaskId: string | null = null;
  private readonly executionStates = new Map<string, ExecutionState>();

  constructor(runtime: IAgentRuntime) {
    super();
    this.runtime = runtime;
  }

  static async start(
    runtime: IAgentRuntime,
  ): Promise<AgentOrchestratorService> {
    const existing = runtime.getService("CODE_TASK") as
      | AgentOrchestratorService
      | null;
    if (existing) {
      return existing;
    }

    const service = new AgentOrchestratorService(runtime);
    const servicesMap = runtime.services as
      | Map<string, Service[]>
      | undefined;
    const registered = servicesMap?.get("CODE_TASK") ?? [];
    servicesMap?.set("CODE_TASK", [
      ...registered,
      service as unknown as Service,
    ]);
    return service;
  }

  async stop(): Promise<void> {
    this.executionStates.clear();
  }

  async createCodeTask(
    name: string,
    description: string,
    roomId?: string,
    providerId?: string,
    requiredCapabilities?: string[],
  ): Promise<LegacyTask> {
    return this.createTask(
      name,
      description,
      roomId,
      providerId,
      requiredCapabilities,
    );
  }

  async createTask(
    name: string,
    description: string,
    roomId?: string,
    providerId?: string,
    requiredCapabilities?: string[],
  ): Promise<LegacyTask> {
    const provider = resolveConfiguredProvider(providerId);
    const workingDirectory =
      getLegacyConfig().getWorkingDirectory?.() ?? process.cwd();
    const worldId = await this.resolveWorldId(roomId);
    const metadata: LegacyTaskMetadata = {
      status: "pending",
      progress: 0,
      output: [],
      steps: [],
      userStatus: "open",
      filesCreated: [],
      filesModified: [],
      workingDirectory,
      createdAt: Date.now(),
      providerId: provider.id,
      providerLabel: provider.label,
      requiredCapabilities,
    };

    const taskId = await this.runtime.createTask({
      name,
      description,
      tags: ["code"],
      ...(roomId ? { roomId: roomId as UUID } : {}),
      worldId,
      metadata: metadata as unknown as Task["metadata"],
    } as Task);

    const created = await this.getTask(taskId);
    if (!created) {
      throw new Error(`Failed to load task after creation: ${taskId}`);
    }

    if (!this.currentTaskId && created.id) {
      this.currentTaskId = created.id;
    }

    this.emit("task:created", created);
    return created;
  }

  async getTask(taskId: string): Promise<LegacyTask | null> {
    return (await this.runtime.getTask(taskId as UUID)) as LegacyTask | null;
  }

  async getTasks(): Promise<LegacyTask[]> {
    return (await this.runtime.getTasks({
      tags: ["code"],
      agentIds: [this.runtime.agentId],
    })) as unknown as LegacyTask[];
  }

  async getCurrentTask(): Promise<LegacyTask | null> {
    return this.currentTaskId ? this.getTask(this.currentTaskId) : null;
  }

  getCurrentTaskId(): string | null {
    return this.currentTaskId;
  }

  setCurrentTask(taskId: string | null): void {
    this.currentTaskId = taskId;
  }

  async searchTasks(query: string): Promise<LegacyTask[]> {
    const lowered = query.toLowerCase();
    const tasks = await this.getTasks();
    return tasks.filter((task) => {
      const haystacks = [task.name, task.description];
      return haystacks.some((value) => value?.toLowerCase().includes(lowered));
    });
  }

  async getRecentTasks(limit = 10): Promise<LegacyTask[]> {
    const tasks = await this.getTasks();
    return tasks
      .slice()
      .sort(
        (a, b) =>
          (b.metadata.createdAt ?? 0) - (a.metadata.createdAt ?? 0),
      )
      .slice(0, limit);
  }

  async getTasksByStatus(status: TaskStatus): Promise<LegacyTask[]> {
    const tasks = await this.getTasks();
    return tasks.filter((task) => task.metadata.status === status);
  }

  async updateTaskStatus(taskId: string, status: TaskStatus): Promise<void> {
    const task = await this.getRequiredTask(taskId);
    const metadata = { ...task.metadata, status };
    const now = Date.now();
    if (status === "running" && !metadata.startedAt) {
      metadata.startedAt = now;
    }
    if (
      status === "completed" ||
      status === "failed" ||
      status === "cancelled"
    ) {
      metadata.completedAt = now;
    }

    await this.runtime.updateTask(taskId as UUID, {
      metadata: metadata as unknown as Task["metadata"],
    });

    const eventName: Record<TaskStatus, LegacyTaskEvent> = {
      pending: "task:progress",
      running: "task:started",
      completed: "task:completed",
      failed: "task:failed",
      paused: "task:paused",
      cancelled: "task:cancelled",
    };
    this.emit(eventName[status], { taskId, status });
  }

  async updateTaskProgress(taskId: string, progress: number): Promise<void> {
    const task = await this.getRequiredTask(taskId);
    const next = Math.max(0, Math.min(100, progress));
    await this.runtime.updateTask(taskId as UUID, {
      metadata: {
        ...task.metadata,
        progress: next,
      } as unknown as Task["metadata"],
    });
    this.emit("task:progress", { taskId, progress: next });
  }

  async appendOutput(taskId: string, text: string): Promise<void> {
    const task = await this.getRequiredTask(taskId);
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => line.trim().length > 0);
    if (lines.length === 0) {
      return;
    }
    await this.runtime.updateTask(taskId as UUID, {
      metadata: {
        ...task.metadata,
        output: [...task.metadata.output, ...lines],
      } as unknown as Task["metadata"],
    });
    this.emit("task:output", { taskId, lines });
  }

  async addStep(taskId: string, description: string): Promise<void> {
    const task = await this.getRequiredTask(taskId);
    const step: TaskStep = {
      id: randomUUID(),
      description,
      status: "pending",
    };
    await this.runtime.updateTask(taskId as UUID, {
      metadata: {
        ...task.metadata,
        steps: [...task.metadata.steps, step],
      } as unknown as Task["metadata"],
    });
  }

  async renameTask(taskId: string, name: string): Promise<void> {
    await this.runtime.updateTask(taskId as UUID, { name });
  }

  async setTaskSubAgentType(taskId: string, subAgentType: string): Promise<void> {
    const task = await this.getRequiredTask(taskId);
    await this.runtime.updateTask(taskId as UUID, {
      metadata: {
        ...task.metadata,
        subAgentType,
      } as unknown as Task["metadata"],
    });
  }

  async setUserStatus(taskId: string, userStatus: TaskUserStatus): Promise<void> {
    const task = await this.getRequiredTask(taskId);
    await this.runtime.updateTask(taskId as UUID, {
      metadata: {
        ...task.metadata,
        userStatus,
        userStatusUpdatedAt: Date.now(),
      } as unknown as Task["metadata"],
    });
  }

  async deleteTask(taskId: string): Promise<void> {
    await this.runtime.deleteTask(taskId as UUID);
    if (this.currentTaskId === taskId) {
      this.currentTaskId = null;
    }
    this.executionStates.delete(taskId);
  }

  async cancelTask(taskId: string): Promise<void> {
    const state = this.getOrCreateExecutionState(taskId);
    state.cancelled = true;
    state.paused = false;
    this.releasePausedResolvers(state);
    await this.updateTaskStatus(taskId, "cancelled");
  }

  isTaskCancelled(taskId: string): boolean {
    const state = this.executionStates.get(taskId);
    return state?.cancelled === true;
  }

  async pauseTask(taskId: string): Promise<void> {
    const state = this.getOrCreateExecutionState(taskId);
    state.paused = true;
    await this.updateTaskStatus(taskId, "paused");
  }

  async resumeTask(taskId: string): Promise<void> {
    const state = this.getOrCreateExecutionState(taskId);
    state.paused = false;
    this.releasePausedResolvers(state);
    await this.updateTaskStatus(taskId, "running");
    this.emit("task:resumed", { taskId });
  }

  isTaskPaused(taskId: string): boolean {
    const state = this.executionStates.get(taskId);
    return state?.paused === true;
  }

  async startTaskExecution(taskId: string): Promise<void> {
    const task = await this.getRequiredTask(taskId);
    const provider = resolveConfiguredProvider(task.metadata.providerId);
    const state = this.getOrCreateExecutionState(taskId);
    state.cancelled = false;
    state.paused = false;

    await this.updateTaskStatus(taskId, "running");

    const ctx: ProviderTaskExecutionContext = {
      runtime: this.runtime,
      taskId,
      getWorkingDirectory: () => task.metadata.workingDirectory,
      appendOutput: async (text) => {
        await this.appendOutput(taskId, text);
      },
      updateProgress: async (progress) => {
        await this.updateTaskProgress(taskId, progress);
      },
      isCancelled: () => state.cancelled,
      isPaused: () => state.paused,
      waitIfPaused: async () => {
        if (!state.paused || state.cancelled) {
          return;
        }
        await new Promise<void>((resolve) => {
          state.waitingResolvers.push(resolve);
        });
      },
    };

    const result = await provider.executeTask(
      {
        id: task.id ?? taskId,
        name: task.name ?? task.id,
        description: task.description ?? task.name ?? task.id,
        ...(task.roomId ? { roomId: task.roomId } : {}),
        providerId: provider.id,
        requiredCapabilities: task.metadata.requiredCapabilities,
        metadata: task.metadata as unknown as Record<string, JsonValue>,
      },
      ctx,
    );

    const latest = await this.getRequiredTask(taskId);
    if (state.cancelled || latest.metadata.status === "cancelled") {
      return;
    }

    const nextStatus: TaskStatus = result.success ? "completed" : "failed";
    await this.runtime.updateTask(taskId as UUID, {
      metadata: {
        ...latest.metadata,
        status: nextStatus,
        progress: result.success ? 100 : latest.metadata.progress,
        result,
        filesCreated: result.filesCreated,
        filesModified: result.filesModified,
        ...(result.error ? { error: result.error } : {}),
        completedAt: Date.now(),
      } as unknown as Task["metadata"],
    });
    this.emit(nextStatus === "completed" ? "task:completed" : "task:failed", {
      taskId,
      result,
    });
  }

  async getTaskContext(taskId?: string): Promise<string> {
    const task = taskId
      ? await this.getTask(taskId)
      : await this.getCurrentTask();

    if (!task) {
      const recent = await this.getRecentTasks(1);
      if (recent.length === 0) {
        return "No tasks have been created yet.";
      }
      return this.formatTaskContext(recent[0]);
    }

    return this.formatTaskContext(task);
  }

  async detectAndPauseInterruptedTasks(): Promise<number> {
    const runningTasks = await this.getTasksByStatus("running");
    for (const task of runningTasks) {
      if (task.id) {
        await this.pauseTask(task.id);
      }
    }
    return runningTasks.length;
  }

  private async resolveWorldId(roomId?: string): Promise<UUID> {
    if (!roomId) {
      return this.runtime.agentId;
    }
    const room = await this.runtime.getRoom(roomId as UUID);
    return (room?.worldId ?? this.runtime.agentId) as UUID;
  }

  private async getRequiredTask(taskId: string): Promise<LegacyTask> {
    const task = await this.getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    return task;
  }

  private getOrCreateExecutionState(taskId: string): ExecutionState {
    let state = this.executionStates.get(taskId);
    if (!state) {
      state = {
        cancelled: false,
        paused: false,
        waitingResolvers: [],
      };
      this.executionStates.set(taskId, state);
    }
    return state;
  }

  private releasePausedResolvers(state: ExecutionState): void {
    const resolvers = [...state.waitingResolvers];
    state.waitingResolvers.length = 0;
    for (const resolve of resolvers) {
      resolve();
    }
  }

  private formatTaskContext(task: LegacyTask): string {
    const lines = [
      `Current Task: ${task.name}`,
      `Status: ${task.metadata.status}`,
      `Progress: ${task.metadata.progress}%`,
      `Provider: ${task.metadata.providerLabel}`,
      `Description: ${task.description}`,
    ];

    if (task.metadata.steps.length > 0) {
      lines.push("", "Plan / Steps:");
      for (const step of task.metadata.steps) {
        lines.push(`- [${step.status}] ${step.description}`);
      }
    }

    if (task.metadata.output.length > 0) {
      lines.push("", "Task Output (history):");
      lines.push(...task.metadata.output.slice(-10));
    }

    return lines.join("\n");
  }
}

export const createTaskAction: LegacyTaskAction = {
  name: "CREATE_TASK",
  description: "Create a tracked code task in the compatibility task service",
  validate: async (_runtime, message) => shouldCreateTaskFromText(getMessageText(message)),
  handler: async (runtime, message, _state, options, callback) => {
    const service = await ensureCodeTaskService(runtime);
    const params = resolveOptions(options);
    const title =
      (typeof params?.title === "string" && params.title) ||
      getMessageText(message).slice(0, 80) ||
      "Code Task";
    const task = await service.createCodeTask(
      title,
      getMessageText(message),
      message.roomId,
      typeof params?.providerId === "string"
        ? params.providerId
        : typeof params?.agentType === "string"
          ? params.agentType
          : undefined,
    );

    const rawSteps = params?.steps;
    if (Array.isArray(rawSteps)) {
      for (const step of rawSteps) {
        if (typeof step === "string" && step.trim() && task.id) {
          await service.addStep(task.id, step);
        }
      }
    }

    if (callback) {
      await callback({
        text: `Created task "${task.name}"`,
      });
    }
    return {
      success: true,
      text: `Created task "${task.name}"`,
      data: { taskId: task.id },
    };
  },
};

export const pauseTaskAction: LegacyTaskAction = {
  name: "PAUSE_TASK",
  description: "Pause the current compatibility code task",
  validate: async () => true,
  handler: async (runtime, _message, _state, options, callback) => {
    const service = await ensureCodeTaskService(runtime);
    const params = resolveOptions(options);
    const taskId =
      (typeof params?.taskId === "string" && params.taskId) ||
      service.getCurrentTaskId();
    if (!taskId) {
      return { success: false, error: "NO_TASK" };
    }
    await service.pauseTask(taskId);
    if (callback) {
      await callback({ text: "Task paused" });
    }
    return { success: true, text: "Task paused" };
  },
};

export const resumeTaskAction: LegacyTaskAction = {
  name: "RESUME_TASK",
  description: "Resume the current compatibility code task",
  validate: async () => true,
  handler: async (runtime, _message, _state, options, callback) => {
    const service = await ensureCodeTaskService(runtime);
    const params = resolveOptions(options);
    const taskId =
      (typeof params?.taskId === "string" && params.taskId) ||
      service.getCurrentTaskId();
    if (!taskId) {
      return { success: false, error: "NO_TASK" };
    }
    await service.resumeTask(taskId);
    if (callback) {
      await callback({ text: "Task resumed" });
    }
    return { success: true, text: "Task resumed" };
  },
};

export const cancelTaskAction: LegacyTaskAction = {
  name: "CANCEL_TASK",
  description: "Cancel the current compatibility code task",
  validate: async () => true,
  handler: async (runtime, _message, _state, options, callback) => {
    const service = await ensureCodeTaskService(runtime);
    const params = resolveOptions(options);
    const taskId =
      (typeof params?.taskId === "string" && params.taskId) ||
      service.getCurrentTaskId();
    if (!taskId) {
      return { success: false, error: "NO_TASK" };
    }
    await service.cancelTask(taskId);
    if (callback) {
      await callback({ text: "Task cancelled" });
    }
    return { success: true, text: "Task cancelled" };
  },
};

export const listTasksAction: LegacyTaskAction = {
  name: "LIST_TASKS",
  description: "List compatibility code tasks",
  validate: async () => true,
  handler: async (runtime, _message, _state, _options, callback) => {
    const service = await ensureCodeTaskService(runtime);
    const tasks = await service.getTasks();
    const text =
      tasks.length === 0
        ? "No tasks."
        : `Tasks:\n${tasks.map(summarizeTaskSearch).join("\n")}`;
    if (callback) {
      await callback({ text });
    }
    return { success: true, text };
  },
};

export const searchTasksAction: LegacyTaskAction = {
  name: "SEARCH_TASKS",
  description: "Search compatibility code tasks",
  validate: async () => true,
  handler: async (runtime, message, _state, options, callback) => {
    const service = await ensureCodeTaskService(runtime);
    const params = resolveOptions(options);
    const query =
      (typeof params?.query === "string" && params.query) ||
      getMessageText(message);
    const tasks = await service.searchTasks(query);
    const text =
      tasks.length === 0
        ? `No tasks found for "${query}".`
        : `Matches:\n${tasks.map(summarizeTaskSearch).join("\n")}`;
    if (callback) {
      await callback({ text });
    }
    return { success: true, text };
  },
};

export const switchTaskAction: LegacyTaskAction = {
  name: "SWITCH_TASK",
  description: "Switch the current compatibility code task",
  validate: async () => true,
  handler: async (runtime, _message, _state, options, callback) => {
    const service = await ensureCodeTaskService(runtime);
    const params = resolveOptions(options);
    const taskId = typeof params?.taskId === "string" ? params.taskId : undefined;
    if (!taskId) {
      return { success: false, error: "NO_TASK" };
    }
    service.setCurrentTask(taskId);
    if (callback) {
      await callback({ text: `Switched to ${taskId}` });
    }
    return { success: true, text: `Switched to ${taskId}` };
  },
};
