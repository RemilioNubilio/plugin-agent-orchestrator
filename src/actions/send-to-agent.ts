/**
 * SEND_TO_AGENT action - Send input to a running task agent.
 *
 * Allows sending text or commands to an active PTY session.
 * Useful for responding to prompts, providing feedback, or giving new instructions.
 *
 * @module actions/send-to-agent
 */

import type {
  Action,
  ActionResult,
  HandlerCallback,
  HandlerOptions,
  IAgentRuntime,
  Memory,
  State,
} from "@elizaos/core";
import type { PTYService } from "../services/pty-service.js";

export const sendToAgentAction: Action = {
  name: "SEND_TO_AGENT",

  similes: [
    "SEND_TO_CODING_AGENT",
    "MESSAGE_CODING_AGENT",
    "INPUT_TO_AGENT",
    "RESPOND_TO_AGENT",
    "TELL_CODING_AGENT",
    "MESSAGE_AGENT",
    "TELL_TASK_AGENT",
  ],

  description:
    "Send text input or key presses to a running task-agent session. " +
    "Use this to respond to agent prompts, provide feedback, or give new instructions.",

  examples: [
    [
      {
        name: "{{user1}}",
        content: { text: "Tell the running sub-agent to accept the changes" },
      },
      {
        name: "{{agentName}}",
        content: {
          text: "I'll send the approval to the task agent.",
          action: "SEND_TO_AGENT",
        },
      },
    ],
    [
      {
        name: "{{user1}}",
        content: { text: "Say yes to the agent prompt" },
      },
      {
        name: "{{agentName}}",
        content: {
          text: "Sending confirmation to the agent.",
          action: "SEND_TO_AGENT",
        },
      },
    ],
  ],

  validate: async (
    runtime: IAgentRuntime,
    _message: Memory,
  ): Promise<boolean> => {
    const ptyService = runtime.getService("PTY_SERVICE") as unknown as
      | PTYService
      | undefined;
    if (!ptyService) {
      return false;
    }
    // Fast-fail: listSessions() does a JSON-RPC call to the Node worker which
    // can take 30s to timeout when the worker is busy.  Cap at 2s so action
    // validation doesn't block the entire message pipeline.
    try {
      const sessions = await Promise.race([
        ptyService.listSessions(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("validate timeout")), 2000),
        ),
      ]);
      return sessions.length > 0;
    } catch {
      return false;
    }
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<ActionResult | undefined> => {
    const ptyService = runtime.getService("PTY_SERVICE") as unknown as
      | PTYService
      | undefined;
    if (!ptyService) {
      if (callback) {
        await callback({
          text: "PTY Service is not available.",
        });
      }
      return { success: false, error: "SERVICE_UNAVAILABLE" };
    }

    const params = options?.parameters as Record<string, unknown> | undefined;
    const content = message.content as {
      sessionId?: string;
      input?: string;
      keys?: string;
    };

    // Get session ID from content or state
    let sessionId = (params?.sessionId as string) ?? content.sessionId;
    if (!sessionId && state?.codingSession) {
      sessionId = (state.codingSession as { id: string }).id;
    }

    if (!sessionId) {
      // Try to find the most recent session
      const sessions = await ptyService.listSessions();
      if (sessions.length === 0) {
        if (callback) {
          await callback({
            text: "No active task-agent sessions. Spawn an agent first.",
          });
        }
        return { success: false, error: "NO_SESSION" };
      }
      sessionId = sessions[sessions.length - 1].id;
    }

    const session = ptyService.getSession(sessionId);
    if (!session) {
      if (callback) {
        await callback({
          text: `Session ${sessionId} not found.`,
        });
      }
      return { success: false, error: "SESSION_NOT_FOUND" };
    }

    try {
      const keys = (params?.keys as string) ?? content.keys;
      const input = (params?.input as string) ?? content.input;

      if (keys) {
        // Send special key sequence
        await ptyService.sendKeysToSession(sessionId, keys);
        if (callback) {
          await callback({
            text: "Sent key sequence to task agent.",
          });
        }
        return {
          success: true,
          text: "Sent key sequence",
          data: { sessionId, keys },
        };
      } else if (input) {
        // Send text input
        await ptyService.sendToSession(sessionId, input);
        if (callback) {
          await callback({
            text: `Sent to task agent: "${input}"`,
          });
        }
        return {
          success: true,
          text: "Sent input to agent",
          data: { sessionId, input },
        };
      } else {
        if (callback) {
          await callback({
            text: "No input provided. Specify 'input' or 'keys' parameter.",
          });
        }
        return { success: false, error: "NO_INPUT" };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (callback) {
        await callback({
          text: `Failed to send to agent: ${errorMessage}`,
        });
      }
      return { success: false, error: errorMessage };
    }
  },

  parameters: [
    {
      name: "sessionId",
      description:
        "ID of the task-agent session to send to. If not specified, uses the current session.",
      required: false,
      schema: { type: "string" as const },
    },
    {
      name: "input",
      description: "Text input to send to the running task agent.",
      required: false,
      schema: { type: "string" as const },
    },
    {
      name: "keys",
      description:
        "Special key sequence to send (e.g., 'Enter', 'Ctrl-C', 'y').",
      required: false,
      schema: { type: "string" as const },
    },
  ],
};

export const sendToTaskAgentAction = sendToAgentAction;
