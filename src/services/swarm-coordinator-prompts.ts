/**
 * Prompt construction and response parsing for the Swarm Coordinator's
 * LLM-driven coordination decisions.
 *
 * Pure functions — no side effects, easy to test.
 * Pattern follows stall-classifier.ts:buildStallClassificationPrompt().
 *
 * @module services/swarm-coordinator-prompts
 */

/** Per-session task context provided to the LLM for decision-making. */
export interface TaskContextSummary {
  sessionId: string;
  agentType: string;
  label: string;
  originalTask: string;
  workdir: string;
  repo?: string;
}

/** A previous coordination decision, included for context continuity. */
export interface DecisionHistoryEntry {
  event: string;
  promptText: string;
  action: string;
  response?: string;
  reasoning: string;
}

/** Parsed LLM response for a coordination decision. */
export interface CoordinationLLMResponse {
  action: "respond" | "escalate" | "ignore" | "complete";
  /** Text to send (for action=respond with plain text input). */
  response?: string;
  /** Whether to use sendKeysToSession instead of sendToSession. */
  useKeys?: boolean;
  /** Key sequence to send (for TUI interactions). e.g. ["enter"] or ["down","enter"]. */
  keys?: string[];
  /** LLM's reasoning for the decision. */
  reasoning: string;
}

/**
 * Build the LLM prompt for making a coordination decision about a blocked agent.
 */
export function buildCoordinationPrompt(
  taskCtx: TaskContextSummary,
  promptText: string,
  recentOutput: string,
  decisionHistory: DecisionHistoryEntry[],
): string {
  const historySection =
    decisionHistory.length > 0
      ? `\nPrevious decisions for this session:\n${decisionHistory
          .slice(-5)
          .map(
            (d, i) =>
              `  ${i + 1}. [${d.event}] prompt="${d.promptText}" → ${d.action}${d.response ? ` ("${d.response}")` : ""} — ${d.reasoning}`,
          )
          .join("\n")}\n`
      : "";

  return (
    `You are Milady, an AI orchestrator managing a swarm of coding agents. ` +
    `A ${taskCtx.agentType} coding agent ("${taskCtx.label}", session: ${taskCtx.sessionId}) ` +
    `is blocked and waiting for input.\n\n` +
    `Original task: "${taskCtx.originalTask}"\n` +
    `Working directory: ${taskCtx.workdir}\n` +
    `Repository: ${taskCtx.repo ?? "none (scratch directory)"}\n` +
    historySection +
    `\nRecent terminal output (last 50 lines):\n` +
    `---\n${recentOutput.slice(-3000)}\n---\n\n` +
    `The agent is showing this blocking prompt:\n` +
    `"${promptText}"\n\n` +
    `Decide how to respond. Your options:\n\n` +
    `1. "respond" — Send a response to unblock the agent. For text prompts (Y/n, questions), ` +
    `set "response" to the text to send. For TUI menus or interactive prompts that need ` +
    `special keys, set "useKeys": true and "keys" to the key sequence ` +
    `(e.g. ["enter"], ["down","enter"], ["y","enter"]).\n\n` +
    `2. "complete" — The original task has been fulfilled. The agent has finished its work ` +
    `(e.g. code written, PR created, tests passed) and is back at the idle prompt. ` +
    `Use this when the terminal output shows the task objectives have been met.\n\n` +
    `3. "escalate" — The prompt requires human judgment (e.g. design decisions, ` +
    `ambiguous requirements, security-sensitive actions). Do NOT respond yourself.\n\n` +
    `4. "ignore" — The prompt is not actually blocking or is already being handled.\n\n` +
    `Guidelines:\n` +
    `- IMPORTANT: If the prompt asks to approve access to files or directories OUTSIDE the working ` +
    `directory (${taskCtx.workdir}), DECLINE the request and REDIRECT the agent. Do NOT approve ` +
    `access to paths like /etc, ~/.ssh, ~/, /tmp, or any path that doesn't start with the working ` +
    `directory. Instead, respond with "n" (or the decline option) and tell the agent: ` +
    `"That path is outside your workspace. Use ${taskCtx.workdir} instead — ` +
    `create any files or directories you need there." This keeps the agent moving without ` +
    `granting out-of-scope access. The coordinator will also notify the human in case ` +
    `broader access was intended.\n` +
    `- For tool approval prompts (file writes, shell commands, etc.), respond "y" or use keys:["enter"] to approve.\n` +
    `- For Y/n confirmations that align with the original task, respond "y".\n` +
    `- For design questions or choices that could go either way, escalate.\n` +
    `- For error recovery prompts, try to respond if the path forward is clear.\n` +
    `- If the output shows a PR was just created (e.g. "Created pull request #N"), do NOT use "complete" yet. ` +
    `Instead respond with "Review your PR, run each test plan item to verify it works, update the PR to check off each item, then confirm all items pass".\n` +
    `- Only use "complete" if the agent confirmed it verified ALL test plan items after creating the PR.\n` +
    `- If the agent is asking for information that was NOT provided in the original task ` +
    `(e.g. which repository to use, project requirements, credentials), ESCALATE. ` +
    `The coordinator does not have this information — the human must provide it.\n` +
    `- When in doubt, escalate — it's better to ask the human than to make a wrong choice.\n\n` +
    `Respond with ONLY a JSON object:\n` +
    `{"action": "respond|complete|escalate|ignore", "response": "...", "useKeys": false, "keys": [], "reasoning": "..."}`
  );
}

