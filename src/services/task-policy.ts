import type { IAgentRuntime, Memory } from "@elizaos/core";

type RoleName = "OWNER" | "ADMIN" | "USER" | "GUEST";
type TaskAgentAbility = "create" | "interact";
type ConnectorPolicy = Partial<Record<TaskAgentAbility, RoleName>>;
type TaskAgentPolicyConfig = {
  default?: RoleName | ConnectorPolicy;
  connectors?: Record<string, RoleName | ConnectorPolicy>;
};

const ROLE_RANK: Record<RoleName, number> = {
  GUEST: 0,
  USER: 1,
  ADMIN: 2,
  OWNER: 3,
};

const DEFAULT_POLICY: TaskAgentPolicyConfig = {
  default: "GUEST",
  connectors: {
    discord: {
      create: "ADMIN",
      interact: "ADMIN",
    },
  },
};

type RoleCheckResult = {
  role: RoleName;
  isAdmin: boolean;
  isOwner: boolean;
};

function normalizeRole(value: unknown): RoleName {
  const upper = typeof value === "string" ? value.trim().toUpperCase() : "";
  switch (upper) {
    case "OWNER":
    case "ADMIN":
    case "USER":
      return upper;
    default:
      return "GUEST";
  }
}

function normalizeConnectorPolicy(
  value: RoleName | ConnectorPolicy | undefined,
): ConnectorPolicy {
  if (!value) return {};
  if (typeof value === "string") {
    const role = normalizeRole(value);
    return {
      create: role,
      interact: role,
    };
  }
  return {
    ...(value.create ? { create: normalizeRole(value.create) } : {}),
    ...(value.interact ? { interact: normalizeRole(value.interact) } : {}),
  };
}

function parseTaskAgentPolicy(runtime: IAgentRuntime): TaskAgentPolicyConfig {
  const configured =
    runtime.getSetting("TASK_AGENT_ROLE_POLICY") ??
    runtime.getSetting("TASK_AGENT_CONNECTOR_ROLE_POLICY");

  if (!configured) {
    return DEFAULT_POLICY;
  }

  let parsed: unknown = configured;
  if (typeof configured === "string") {
    try {
      parsed = JSON.parse(configured);
    } catch {
      return DEFAULT_POLICY;
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return DEFAULT_POLICY;
  }

  const record = parsed as Record<string, unknown>;
  const connectors =
    record.connectors && typeof record.connectors === "object" && !Array.isArray(record.connectors)
      ? Object.fromEntries(
          Object.entries(record.connectors as Record<string, unknown>).map(
            ([connector, value]) => [connector, normalizeConnectorPolicy(value as RoleName | ConnectorPolicy)],
          ),
        )
      : DEFAULT_POLICY.connectors;

  return {
    default: normalizeConnectorPolicy(
      (record.default ?? DEFAULT_POLICY.default) as RoleName | ConnectorPolicy,
    ),
    connectors,
  };
}

function getConnectorFromBridgeMetadata(
  message: Memory,
): string | null {
  const metadata = (message.content as Record<string, unknown> | undefined)?.metadata;
  if (!metadata || typeof metadata !== "object") return null;
  const bridgeSender = (metadata as Record<string, unknown>).bridgeSender;
  if (!bridgeSender || typeof bridgeSender !== "object") return null;
  const liveMetadata = (bridgeSender as Record<string, unknown>).metadata;
  if (!liveMetadata || typeof liveMetadata !== "object") return null;

  for (const [connector, value] of Object.entries(
    liveMetadata as Record<string, unknown>,
  )) {
    if (value && typeof value === "object") {
      return connector;
    }
  }
  return null;
}

async function resolveConnectorSource(
  runtime: IAgentRuntime,
  message: Memory,
): Promise<string | null> {
  const content = message.content as Record<string, unknown> | undefined;
  const directSource =
    typeof content?.source === "string" && content.source !== "client_chat"
      ? content.source
      : null;
  if (directSource) return directSource;

  const bridgeSource = getConnectorFromBridgeMetadata(message);
  if (bridgeSource) return bridgeSource;

  try {
    const room = await runtime.getRoom(message.roomId);
    if (typeof room?.source === "string" && room.source.trim().length > 0) {
      return room.source;
    }
  } catch {
    // Ignore room lookup failures and fall through to null.
  }

  return null;
}

async function resolveSenderRole(
  runtime: IAgentRuntime,
  message: Memory,
): Promise<RoleCheckResult | null> {
  try {
    const rolesModule = (await import("@miladyai/plugin-roles")) as {
      checkSenderRole?: (
        runtime: IAgentRuntime,
        message: Memory,
      ) => Promise<RoleCheckResult | null>;
    };
    if (typeof rolesModule.checkSenderRole !== "function") {
      return null;
    }
    return await rolesModule.checkSenderRole(runtime, message);
  } catch {
    return null;
  }
}

export async function requireTaskAgentAccess(
  runtime: IAgentRuntime,
  message: Memory,
  ability: TaskAgentAbility,
): Promise<
  | { allowed: true; connector: string | null; requiredRole: RoleName; actualRole: RoleName }
  | { allowed: false; connector: string | null; requiredRole: RoleName; actualRole: RoleName; reason: string }
> {
  if (message.entityId === runtime.agentId) {
    return {
      allowed: true,
      connector: null,
      requiredRole: "GUEST",
      actualRole: "OWNER",
    };
  }

  const connector = await resolveConnectorSource(runtime, message);
  const policy = parseTaskAgentPolicy(runtime);
  const connectorPolicy = connector
    ? normalizeConnectorPolicy(policy.connectors?.[connector])
    : {};
  const defaultPolicy = normalizeConnectorPolicy(policy.default as RoleName | ConnectorPolicy);
  const requiredRole = connectorPolicy[ability] ?? defaultPolicy[ability] ?? "GUEST";

  if (requiredRole === "GUEST") {
    return {
      allowed: true,
      connector,
      requiredRole,
      actualRole: "GUEST",
    };
  }

  const roleCheck = await resolveSenderRole(runtime, message);
  if (!roleCheck) {
    return {
      allowed: false,
      connector,
      requiredRole,
      actualRole: "GUEST",
      reason:
        connector === "discord"
          ? "Task-agent access in Discord requires a verified OWNER or ADMIN role."
          : "Task-agent access requires a verified role, but role context is unavailable.",
    };
  }

  const actualRole = normalizeRole(roleCheck.role);
  if (ROLE_RANK[actualRole] < ROLE_RANK[requiredRole]) {
    return {
      allowed: false,
      connector,
      requiredRole,
      actualRole,
      reason:
        connector === "discord"
          ? `Task-agent access in Discord requires ${requiredRole} or higher. Current role: ${actualRole}.`
          : `Task-agent access requires ${requiredRole} or higher. Current role: ${actualRole}.`,
    };
  }

  return {
    allowed: true,
    connector,
    requiredRole,
    actualRole,
  };
}
