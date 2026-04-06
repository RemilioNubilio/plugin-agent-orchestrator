import crypto from "node:crypto";
import type { IAgentRuntime } from "@elizaos/core";
import type { CodingAgentType } from "./pty-types.js";

type RawSqlQuery = {
  queryChunks: Array<{ value?: unknown }>;
};

type RuntimeDb = {
  execute: (query: RawSqlQuery) => Promise<unknown>;
};

type Row = Record<string, unknown>;

let cachedSqlRaw: ((query: string) => RawSqlQuery) | null = null;
const schemaReady = new WeakSet<object>();

export type TaskThreadKind =
  | "coding"
  | "research"
  | "planning"
  | "ops"
  | "mixed";

export type TaskThreadStatus =
  | "open"
  | "active"
  | "waiting_on_user"
  | "blocked"
  | "validating"
  | "done"
  | "failed"
  | "archived"
  | "interrupted";

export type TaskSessionStatus =
  | "active"
  | "blocked"
  | "waiting_on_user"
  | "completed"
  | "stopped"
  | "error"
  | "tool_running"
  | "interrupted";

export type TaskThreadEventType =
  | "task_created"
  | "task_registered"
  | "task_status_changed"
  | "task_archived"
  | "task_reopened"
  | "session_registered"
  | "session_updated"
  | "session_interrupted"
  | "decision_recorded"
  | "artifact_recorded"
  | "summary_updated";

export interface TaskThreadRecord {
  id: string;
  agentId: string;
  roomId: string | null;
  worldId: string | null;
  ownerUserId: string | null;
  title: string;
  kind: TaskThreadKind;
  status: TaskThreadStatus;
  originalRequest: string;
  summary: string;
  acceptanceCriteria: string[];
  currentPlan: Record<string, unknown>;
  searchText: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  archivedAt: string | null;
  lastUserTurnAt: string | null;
  lastCoordinatorTurnAt: string | null;
  metadata: Record<string, unknown>;
}

export interface TaskSessionRecord {
  id: string;
  threadId: string;
  agentId: string;
  sessionId: string;
  framework: CodingAgentType;
  providerSource: string | null;
  label: string;
  originalTask: string;
  workdir: string;
  repo: string | null;
  status: TaskSessionStatus;
  decisionCount: number;
  autoResolvedCount: number;
  registeredAt: number;
  lastActivityAt: number;
  idleCheckCount: number;
  taskDelivered: boolean;
  completionSummary: string | null;
  lastSeenDecisionIndex: number;
  lastInputSentAt: number | null;
  stoppedAt: number | null;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
}

export interface TaskDecisionRecord {
  id: string;
  threadId: string;
  sessionId: string;
  timestamp: number;
  event: string;
  promptText: string;
  decision: string;
  response: string | null;
  reasoning: string;
  metadata: Record<string, unknown>;
}