/**
 * Build the LLM prompt for checking on an idle session that hasn't
 * produced any events for a while.
 */
export function buildIdleCheckPrompt(
  taskCtx: TaskContextSummary,
  recentOutput: string,
  idleMinutes: number,
  idleCheckNumber: number,
  maxIdleChecks: number,
  decisionHistory: DecisionHistoryEntry[],
): string {
  const historySection =
    decisionHistory.length > 0
      ? `\nPrevious decisions for this session:\n${decisionHistory
          .slice(-5)
          .map(
            (d, i) =>
              `  ${i + 1}. [${d.event}] prompt="${d.promptText}" → ${d.action}${d.response ? ` ("${d.response}")` : ""} — ${d.reasoning}`,
          )
          .join("\n")}\n`
      : "";

  return (
    `You are Milady, an AI orchestrator managing a swarm of coding agents. ` +
    `A ${taskCtx.agentType} coding agent ("${taskCtx.label}", session: ${taskCtx.sessionId}) ` +
    `has been idle for ${idleMinutes} minutes with no events or output changes.\n\n` +
    `Original task: "${taskCtx.originalTask}"\n` +
    `Working directory: ${taskCtx.workdir}\n` +
    `Repository: ${taskCtx.repo ?? "none (scratch directory)"}\n` +
    `Idle check: ${idleCheckNumber} of ${maxIdleChecks} (session will be force-escalated after ${maxIdleChecks})\n` +
    historySection +
    `\nRecent terminal output (last 50 lines):\n` +
    `---\n${recentOutput.slice(-3000)}\n---\n\n` +
    `The session has gone silent. Analyze the terminal output and decide:\n\n` +
    `1. "complete" — The task is FULLY done. ALL objectives in the original task were met ` +
    `AND the final deliverable is visible in the output (e.g. a PR URL was printed, or the ` +
    `task explicitly did not require a PR). The agent is back at the idle prompt.\n\n` +
    `2. "respond" — The agent appears stuck or waiting for input that wasn't detected ` +
    `as a blocking prompt. Send a message to nudge it (e.g. "continue", or answer a question ` +
    `visible in the output). If code was committed but no PR was created yet, respond with ` +
    `"please create a pull request with your changes" or similar.\n\n` +
    `3. "escalate" — Something looks wrong or unclear. The human should review.\n\n` +
    `4. "ignore" — The agent is still actively working (e.g. compiling, running tests, ` +
    `pushing to remote, creating a PR). The idle period is expected and it will produce output soon.\n\n` +
    `Guidelines:\n` +
    `- IMPORTANT: Do NOT mark "complete" if the original task involves creating a PR and no PR URL ` +
    `(e.g. github.com/...pull/...) appears in the output. Instead use "respond" to nudge the agent ` +
    `to create the PR.\n` +
    `- Do NOT mark "complete" just because code was committed — commits alone don't finish a task ` +
    `that requires a PR.\n` +
    `- Network operations (git push, gh pr create, API calls) can cause several minutes of silence — ` +
    `prefer "ignore" for early idle checks if the agent was mid-workflow.\n` +
    `- If the output ends with a command prompt ($ or >) and ALL task objectives are confirmed met, use "complete".\n` +
    `- If the output shows an error or the agent seems stuck in a loop, escalate.\n` +
    `- If the agent is clearly mid-operation (build output, test runner, git operations), use "ignore".\n` +
    `- On check ${idleCheckNumber} of ${maxIdleChecks} — if unsure, lean toward "respond" with a nudge rather than "complete".\n\n` +
    `Respond with ONLY a JSON object:\n` +
    `{"action": "respond|complete|escalate|ignore", "response": "...", "useKeys": false, "keys": [], "reasoning": "..."}`
  );
}

/**
 * Build the LLM prompt for assessing whether a completed turn means the
 * overall task is done, or if the agent needs more turns.
 *
 * Called when the adapter detects "task_complete" (agent finished a turn and
 * returned to the idle prompt). The LLM decides whether to stop the session
 * or send a follow-up instruction.
 */