export interface TaskEventRecord {
  id: string;
  threadId: string;
  sessionId: string | null;
  eventType: TaskThreadEventType | string;
  timestamp: number;
  summary: string;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface TaskArtifactRecord {
  id: string;
  threadId: string;
  sessionId: string | null;
  artifactType: string;
  title: string;
  path: string | null;
  uri: string | null;
  mimeType: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface TaskTranscriptRecord {
  id: string;
  threadId: string;
  sessionId: string;
  timestamp: number;
  direction: "stdout" | "stderr" | "stdin" | "keys" | "system";
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface TaskPendingDecisionRecord {
  sessionId: string;
  threadId: string;
  promptText: string;
  recentOutput: string;
  llmDecision: Record<string, unknown>;
  taskContext: Record<string, unknown>;
  createdAt: number;
  updatedAt: string;
}

export interface TaskThreadSummary extends TaskThreadRecord {
  sessionCount: number;
  activeSessionCount: number;
  latestSessionId: string | null;
  latestSessionLabel: string | null;
  latestWorkdir: string | null;
  latestRepo: string | null;
  latestActivityAt: number | null;
  decisionCount: number;
}

export interface TaskThreadDetail extends TaskThreadSummary {
  sessions: TaskSessionRecord[];
  decisions: TaskDecisionRecord[];
  events: TaskEventRecord[];
  artifacts: TaskArtifactRecord[];
  transcripts: TaskTranscriptRecord[];
}

export interface CreateTaskThreadInput {
  id?: string;
  title: string;
  originalRequest: string;
  kind?: TaskThreadKind;
  roomId?: string | null;
  worldId?: string | null;
  ownerUserId?: string | null;
  summary?: string;
  acceptanceCriteria?: string[];
  currentPlan?: Record<string, unknown>;
  lastUserTurnAt?: string | null;
  metadata?: Record<string, unknown>;
}

export interface RegisterTaskSessionInput {
  threadId: string;
  sessionId: string;
  framework: CodingAgentType;
  label: string;
  originalTask: string;
  workdir: string;
  repo?: string;
  providerSource?: string | null;
  status?: TaskSessionStatus;
  decisionCount?: number;
  autoResolvedCount?: number;
  registeredAt?: number;
  lastActivityAt?: number;
  idleCheckCount?: number;
  taskDelivered?: boolean;
  completionSummary?: string | null;
  lastSeenDecisionIndex?: number;
  lastInputSentAt?: number | null;
  stoppedAt?: number | null;
  metadata?: Record<string, unknown>;
}

export interface UpdateTaskSessionInput {
  status?: TaskSessionStatus;
  decisionCount?: number;
  autoResolvedCount?: number;
  lastActivityAt?: number;
  idleCheckCount?: number;
  taskDelivered?: boolean;
  completionSummary?: string | null;
  lastSeenDecisionIndex?: number;
  lastInputSentAt?: number | null;
  stoppedAt?: number | null;
  metadata?: Record<string, unknown>;
}

export interface RecordTaskDecisionInput {
  threadId: string;
  sessionId: string;
  timestamp: number;
  event: string;
  promptText: string;
  decision: string;
  response?: string;
  reasoning: string;
  metadata?: Record<string, unknown>;
}

export interface RecordTaskEventInput {
  threadId: string;
  sessionId?: string | null;
  eventType: TaskThreadEventType | string;
  timestamp?: number;
  summary?: string;
  data?: Record<string, unknown>;
}

export interface RecordTaskArtifactInput {
  threadId: string;
  sessionId?: string | null;
  artifactType: string;
  title: string;
  path?: string | null;
  uri?: string | null;
  mimeType?: string | null;
  metadata?: Record<string, unknown>;
}

export interface RecordTaskTranscriptInput {
  threadId: string;
  sessionId: string;
  timestamp?: number;
  direction: TaskTranscriptRecord["direction"];
  content: string;
  metadata?: Record<string, unknown>;
}

export interface UpsertPendingDecisionInput {
  sessionId: string;
  threadId: string;
  promptText: string;
  recentOutput: string;
  llmDecision: Record<string, unknown>;
  taskContext: Record<string, unknown>;
  createdAt?: number;
}

export interface ListTaskThreadsOptions {
  includeArchived?: boolean;
  status?: TaskThreadStatus;
  search?: string;
  limit?: number;
}

function asObject(value: unknown): Row | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Row;
}

function toText(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function toNullableText(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return toText(value);
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = toNumber(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

function toBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined || value === "") return {};
  if (typeof value !== "string") return asObject(value) ?? {};
  try {
    return asObject(JSON.parse(value)) ?? {};
  } catch {
    return {};
  }
}

function parseJsonArray(value: unknown): string[] {
  if (value === null || value === undefined || value === "") return [];
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function isoNow(): string {
  return new Date().toISOString();
}

function sqlQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlText(value: string | null | undefined): string {
  if (value === null || value === undefined) return "NULL";
  return sqlQuote(value);
}

function sqlInteger(value: number | null | undefined): string {
  if (value === null || value === undefined) return "NULL";
  if (!Number.isFinite(value)) {
    throw new Error("invalid numeric SQL literal");
  }
  return String(Math.trunc(value));
}

function sqlBoolean(value: boolean): string {
  return value ? "TRUE" : "FALSE";
}

function sqlJson(value: unknown): string {
  return sqlQuote(JSON.stringify(value ?? null));
}

function normalizeThreadStatus(value: unknown): TaskThreadStatus {
  switch (toText(value).toLowerCase()) {
    case "active":
    case "waiting_on_user":
    case "blocked":
    case "validating":
    case "done":
    case "failed":
    case "archived":
    case "interrupted":
      return toText(value).toLowerCase() as TaskThreadStatus;
    default:
      return "open";
  }
}

function normalizeSessionStatus(value: unknown): TaskSessionStatus {
  switch (toText(value).toLowerCase()) {
    case "blocked":
    case "waiting_on_user":
    case "completed":
    case "stopped":
    case "error":
    case "tool_running":
    case "interrupted":
      return toText(value).toLowerCase() as TaskSessionStatus;
    default:
      return "active";
  }
}

function extractRows(result: unknown): Row[] {
  if (Array.isArray(result)) {
    return result.map((row) => asObject(row)).filter((row): row is Row => row !== null);
  }
  const obj = asObject(result);
  if (!obj || !Array.isArray(obj.rows)) return [];
  return obj.rows
    .map((row) => asObject(row))
    .filter((row): row is Row => row !== null);
}

async function getSqlRaw(): Promise<(query: string) => RawSqlQuery> {
  if (cachedSqlRaw) return cachedSqlRaw;
  const drizzle = (await import("drizzle-orm")) as {
    sql: { raw: (query: string) => RawSqlQuery };
  };
  cachedSqlRaw = drizzle.sql.raw;
  return cachedSqlRaw;
}

function getRuntimeDb(runtime: IAgentRuntime): RuntimeDb {
  const runtimeLike = runtime as IAgentRuntime & {
    adapter?: { db?: RuntimeDb };
    databaseAdapter?: { db?: RuntimeDb };
  };
  const db = runtimeLike.adapter?.db ?? runtimeLike.databaseAdapter?.db;
  if (!db || typeof db.execute !== "function") {
    throw new Error("runtime database adapter unavailable");
  }
  return db;
}

async function executeRawSql(
  runtime: IAgentRuntime,
  sqlTextValue: string,
): Promise<Row[]> {
  const raw = await getSqlRaw();
  const result = await getRuntimeDb(runtime).execute(raw(sqlTextValue));
  return extractRows(result);
}

function parseThreadRow(row: Row): TaskThreadRecord {
  return {
    id: toText(row.id),
    agentId: toText(row.agent_id),
    roomId: toNullableText(row.room_id),
    worldId: toNullableText(row.world_id),
    ownerUserId: toNullableText(row.owner_user_id),
    title: toText(row.title),
    kind: (toText(row.kind, "coding") as TaskThreadKind),
    status: normalizeThreadStatus(row.status),
    originalRequest: toText(row.original_request),
    summary: toText(row.summary),
    acceptanceCriteria: parseJsonArray(row.acceptance_criteria_json),
    currentPlan: parseJsonRecord(row.current_plan_json),
    searchText: toText(row.search_text),
    createdAt: toText(row.created_at),
    updatedAt: toText(row.updated_at),
    closedAt: toNullableText(row.closed_at),
    archivedAt: toNullableText(row.archived_at),
    lastUserTurnAt: toNullableText(row.last_user_turn_at),
    lastCoordinatorTurnAt: toNullableText(row.last_coordinator_turn_at),
    metadata: parseJsonRecord(row.metadata_json),
  };
}

function parseThreadSummaryRow(row: Row): TaskThreadSummary {
  return {
    ...parseThreadRow(row),
    sessionCount: toNumber(row.session_count, 0),
    activeSessionCount: toNumber(row.active_session_count, 0),
    latestSessionId: toNullableText(row.latest_session_id),
    latestSessionLabel: toNullableText(row.latest_session_label),
    latestWorkdir: toNullableText(row.latest_workdir),
    latestRepo: toNullableText(row.latest_repo),
    latestActivityAt: toNullableNumber(row.latest_activity_at),
    decisionCount: toNumber(row.decision_count, 0),
  };
}

function parseSessionRow(row: Row): TaskSessionRecord {
  return {
    id: toText(row.id),
    threadId: toText(row.thread_id),
    agentId: toText(row.agent_id),
    sessionId: toText(row.session_id),
    framework: toText(row.framework, "claude") as CodingAgentType,
    providerSource: toNullableText(row.provider_source),
    label: toText(row.label),
    originalTask: toText(row.original_task),
    workdir: toText(row.workdir),
    repo: toNullableText(row.repo),
    status: normalizeSessionStatus(row.status),
    decisionCount: toNumber(row.decision_count, 0),
    autoResolvedCount: toNumber(row.auto_resolved_count, 0),
    registeredAt: toNumber(row.registered_at, 0),
    lastActivityAt: toNumber(row.last_activity_at, 0),
    idleCheckCount: toNumber(row.idle_check_count, 0),
    taskDelivered: toBoolean(row.task_delivered),
    completionSummary: toNullableText(row.completion_summary),
    lastSeenDecisionIndex: toNumber(row.last_seen_decision_index, 0),
    lastInputSentAt: toNullableNumber(row.last_input_sent_at),
    stoppedAt: toNullableNumber(row.stopped_at),
    createdAt: toText(row.created_at),
    updatedAt: toText(row.updated_at),
    metadata: parseJsonRecord(row.metadata_json),
  };
}

function parseDecisionRow(row: Row): TaskDecisionRecord {
  return {
    id: toText(row.id),
    threadId: toText(row.thread_id),
    sessionId: toText(row.session_id),
    timestamp: toNumber(row.timestamp, 0),
    event: toText(row.event_type),
    promptText: toText(row.prompt_text),
    decision: toText(row.decision),
    response: toNullableText(row.response),
    reasoning: toText(row.reasoning),
    metadata: parseJsonRecord(row.metadata_json),
  };
}

function parseEventRow(row: Row): TaskEventRecord {
  return {
    id: toText(row.id),
    threadId: toText(row.thread_id),
    sessionId: toNullableText(row.session_id),
    eventType: toText(row.event_type),
    timestamp: toNumber(row.timestamp, 0),
    summary: toText(row.summary),
    data: parseJsonRecord(row.data_json),
    createdAt: toText(row.created_at),
  };
}

function parseArtifactRow(row: Row): TaskArtifactRecord {
  return {
    id: toText(row.id),
    threadId: toText(row.thread_id),
    sessionId: toNullableText(row.session_id),
    artifactType: toText(row.artifact_type),
    title: toText(row.title),
    path: toNullableText(row.path),
    uri: toNullableText(row.uri),
    mimeType: toNullableText(row.mime_type),
    metadata: parseJsonRecord(row.metadata_json),
    createdAt: toText(row.created_at),
  };
}

function parseTranscriptRow(row: Row): TaskTranscriptRecord {
  return {
    id: toText(row.id),
    threadId: toText(row.thread_id),
    sessionId: toText(row.session_id),
    timestamp: toNumber(row.timestamp, 0),
    direction: toText(row.direction) as TaskTranscriptRecord["direction"],
    content: toText(row.content),
    metadata: parseJsonRecord(row.metadata_json),
    createdAt: toText(row.created_at),
  };
}

function parsePendingDecisionRow(row: Row): TaskPendingDecisionRecord {
  return {
    sessionId: toText(row.session_id),
    threadId: toText(row.thread_id),
    promptText: toText(row.prompt_text),
    recentOutput: toText(row.recent_output),
    llmDecision: parseJsonRecord(row.llm_decision_json),
    taskContext: parseJsonRecord(row.task_context_json),
    createdAt: toNumber(row.created_at, 0),
    updatedAt: toText(row.updated_at),
  };
}

function buildSearchText(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => (part ?? "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
}

export class TaskRegistry {
  constructor(private readonly runtime: IAgentRuntime) {}

  private schemaKey(): object {
    const runtimeLike = this.runtime as IAgentRuntime & {
      adapter?: object;
      databaseAdapter?: object;
    };
    return (
      runtimeLike.adapter ??
      runtimeLike.databaseAdapter ??
      (this.runtime as unknown as object)
    );
  }

  async ensureSchema(): Promise<void> {
    const key = this.schemaKey();
    if (schemaReady.has(key)) return;

    await executeRawSql(
      this.runtime,
      `CREATE TABLE IF NOT EXISTS orchestrator_task_threads (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        room_id TEXT,
        world_id TEXT,
        owner_user_id TEXT,
        title TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'coding',
        status TEXT NOT NULL DEFAULT 'open',
        original_request TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        acceptance_criteria_json TEXT NOT NULL DEFAULT '[]',
        current_plan_json TEXT NOT NULL DEFAULT '{}',
        search_text TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        closed_at TEXT,
        archived_at TEXT,
        last_user_turn_at TEXT,
        last_coordinator_turn_at TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      )`,
    );

    await executeRawSql(
      this.runtime,
      `CREATE TABLE IF NOT EXISTS orchestrator_task_sessions (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL UNIQUE,
        framework TEXT NOT NULL,
        provider_source TEXT,
        label TEXT NOT NULL,
        original_task TEXT NOT NULL,
        workdir TEXT NOT NULL,
        repo TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        decision_count INTEGER NOT NULL DEFAULT 0,
        auto_resolved_count INTEGER NOT NULL DEFAULT 0,
        registered_at BIGINT NOT NULL,
        last_activity_at BIGINT NOT NULL,
        idle_check_count INTEGER NOT NULL DEFAULT 0,
        task_delivered BOOLEAN NOT NULL DEFAULT FALSE,
        completion_summary TEXT,
        last_seen_decision_index INTEGER NOT NULL DEFAULT 0,
        last_input_sent_at BIGINT,
        stopped_at BIGINT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      )`,
    );

    await executeRawSql(
      this.runtime,
      `CREATE TABLE IF NOT EXISTS orchestrator_task_decisions (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        timestamp BIGINT NOT NULL,
        event_type TEXT NOT NULL,
        prompt_text TEXT NOT NULL DEFAULT '',
        decision TEXT NOT NULL,
        response TEXT,
        reasoning TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      )`,
    );

    await executeRawSql(
      this.runtime,
      `CREATE TABLE IF NOT EXISTS orchestrator_task_events (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        session_id TEXT,
        event_type TEXT NOT NULL,
        timestamp BIGINT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      )`,
    );

    await executeRawSql(
      this.runtime,
      `CREATE TABLE IF NOT EXISTS orchestrator_task_artifacts (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        session_id TEXT,
        artifact_type TEXT NOT NULL,
        title TEXT NOT NULL,
        path TEXT,
        uri TEXT,
        mime_type TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      )`,
    );

    await executeRawSql(
      this.runtime,
      `CREATE TABLE IF NOT EXISTS orchestrator_task_transcripts (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        timestamp BIGINT NOT NULL,
        direction TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      )`,
    );

    await executeRawSql(
      this.runtime,
      `CREATE TABLE IF NOT EXISTS orchestrator_task_pending_decisions (
        session_id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        prompt_text TEXT NOT NULL,
        recent_output TEXT NOT NULL DEFAULT '',
        llm_decision_json TEXT NOT NULL DEFAULT '{}',
        task_context_json TEXT NOT NULL DEFAULT '{}',
        created_at BIGINT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    );

    await executeRawSql(
      this.runtime,
      `CREATE INDEX IF NOT EXISTS idx_orchestrator_task_threads_status
         ON orchestrator_task_threads(status)`,
    );
    await executeRawSql(
      this.runtime,
      `CREATE INDEX IF NOT EXISTS idx_orchestrator_task_threads_updated_at
         ON orchestrator_task_threads(updated_at)`,
    );
    await executeRawSql(
      this.runtime,
      `CREATE INDEX IF NOT EXISTS idx_orchestrator_task_threads_archived_at
         ON orchestrator_task_threads(archived_at)`,
    );
    await executeRawSql(
      this.runtime,
      `CREATE INDEX IF NOT EXISTS idx_orchestrator_task_sessions_thread_id
         ON orchestrator_task_sessions(thread_id)`,
    );
    await executeRawSql(
      this.runtime,
      `CREATE INDEX IF NOT EXISTS idx_orchestrator_task_sessions_status
         ON orchestrator_task_sessions(status)`,
    );
    await executeRawSql(
      this.runtime,
      `CREATE INDEX IF NOT EXISTS idx_orchestrator_task_decisions_thread_id
         ON orchestrator_task_decisions(thread_id, timestamp DESC)`,
    );
    await executeRawSql(
      this.runtime,
      `CREATE INDEX IF NOT EXISTS idx_orchestrator_task_events_thread_id
         ON orchestrator_task_events(thread_id, timestamp DESC)`,
    );
    await executeRawSql(
      this.runtime,
      `CREATE INDEX IF NOT EXISTS idx_orchestrator_task_transcripts_thread_id
         ON orchestrator_task_transcripts(thread_id, timestamp DESC)`,
    );
    await executeRawSql(
      this.runtime,
      `CREATE INDEX IF NOT EXISTS idx_orchestrator_task_pending_decisions_thread_id
         ON orchestrator_task_pending_decisions(thread_id)`,
    );
    await executeRawSql(
      this.runtime,
      `CREATE INDEX IF NOT EXISTS idx_orchestrator_task_pending_decisions_created_at
         ON orchestrator_task_pending_decisions(created_at DESC)`,
    );

    schemaReady.add(key);
  }

  async recoverInterruptedTasks(): Promise<void> {
    await this.ensureSchema();
    const impactedSessions = await executeRawSql(
      this.runtime,
      `SELECT session_id, thread_id
         FROM orchestrator_task_sessions
        WHERE status IN ('active', 'blocked', 'tool_running')`,
    );
    if (impactedSessions.length === 0) return;

    const nowIso = isoNow();
    const now = Date.now();
    await executeRawSql(
      this.runtime,
      `UPDATE orchestrator_task_sessions
          SET status = 'interrupted',
              updated_at = ${sqlQuote(nowIso)},
              stopped_at = COALESCE(stopped_at, ${sqlInteger(now)})
        WHERE status IN ('active', 'blocked', 'tool_running')`,
    );

    const affectedThreadIds = new Set<string>();
    for (const row of impactedSessions) {
      const sessionId = toText(row.session_id);
      const threadId = toText(row.thread_id);
      if (!threadId) continue;
      affectedThreadIds.add(threadId);
      await this.appendEvent({
        threadId,
        sessionId,
        eventType: "session_interrupted",
        timestamp: now,
        summary: "Session interrupted by runtime restart or shutdown",
        data: { reason: "runtime_restart" },
      });
    }

    for (const threadId of affectedThreadIds) {
      await this.recomputeThreadStatus(threadId);
    }
  }

  async createThread(input: CreateTaskThreadInput): Promise<TaskThreadRecord> {
    await this.ensureSchema();
    const id = input.id?.trim() || `task-${crypto.randomUUID()}`;
    const createdAt = isoNow();
    const acceptanceCriteria = input.acceptanceCriteria ?? [];
    const currentPlan = input.currentPlan ?? {};
    const summary = input.summary?.trim() ?? "";
    const searchText = buildSearchText([
      input.title,
      input.originalRequest,
      summary,
      input.metadata ? JSON.stringify(input.metadata) : "",
    ]);

    await executeRawSql(
      this.runtime,
      `INSERT INTO orchestrator_task_threads (
        id, agent_id, room_id, world_id, owner_user_id, title, kind, status,
        original_request, summary, acceptance_criteria_json, current_plan_json,
        search_text, created_at, updated_at, closed_at, archived_at,
        last_user_turn_at, last_coordinator_turn_at, metadata_json
      ) VALUES (
        ${sqlQuote(id)},
        ${sqlQuote(this.runtime.agentId)},
        ${sqlText(input.roomId ?? null)},
        ${sqlText(input.worldId ?? null)},
        ${sqlText(input.ownerUserId ?? null)},
        ${sqlQuote(input.title.trim())},
        ${sqlQuote(input.kind ?? "coding")},
        'open',
        ${sqlQuote(input.originalRequest)},
        ${sqlQuote(summary)},
        ${sqlJson(acceptanceCriteria)},
        ${sqlJson(currentPlan)},
        ${sqlQuote(searchText)},
        ${sqlQuote(createdAt)},
        ${sqlQuote(createdAt)},
        NULL,
        NULL,
        ${sqlText(input.lastUserTurnAt ?? createdAt)},
        NULL,
        ${sqlJson(input.metadata ?? {})}
      )`,
    );

    await this.appendEvent({
      threadId: id,
      eventType: "task_created",
      timestamp: Date.now(),
      summary: `Created task thread "${input.title.trim()}"`,
      data: {
        kind: input.kind ?? "coding",
        roomId: input.roomId ?? null,
        worldId: input.worldId ?? null,
      },
    });

    const created = await this.getThreadRecord(id);
    if (!created) {
      throw new Error(`Failed to create task thread ${id}`);
    }
    return created;
  }

  async getThreadRecord(threadId: string): Promise<TaskThreadRecord | null> {
    await this.ensureSchema();
    const rows = await executeRawSql(
      this.runtime,
      `SELECT *
         FROM orchestrator_task_threads
        WHERE id = ${sqlQuote(threadId)}
        LIMIT 1`,
    );
    return rows[0] ? parseThreadRow(rows[0]) : null;
  }

  async getThread(threadId: string): Promise<TaskThreadDetail | null> {
    await this.ensureSchema();
    const summary = await this.getThreadSummary(threadId);
    if (!summary) return null;

    const [sessions, decisions, events, artifacts, transcripts] = await Promise.all([
      this.listSessionsForThread(threadId),
      this.listDecisionsForThread(threadId),
      this.listEventsForThread(threadId),
      this.listArtifactsForThread(threadId),
      this.listTranscriptsForThread(threadId),
    ]);

    return {
      ...summary,
      sessions,
      decisions,
      events,
      artifacts,
      transcripts,
    };
  }

  async listThreads(
    options: ListTaskThreadsOptions = {},
  ): Promise<TaskThreadSummary[]> {
    await this.ensureSchema();
    const clauses: string[] = [];
    if (!options.includeArchived) {
      clauses.push("thread.archived_at IS NULL");
    }
    if (options.status) {
      clauses.push(`thread.status = ${sqlQuote(options.status)}`);
    }
    if (options.search?.trim()) {
      const q = options.search.trim().toLowerCase();
      clauses.push(`thread.search_text LIKE ${sqlQuote(`%${q}%`)}`);
    }

    const whereClause =
      clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limitClause =
      typeof options.limit === "number" && options.limit > 0
        ? `LIMIT ${Math.trunc(options.limit)}`
        : "";

    const rows = await executeRawSql(
      this.runtime,
      `SELECT
          thread.*,
          COALESCE(session_counts.session_count, 0) AS session_count,
          COALESCE(session_counts.active_session_count, 0) AS active_session_count,
          latest.session_id AS latest_session_id,
          latest.label AS latest_session_label,
          latest.workdir AS latest_workdir,
          latest.repo AS latest_repo,
          latest.last_activity_at AS latest_activity_at,
          COALESCE(decision_counts.decision_count, 0) AS decision_count
        FROM orchestrator_task_threads AS thread
        LEFT JOIN (
          SELECT
            thread_id,
            COUNT(*) AS session_count,
            SUM(CASE WHEN status IN ('active', 'blocked', 'tool_running') THEN 1 ELSE 0 END) AS active_session_count
          FROM orchestrator_task_sessions
          GROUP BY thread_id
        ) AS session_counts
          ON session_counts.thread_id = thread.id
        LEFT JOIN (
          SELECT latest_session.thread_id,
                 latest_session.session_id,
                 latest_session.label,
                 latest_session.workdir,
                 latest_session.repo,
                 latest_session.last_activity_at
            FROM orchestrator_task_sessions AS latest_session
            INNER JOIN (
              SELECT thread_id, MAX(last_activity_at) AS max_last_activity_at
                FROM orchestrator_task_sessions
               GROUP BY thread_id
            ) AS grouped
              ON grouped.thread_id = latest_session.thread_id
             AND grouped.max_last_activity_at = latest_session.last_activity_at
        ) AS latest
          ON latest.thread_id = thread.id
        LEFT JOIN (
          SELECT thread_id, COUNT(*) AS decision_count
            FROM orchestrator_task_decisions
           GROUP BY thread_id
        ) AS decision_counts
          ON decision_counts.thread_id = thread.id
        ${whereClause}
        ORDER BY thread.updated_at DESC
        ${limitClause}`,
    );

    return rows.map(parseThreadSummaryRow);
  }

  async getThreadSummary(threadId: string): Promise<TaskThreadSummary | null> {
    const rows = await this.listThreads({
      includeArchived: true,
    });
    return rows.find((row) => row.id === threadId) ?? null;
  }

  async findThreadIdBySessionId(sessionId: string): Promise<string | null> {
    await this.ensureSchema();
    const rows = await executeRawSql(
      this.runtime,
      `SELECT thread_id
         FROM orchestrator_task_sessions
        WHERE session_id = ${sqlQuote(sessionId)}
        LIMIT 1`,
    );
    return rows[0] ? toText(rows[0].thread_id) : null;
  }

  async getSession(sessionId: string): Promise<TaskSessionRecord | null> {
    await this.ensureSchema();
    const rows = await executeRawSql(
      this.runtime,
      `SELECT *
         FROM orchestrator_task_sessions
        WHERE session_id = ${sqlQuote(sessionId)}
        LIMIT 1`,
    );
    return rows[0] ? parseSessionRow(rows[0]) : null;
  }

  async registerSession(input: RegisterTaskSessionInput): Promise<void> {
    await this.ensureSchema();
    const nowIso = isoNow();
    const registeredAt = input.registeredAt ?? Date.now();
    const lastActivityAt = input.lastActivityAt ?? registeredAt;
    const existingThread = await this.getThreadRecord(input.threadId);
    if (!existingThread) {
      throw new Error(`Task thread ${input.threadId} not found`);
    }

    await executeRawSql(
      this.runtime,
      `INSERT INTO orchestrator_task_sessions (
        id, thread_id, agent_id, session_id, framework, provider_source, label,
        original_task, workdir, repo, status, decision_count, auto_resolved_count,
        registered_at, last_activity_at, idle_check_count, task_delivered,
        completion_summary, last_seen_decision_index, last_input_sent_at, stopped_at,
        created_at, updated_at, metadata_json
      ) VALUES (
        ${sqlQuote(input.sessionId)},
        ${sqlQuote(input.threadId)},
        ${sqlQuote(this.runtime.agentId)},
        ${sqlQuote(input.sessionId)},
        ${sqlQuote(input.framework)},
        ${sqlText(input.providerSource ?? null)},
        ${sqlQuote(input.label)},
        ${sqlQuote(input.originalTask)},
        ${sqlQuote(input.workdir)},
        ${sqlText(input.repo ?? null)},
        ${sqlQuote(input.status ?? "active")},
        ${sqlInteger(input.decisionCount ?? 0)},
        ${sqlInteger(input.autoResolvedCount ?? 0)},
        ${sqlInteger(registeredAt)},
        ${sqlInteger(lastActivityAt)},
        ${sqlInteger(input.idleCheckCount ?? 0)},
        ${sqlBoolean(input.taskDelivered ?? false)},
        ${sqlText(input.completionSummary ?? null)},
        ${sqlInteger(input.lastSeenDecisionIndex ?? 0)},
        ${sqlInteger(input.lastInputSentAt ?? null)},
        ${sqlInteger(input.stoppedAt ?? null)},
        ${sqlQuote(nowIso)},
        ${sqlQuote(nowIso)},
        ${sqlJson(input.metadata ?? {})}
      )
      ON CONFLICT(id) DO UPDATE SET
        thread_id = EXCLUDED.thread_id,
        framework = EXCLUDED.framework,
        provider_source = EXCLUDED.provider_source,
        label = EXCLUDED.label,
        original_task = EXCLUDED.original_task,
        workdir = EXCLUDED.workdir,
        repo = EXCLUDED.repo,
        status = EXCLUDED.status,
        decision_count = EXCLUDED.decision_count,
        auto_resolved_count = EXCLUDED.auto_resolved_count,
        registered_at = EXCLUDED.registered_at,
        last_activity_at = EXCLUDED.last_activity_at,
        idle_check_count = EXCLUDED.idle_check_count,
        task_delivered = EXCLUDED.task_delivered,
        completion_summary = EXCLUDED.completion_summary,
        last_seen_decision_index = EXCLUDED.last_seen_decision_index,
        last_input_sent_at = EXCLUDED.last_input_sent_at,
        stopped_at = EXCLUDED.stopped_at,
        updated_at = EXCLUDED.updated_at,
        metadata_json = EXCLUDED.metadata_json`,
    );

    await this.appendEvent({
      threadId: input.threadId,
      sessionId: input.sessionId,
      eventType: "session_registered",
      timestamp: registeredAt,
      summary: `Registered session "${input.label}"`,
      data: {
        framework: input.framework,
        repo: input.repo ?? null,
        workdir: input.workdir,
      },
    });

    await this.recomputeThreadStatus(input.threadId);
  }

  async updateSession(
    sessionId: string,
    patch: UpdateTaskSessionInput,
  ): Promise<void> {
    await this.ensureSchema();
    const threadId = await this.findThreadIdBySessionId(sessionId);
    if (!threadId) return;
    const existingRows = await executeRawSql(
      this.runtime,
      `SELECT *
         FROM orchestrator_task_sessions
        WHERE session_id = ${sqlQuote(sessionId)}
        LIMIT 1`,
    );
    if (!existingRows[0]) return;
    const existing = parseSessionRow(existingRows[0]);
    const nextMeta = patch.metadata
      ? { ...existing.metadata, ...patch.metadata }
      : existing.metadata;
    const nowIso = isoNow();

    await executeRawSql(
      this.runtime,
      `UPDATE orchestrator_task_sessions
          SET status = ${sqlQuote(patch.status ?? existing.status)},
              decision_count = ${sqlInteger(
                patch.decisionCount ?? existing.decisionCount,
              )},
              auto_resolved_count = ${sqlInteger(
                patch.autoResolvedCount ?? existing.autoResolvedCount,
              )},
              last_activity_at = ${sqlInteger(
                patch.lastActivityAt ?? existing.lastActivityAt,
              )},
              idle_check_count = ${sqlInteger(
                patch.idleCheckCount ?? existing.idleCheckCount,
              )},
              task_delivered = ${sqlBoolean(
                patch.taskDelivered ?? existing.taskDelivered,
              )},
              completion_summary = ${sqlText(
                patch.completionSummary ?? existing.completionSummary,
              )},
              last_seen_decision_index = ${sqlInteger(
                patch.lastSeenDecisionIndex ?? existing.lastSeenDecisionIndex,
              )},
              last_input_sent_at = ${sqlInteger(
                patch.lastInputSentAt ?? existing.lastInputSentAt,
              )},
              stopped_at = ${sqlInteger(patch.stoppedAt ?? existing.stoppedAt)},
              updated_at = ${sqlQuote(nowIso)},
              metadata_json = ${sqlJson(nextMeta)}
        WHERE session_id = ${sqlQuote(sessionId)}`,
    );

    await this.appendEvent({
      threadId,
      sessionId,
      eventType: "session_updated",
      timestamp: patch.lastActivityAt ?? Date.now(),
      summary: `Updated session "${existing.label}"`,
      data: {
        status: patch.status ?? existing.status,
        decisionCount: patch.decisionCount ?? existing.decisionCount,
        autoResolvedCount:
          patch.autoResolvedCount ?? existing.autoResolvedCount,
      },
    });

    await this.recomputeThreadStatus(threadId);
  }

  async recordDecision(input: RecordTaskDecisionInput): Promise<void> {
    await this.ensureSchema();
    const createdAt = isoNow();
    await executeRawSql(
      this.runtime,
      `INSERT INTO orchestrator_task_decisions (
        id, thread_id, session_id, timestamp, event_type, prompt_text, decision,
        response, reasoning, metadata_json, created_at
      ) VALUES (
        ${sqlQuote(`decision-${crypto.randomUUID()}`)},
        ${sqlQuote(input.threadId)},
        ${sqlQuote(input.sessionId)},
        ${sqlInteger(input.timestamp)},
        ${sqlQuote(input.event)},
        ${sqlQuote(input.promptText)},
        ${sqlQuote(input.decision)},
        ${sqlText(input.response ?? null)},
        ${sqlQuote(input.reasoning)},
        ${sqlJson(input.metadata ?? {})},
        ${sqlQuote(createdAt)}
      )`,
    );

    await this.appendEvent({
      threadId: input.threadId,
      sessionId: input.sessionId,
      eventType: "decision_recorded",
      timestamp: input.timestamp,
      summary: `${input.decision} decision recorded`,
      data: {
        event: input.event,
        promptText: input.promptText,
        response: input.response ?? null,
      },
    });
  }

  async appendEvent(input: RecordTaskEventInput): Promise<void> {
    await this.ensureSchema();
    const createdAt = isoNow();
    const timestamp = input.timestamp ?? Date.now();
    await executeRawSql(
      this.runtime,
      `INSERT INTO orchestrator_task_events (
        id, thread_id, session_id, event_type, timestamp, summary, data_json, created_at
      ) VALUES (
        ${sqlQuote(`event-${crypto.randomUUID()}`)},
        ${sqlQuote(input.threadId)},
        ${sqlText(input.sessionId ?? null)},
        ${sqlQuote(input.eventType)},
        ${sqlInteger(timestamp)},
        ${sqlQuote(input.summary ?? "")},
        ${sqlJson(input.data ?? {})},
        ${sqlQuote(createdAt)}
      )`,
    );

    await executeRawSql(
      this.runtime,
      `UPDATE orchestrator_task_threads
          SET updated_at = ${sqlQuote(createdAt)}
        WHERE id = ${sqlQuote(input.threadId)}`,
    );
  }

  async recordArtifact(input: RecordTaskArtifactInput): Promise<void> {
    await this.ensureSchema();
    const createdAt = isoNow();
    await executeRawSql(
      this.runtime,
      `INSERT INTO orchestrator_task_artifacts (
        id, thread_id, session_id, artifact_type, title, path, uri, mime_type, metadata_json, created_at
      ) VALUES (
        ${sqlQuote(`artifact-${crypto.randomUUID()}`)},
        ${sqlQuote(input.threadId)},
        ${sqlText(input.sessionId ?? null)},
        ${sqlQuote(input.artifactType)},
        ${sqlQuote(input.title)},
        ${sqlText(input.path ?? null)},
        ${sqlText(input.uri ?? null)},
        ${sqlText(input.mimeType ?? null)},
        ${sqlJson(input.metadata ?? {})},
        ${sqlQuote(createdAt)}
      )`,
    );

    await this.appendEvent({
      threadId: input.threadId,
      sessionId: input.sessionId ?? null,
      eventType: "artifact_recorded",
      summary: `Recorded ${input.artifactType} artifact`,
      data: {
        artifactType: input.artifactType,
        title: input.title,
        path: input.path ?? null,
        uri: input.uri ?? null,
      },
    });
  }

  async recordTranscript(input: RecordTaskTranscriptInput): Promise<void> {
    await this.ensureSchema();
    const createdAt = isoNow();
    const timestamp = input.timestamp ?? Date.now();
    await executeRawSql(
      this.runtime,
      `INSERT INTO orchestrator_task_transcripts (
        id, thread_id, session_id, timestamp, direction, content, metadata_json, created_at
      ) VALUES (
        ${sqlQuote(`transcript-${crypto.randomUUID()}`)},
        ${sqlQuote(input.threadId)},
        ${sqlQuote(input.sessionId)},
        ${sqlInteger(timestamp)},
        ${sqlQuote(input.direction)},
        ${sqlQuote(input.content)},
        ${sqlJson(input.metadata ?? {})},
        ${sqlQuote(createdAt)}
      )`,
    );
    await executeRawSql(
      this.runtime,
      `UPDATE orchestrator_task_threads
          SET updated_at = ${sqlQuote(createdAt)}
        WHERE id = ${sqlQuote(input.threadId)}`,
    );
  }

  async updateThreadSummary(
    threadId: string,
    summary: string,
  ): Promise<void> {
    await this.ensureSchema();
    const thread = await this.getThreadRecord(threadId);
    if (!thread) return;
    const nextSearchText = buildSearchText([
      thread.title,
      thread.originalRequest,
      summary,
      thread.searchText,
    ]);
    const nowIso = isoNow();
    await executeRawSql(
      this.runtime,
      `UPDATE orchestrator_task_threads
          SET summary = ${sqlQuote(summary)},
              search_text = ${sqlQuote(nextSearchText)},
              updated_at = ${sqlQuote(nowIso)}
        WHERE id = ${sqlQuote(threadId)}`,
    );
    await this.appendEvent({
      threadId,
      eventType: "summary_updated",
      summary: "Updated task summary",
      data: { summary },
    });
  }

  async archiveThread(threadId: string): Promise<void> {
    await this.ensureSchema();
    const nowIso = isoNow();
    await executeRawSql(
      this.runtime,
      `UPDATE orchestrator_task_threads
          SET status = 'archived',
              archived_at = ${sqlQuote(nowIso)},
              closed_at = COALESCE(closed_at, ${sqlQuote(nowIso)}),
              updated_at = ${sqlQuote(nowIso)}
        WHERE id = ${sqlQuote(threadId)}`,
    );
    await this.appendEvent({
      threadId,
      eventType: "task_archived",
      summary: "Archived task thread",
      data: {},
    });
  }

  async reopenThread(threadId: string): Promise<void> {
    await this.ensureSchema();
    const nowIso = isoNow();
    await executeRawSql(
      this.runtime,
      `UPDATE orchestrator_task_threads
          SET status = 'open',
              archived_at = NULL,
              closed_at = NULL,
              updated_at = ${sqlQuote(nowIso)}
        WHERE id = ${sqlQuote(threadId)}`,
    );
    await this.appendEvent({
      threadId,
      eventType: "task_reopened",
      summary: "Reopened task thread",
      data: {},
    });
    await this.recomputeThreadStatus(threadId);
  }

  async upsertPendingDecision(
    input: UpsertPendingDecisionInput,
  ): Promise<void> {
    await this.ensureSchema();
    const createdAt = input.createdAt ?? Date.now();
    const nowIso = isoNow();
    await executeRawSql(
      this.runtime,
      `INSERT INTO orchestrator_task_pending_decisions (
        session_id,
        thread_id,
        prompt_text,
        recent_output,
        llm_decision_json,
        task_context_json,
        created_at,
        updated_at
      ) VALUES (
        ${sqlQuote(input.sessionId)},
        ${sqlQuote(input.threadId)},
        ${sqlQuote(input.promptText)},
        ${sqlQuote(input.recentOutput)},
        ${sqlJson(input.llmDecision)},
        ${sqlJson(input.taskContext)},
        ${sqlInteger(createdAt)},
        ${sqlQuote(nowIso)}
      )
      ON CONFLICT(session_id) DO UPDATE SET
        thread_id = EXCLUDED.thread_id,
        prompt_text = EXCLUDED.prompt_text,
        recent_output = EXCLUDED.recent_output,
        llm_decision_json = EXCLUDED.llm_decision_json,
        task_context_json = EXCLUDED.task_context_json,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at`,
    );
    await executeRawSql(
      this.runtime,
      `UPDATE orchestrator_task_threads
          SET updated_at = ${sqlQuote(nowIso)}
        WHERE id = ${sqlQuote(input.threadId)}`,
    );
  }

  async deletePendingDecision(sessionId: string): Promise<void> {
    await this.ensureSchema();
    const rows = await executeRawSql(
      this.runtime,
      `SELECT thread_id
         FROM orchestrator_task_pending_decisions
        WHERE session_id = ${sqlQuote(sessionId)}
        LIMIT 1`,
    );
    if (rows.length === 0) return;
    const threadId = toText(rows[0]?.thread_id);
    await executeRawSql(
      this.runtime,
      `DELETE FROM orchestrator_task_pending_decisions
        WHERE session_id = ${sqlQuote(sessionId)}`,
    );
    if (threadId) {
      await executeRawSql(
        this.runtime,
        `UPDATE orchestrator_task_threads
            SET updated_at = ${sqlQuote(isoNow())}
          WHERE id = ${sqlQuote(threadId)}`,
      );
    }
  }

  async listPendingDecisions(): Promise<TaskPendingDecisionRecord[]> {
    await this.ensureSchema();
    const rows = await executeRawSql(
      this.runtime,
      `SELECT *
         FROM orchestrator_task_pending_decisions
        ORDER BY created_at ASC`,
    );
    return rows.map(parsePendingDecisionRow);
  }

  async getLastUsedRepo(): Promise<string | undefined> {
    await this.ensureSchema();
    const rows = await executeRawSql(
      this.runtime,
      `SELECT repo
         FROM orchestrator_task_sessions
        WHERE repo IS NOT NULL AND repo <> ''
        ORDER BY last_activity_at DESC
        LIMIT 1`,
    );
    return rows[0] ? toText(rows[0].repo) : undefined;
  }

  async listSessionsForThread(threadId: string): Promise<TaskSessionRecord[]> {
    const rows = await executeRawSql(
      this.runtime,
      `SELECT *
         FROM orchestrator_task_sessions
        WHERE thread_id = ${sqlQuote(threadId)}
        ORDER BY registered_at ASC`,
    );
    return rows.map(parseSessionRow);
  }

  async listDecisionsForThread(threadId: string): Promise<TaskDecisionRecord[]> {
    const rows = await executeRawSql(
      this.runtime,
      `SELECT *
         FROM orchestrator_task_decisions
        WHERE thread_id = ${sqlQuote(threadId)}
        ORDER BY timestamp ASC`,
    );
    return rows.map(parseDecisionRow);
  }

  async listDecisionsForSession(
    sessionId: string,
  ): Promise<TaskDecisionRecord[]> {
    const rows = await executeRawSql(
      this.runtime,
      `SELECT *
         FROM orchestrator_task_decisions
        WHERE session_id = ${sqlQuote(sessionId)}
        ORDER BY timestamp ASC`,
    );
    return rows.map(parseDecisionRow);
  }

  async listEventsForThread(threadId: string): Promise<TaskEventRecord[]> {
    const rows = await executeRawSql(
      this.runtime,
      `SELECT *
         FROM orchestrator_task_events
        WHERE thread_id = ${sqlQuote(threadId)}
        ORDER BY timestamp ASC`,
    );
    return rows.map(parseEventRow);
  }

  async listArtifactsForThread(
    threadId: string,
  ): Promise<TaskArtifactRecord[]> {
    const rows = await executeRawSql(
      this.runtime,
      `SELECT *
         FROM orchestrator_task_artifacts
        WHERE thread_id = ${sqlQuote(threadId)}
        ORDER BY created_at ASC`,
    );
    return rows.map(parseArtifactRow);
  }

  async listTranscriptsForThread(
    threadId: string,
  ): Promise<TaskTranscriptRecord[]> {
    const rows = await executeRawSql(
      this.runtime,
      `SELECT *
         FROM orchestrator_task_transcripts
        WHERE thread_id = ${sqlQuote(threadId)}
        ORDER BY timestamp ASC`,
    );
    return rows.map(parseTranscriptRow);
  }

  private async recomputeThreadStatus(threadId: string): Promise<void> {
    await this.ensureSchema();
    const thread = await this.getThreadRecord(threadId);
    if (!thread) return;
    if (thread.archivedAt) return;

    const sessions = await this.listSessionsForThread(threadId);
    const nowIso = isoNow();
    let nextStatus: TaskThreadStatus = "open";
    let closedAt: string | null = null;

    const activeCount = sessions.filter((session) =>
      ["active", "tool_running"].includes(session.status),
    ).length;
    const waitingOnUserCount = sessions.filter(
      (session) => session.status === "waiting_on_user",
    ).length;
    const blockedCount = sessions.filter((session) => session.status === "blocked").length;
    const interruptedCount = sessions.filter((session) =>
      ["interrupted", "stopped"].includes(session.status),
    ).length;
    const errorCount = sessions.filter((session) => session.status === "error").length;
    const completedCount = sessions.filter(
      (session) => session.status === "completed",
    ).length;

    if (sessions.length === 0) {
      nextStatus = "open";
    } else if (activeCount > 0) {
      nextStatus = "active";
    } else if (waitingOnUserCount > 0) {
      nextStatus = "waiting_on_user";
    } else if (blockedCount > 0) {
      nextStatus = "blocked";
    } else if (interruptedCount > 0) {
      nextStatus = "interrupted";
      closedAt = nowIso;
    } else if (completedCount === sessions.length) {
      nextStatus = "done";
      closedAt = nowIso;
    } else if (errorCount > 0) {
      nextStatus = "failed";
      closedAt = nowIso;
    }

    await executeRawSql(
      this.runtime,
      `UPDATE orchestrator_task_threads
          SET status = ${sqlQuote(nextStatus)},
              closed_at = ${sqlText(closedAt)},
              updated_at = ${sqlQuote(nowIso)}
        WHERE id = ${sqlQuote(threadId)}`,
    );
  }
}