export function buildTurnCompletePrompt(
  taskCtx: TaskContextSummary,
  turnOutput: string,
  decisionHistory: DecisionHistoryEntry[],
): string {
  const historySection =
    decisionHistory.length > 0
      ? `\nPrevious decisions for this session:\n${decisionHistory
          .slice(-5)
          .map(
            (d, i) =>
              `  ${i + 1}. [${d.event}] prompt="${d.promptText}" → ${d.action}${d.response ? ` ("${d.response}")` : ""} — ${d.reasoning}`,
          )
          .join("\n")}\n`
      : "";

  return (
    `You are Milady, an AI orchestrator managing a swarm of coding agents. ` +
    `A ${taskCtx.agentType} coding agent ("${taskCtx.label}", session: ${taskCtx.sessionId}) ` +
    `just finished a turn and is back at the idle prompt waiting for input.\n\n` +
    `Original task: "${taskCtx.originalTask}"\n` +
    `Working directory: ${taskCtx.workdir}\n` +
    `Repository: ${taskCtx.repo ?? "none (scratch directory)"}\n` +
    historySection +
    `\nOutput from this turn:\n` +
    `---\n${turnOutput.slice(-3000)}\n---\n\n` +
    `The agent completed a turn. Decide if the OVERALL task is done or if more work is needed.\n\n` +
    `IMPORTANT: Coding agents work in multiple turns. A single turn completing does NOT mean ` +
    `the task is done. You must verify that EVERY objective in the original task has been addressed ` +
    `in the output before declaring "complete".\n\n` +
    `Your options:\n\n` +
    `1. "respond" — The agent finished a step but the overall task is NOT done yet. ` +
    `Send a follow-up instruction to continue. Set "response" to the next instruction ` +
    `(e.g. "Now run the tests", "Create a PR with these changes", "Continue with the next part"). ` +
    `THIS IS THE DEFAULT — most turns are intermediate steps, not the final result.\n\n` +
    `2. "complete" — The original task objectives have ALL been fully met. For repo-based tasks, ` +
    `this means code was written, changes were committed, pushed, AND a pull request was created. ` +
    `Only use this when you can point to specific evidence in the output for EVERY objective ` +
    `(e.g. "Created pull request #N" in the output).\n\n` +
    `3. "escalate" — Something looks wrong or you're unsure whether the task is complete. ` +
    `Let the human decide.\n\n` +
    `4. "ignore" — Should not normally be used here.\n\n` +
    `Guidelines:\n` +
    `- BEFORE choosing "complete", enumerate each objective from the original task and verify ` +
    `evidence in the output. If ANY objective lacks evidence, use "respond" with the missing work.\n` +
    `- A PR being created does NOT mean the task is done — check that the PR covers ALL requested changes.\n` +
    `- If the task mentions multiple features/fixes, verify EACH one is addressed, not just the first.\n` +
    `- If the agent only analyzed code or read files, it hasn't done the actual work yet — send a follow-up.\n` +
    `- If the agent wrote code but didn't test it and testing seems appropriate, ask it to run tests.\n` +
    `- If the output shows errors or failed tests, send a follow-up to fix them.\n` +
    `- IMPORTANT: If the working directory is a git repository clone (not a scratch dir), the agent ` +
    `MUST commit its changes, push them, and create a pull request before the task can be "complete". ` +
    `If the output only shows code edits with no git commit or PR, respond with "Now commit your changes, push, and create a pull request".\n` +
    `- CRITICAL: Creating a PR is NEVER the final step. After you see "Created pull request" or a PR URL ` +
    `in the output, you MUST respond with "Review your PR, run each test plan item to verify it works, ` +
    `update the PR to check off each item, then confirm all items pass". NEVER mark as "complete" on the ` +
    `same turn that a PR was created — always send this follow-up first.\n` +
    `- Only mark as "complete" AFTER the agent has confirmed it verified the test plan items ` +
    `(look for output like "all items pass", "verified", "checked off", or similar confirmation).\n` +
    `- Keep follow-up instructions concise and specific.\n` +
    `- Default to "respond" — only use "complete" when you're certain ALL work is done.\n\n` +
    `Respond with ONLY a JSON object:\n` +
    `{"action": "respond|complete|escalate|ignore", "response": "...", "useKeys": false, "keys": [], "reasoning": "..."}`
  );
}

/**
 * Parse the LLM's coordination response from raw text output.
 * Returns null if the response is invalid or unparseable.
 */
export function parseCoordinationResponse(
  llmOutput: string,
): CoordinationLLMResponse | null {
  const jsonMatch = llmOutput.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]);

    const validActions = ["respond", "escalate", "ignore", "complete"];
    if (!validActions.includes(parsed.action)) return null;

    const result: CoordinationLLMResponse = {
      action: parsed.action,
      reasoning: parsed.reasoning || "No reasoning provided",
    };

    if (parsed.action === "respond") {
      if (parsed.useKeys && Array.isArray(parsed.keys)) {
        result.useKeys = true;
        result.keys = parsed.keys.map(String);
      } else if (typeof parsed.response === "string") {
        result.response = parsed.response;
      } else {
        // respond action but no response or keys — invalid
        return null;
      }
    }

    return result;
  } catch {
    return null;
  }
}
