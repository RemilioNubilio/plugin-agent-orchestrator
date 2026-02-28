import {createRequire} from "node:module";
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: (newValue) => all[name] = () => newValue
    });
};
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// src/services/ansi-utils.ts
function applyAnsiStrip(input) {
  return input.replace(/(\[[\d;]*)\r?\n([\d;]*m)/g, "$1$2").replace(CURSOR_MOVEMENT, " ").replace(CURSOR_POSITION, " ").replace(ERASE, "").replace(OSC, "").replace(ALL_ANSI, "").replace(CONTROL_CHARS, "").replace(ORPHAN_SGR, "").replace(LONG_SPACES, " ").trim();
}
function stripAnsi(raw) {
  return applyAnsiStrip(raw);
}
function cleanForChat(raw) {
  const stripped = applyAnsiStrip(raw);
  return stripped.replace(TUI_DECORATIVE, " ").replace(/\xa0/g, " ").split("\n").filter((line) => {
    const trimmed = line.trim();
    if (!trimmed)
      return false;
    if (LOADING_LINE.test(trimmed))
      return false;
    if (STATUS_LINE.test(trimmed))
      return false;
    if (!/[a-zA-Z0-9]/.test(trimmed))
      return false;
    return true;
  }).map((line) => line.replace(/ {2,}/g, " ").trim()).filter((line) => line.length > 0).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
function extractCompletionSummary(raw) {
  const stripped = applyAnsiStrip(raw);
  const lines = [];
  const prUrls = stripped.match(/https?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/g);
  if (prUrls) {
    for (const url of [...new Set(prUrls)])
      lines.push(url);
  }
  const prCreated = stripped.match(/(?:Created|Opened)\s+pull\s+request\s+#\d+[^\n]*/gi);
  if (prCreated && !prUrls) {
    for (const m of prCreated)
      lines.push(m.trim());
  }
  const commits = stripped.match(/(?:committed|commit)\s+[a-f0-9]{7,40}/gi);
  if (commits) {
    for (const m of [...new Set(commits)])
      lines.push(m.trim());
  }
  const diffStat = stripped.match(/\d+\s+files?\s+changed.*?(?:insertion|deletion)[^\n]*/gi);
  if (diffStat) {
    for (const m of diffStat)
      lines.push(m.trim());
  }
  return lines.join("\n");
}
function extractDevServerUrl(raw) {
  const stripped = applyAnsiStrip(raw);
  const match = stripped.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d{1,5}[^\s)}\]'"`,]*/);
  return match ? match[0] : null;
}
function captureTaskResponse(sessionId, buffers, markers) {
  const buffer = buffers.get(sessionId);
  const marker = markers.get(sessionId);
  if (!buffer || marker === undefined)
    return "";
  const responseLines = buffer.slice(marker);
  markers.delete(sessionId);
  return cleanForChat(responseLines.join("\n"));
}
var CURSOR_MOVEMENT, CURSOR_POSITION, ERASE, OSC, ALL_ANSI, CONTROL_CHARS, ORPHAN_SGR, LONG_SPACES, TUI_DECORATIVE, LOADING_LINE, STATUS_LINE;
var init_ansi_utils = __esm(() => {
  CURSOR_MOVEMENT = /\x1b\[\d*[CDABGdEF]/g;
  CURSOR_POSITION = /\x1b\[\d*(?:;\d+)?[Hf]/g;
  ERASE = /\x1b\[\d*[JK]/g;
  OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
  ALL_ANSI = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
  CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
  ORPHAN_SGR = /\[[\d;]*m/g;
  LONG_SPACES = / {3,}/g;
  TUI_DECORATIVE = /[│╭╰╮╯─═╌║╔╗╚╝╠╣╦╩╬┌┐└┘├┤┬┴┼●○❮❯▶◀⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⣾⣽⣻⢿⡿⣟⣯⣷✽✻✶✳✢⏺←→↑↓⬆⬇◆▪▫■□▲△▼▽◈⟨⟩⌘⏎⏏⌫⌦⇧⇪⌥·⎿✔◼]/g;
  LOADING_LINE = /^\s*(?:thinking|Forging|Shenaniganing|Inferring|Cooking|Brewing|Loading|Scheming|Pondering|Conjuring|Manifesting|Reflecting|Synthesizing|Vibing|Summoning|Compiling|processing|Elucidating|Cogitat\w+|Bak\w+)(?:…|\.{3})?(?:\s*\(.*\))?\s*$/i;
  STATUS_LINE = /^\s*(?:\d+[smh]\s+\d+s?\s*·|↓\s*[\d.]+k?\s*tokens|·\s*↓|esc\s+to\s+interrupt|[Uu]pdate available|ate available|Run:\s+brew|brew\s+upgrade|\d+\s+files?\s+\+\d+\s+-\d+|ctrl\+\w|\+\d+\s+lines|Wrote\s+\d+\s+lines\s+to|\?\s+for\s+shortcuts|Cooked for|Baked for|Cogitated for)/i;
});

// src/services/swarm-coordinator-prompts.ts
function buildCoordinationPrompt(taskCtx, promptText, recentOutput, decisionHistory) {
  const historySection = decisionHistory.length > 0 ? `\nPrevious decisions for this session:\n${decisionHistory.slice(-5).map((d, i) => `  ${i + 1}. [${d.event}] prompt="${d.promptText}" \u2192 ${d.action}${d.response ? ` ("${d.response}")` : ""} \u2014 ${d.reasoning}`).join("\n")}\n` : "";
  return `You are Milady, an AI orchestrator managing a swarm of coding agents. ` + `A ${taskCtx.agentType} coding agent ("${taskCtx.label}", session: ${taskCtx.sessionId}) ` + `is blocked and waiting for input.\n\n` + `Original task: "${taskCtx.originalTask}"\n` + `Working directory: ${taskCtx.workdir}\n` + `Repository: ${taskCtx.repo ?? "none (scratch directory)"}\n` + historySection + `\nRecent terminal output (last 50 lines):\n` + `---\n${recentOutput.slice(-3000)}\n---\n\n` + `The agent is showing this blocking prompt:\n` + `"${promptText}"\n\n` + `Decide how to respond. Your options:\n\n` + `1. "respond" \u2014 Send a response to unblock the agent. For text prompts (Y/n, questions), ` + `set "response" to the text to send. For TUI menus or interactive prompts that need ` + `special keys, set "useKeys": true and "keys" to the key sequence ` + `(e.g. ["enter"], ["down","enter"], ["y","enter"]).\n\n` + `2. "complete" \u2014 The original task has been fulfilled. The agent has finished its work ` + `(e.g. code written, PR created, tests passed) and is back at the idle prompt. ` + `Use this when the terminal output shows the task objectives have been met.\n\n` + `3. "escalate" \u2014 The prompt requires human judgment (e.g. design decisions, ` + `ambiguous requirements, security-sensitive actions). Do NOT respond yourself.\n\n` + `4. "ignore" \u2014 The prompt is not actually blocking or is already being handled.

` + `Guidelines:\n` + `- IMPORTANT: If the prompt asks to approve access to files or directories OUTSIDE the working ` + `directory (${taskCtx.workdir}), DECLINE the request and REDIRECT the agent. Do NOT approve ` + `access to paths like /etc, ~/.ssh, ~/, /tmp, or any path that doesn't start with the working ` + `directory. Instead, respond with "n" (or the decline option) and tell the agent: ` + `"That path is outside your workspace. Use ${taskCtx.workdir} instead \u2014 ` + `create any files or directories you need there." This keeps the agent moving without ` + `granting out-of-scope access. The coordinator will also notify the human in case ` + `broader access was intended.\n` + `- For tool approval prompts (file writes, shell commands, etc.), respond "y" or use keys:["enter"] to approve.\n` + `- For Y/n confirmations that align with the original task, respond "y".\n` + `- For design questions or choices that could go either way, escalate.\n` + `- For error recovery prompts, try to respond if the path forward is clear.\n` + `- If the output shows a PR was just created (e.g. "Created pull request #N"), do NOT use "complete" yet. ` + `Instead respond with "Review your PR, run each test plan item to verify it works, update the PR to check off each item, then confirm all items pass".\n` + `- Only use "complete" if the agent confirmed it verified ALL test plan items after creating the PR.\n` + `- If the agent is asking for information that was NOT provided in the original task ` + `(e.g. which repository to use, project requirements, credentials), ESCALATE. ` + `The coordinator does not have this information \u2014 the human must provide it.
` + `- When in doubt, escalate \u2014 it's better to ask the human than to make a wrong choice.

` + `Respond with ONLY a JSON object:\n` + `{"action": "respond|complete|escalate|ignore", "response": "...", "useKeys": false, "keys": [], "reasoning": "..."}`;
}
function buildIdleCheckPrompt(taskCtx, recentOutput, idleMinutes, idleCheckNumber, maxIdleChecks, decisionHistory) {
  const historySection = decisionHistory.length > 0 ? `\nPrevious decisions for this session:\n${decisionHistory.slice(-5).map((d, i) => `  ${i + 1}. [${d.event}] prompt="${d.promptText}" \u2192 ${d.action}${d.response ? ` ("${d.response}")` : ""} \u2014 ${d.reasoning}`).join("\n")}\n` : "";
  return `You are Milady, an AI orchestrator managing a swarm of coding agents. ` + `A ${taskCtx.agentType} coding agent ("${taskCtx.label}", session: ${taskCtx.sessionId}) ` + `has been idle for ${idleMinutes} minutes with no events or output changes.\n\n` + `Original task: "${taskCtx.originalTask}"\n` + `Working directory: ${taskCtx.workdir}\n` + `Repository: ${taskCtx.repo ?? "none (scratch directory)"}\n` + `Idle check: ${idleCheckNumber} of ${maxIdleChecks} (session will be force-escalated after ${maxIdleChecks})\n` + historySection + `\nRecent terminal output (last 50 lines):\n` + `---\n${recentOutput.slice(-3000)}\n---\n\n` + `The session has gone silent. Analyze the terminal output and decide:\n\n` + `1. "complete" \u2014 The task is FULLY done. ALL objectives in the original task were met ` + `AND the final deliverable is visible in the output (e.g. a PR URL was printed, or the ` + `task explicitly did not require a PR). The agent is back at the idle prompt.\n\n` + `2. "respond" \u2014 The agent appears stuck or waiting for input that wasn't detected ` + `as a blocking prompt. Send a message to nudge it (e.g. "continue", or answer a question ` + `visible in the output). If code was committed but no PR was created yet, respond with ` + `"please create a pull request with your changes" or similar.\n\n` + `3. "escalate" \u2014 Something looks wrong or unclear. The human should review.

` + `4. "ignore" \u2014 The agent is still actively working (e.g. compiling, running tests, ` + `pushing to remote, creating a PR). The idle period is expected and it will produce output soon.\n\n` + `Guidelines:\n` + `- IMPORTANT: Do NOT mark "complete" if the original task involves creating a PR and no PR URL ` + `(e.g. github.com/...pull/...) appears in the output. Instead use "respond" to nudge the agent ` + `to create the PR.\n` + `- Do NOT mark "complete" just because code was committed \u2014 commits alone don't finish a task ` + `that requires a PR.\n` + `- Network operations (git push, gh pr create, API calls) can cause several minutes of silence \u2014 ` + `prefer "ignore" for early idle checks if the agent was mid-workflow.\n` + `- If the output ends with a command prompt (\$ or >) and ALL task objectives are confirmed met, use "complete".\n` + `- If the output shows an error or the agent seems stuck in a loop, escalate.\n` + `- If the agent is clearly mid-operation (build output, test runner, git operations), use "ignore".\n` + `- On check ${idleCheckNumber} of ${maxIdleChecks} \u2014 if unsure, lean toward "respond" with a nudge rather than "complete".

` + `Respond with ONLY a JSON object:\n` + `{"action": "respond|complete|escalate|ignore", "response": "...", "useKeys": false, "keys": [], "reasoning": "..."}`;
}
function buildTurnCompletePrompt(taskCtx, turnOutput, decisionHistory) {
  const historySection = decisionHistory.length > 0 ? `\nPrevious decisions for this session:\n${decisionHistory.slice(-5).map((d, i) => `  ${i + 1}. [${d.event}] prompt="${d.promptText}" \u2192 ${d.action}${d.response ? ` ("${d.response}")` : ""} \u2014 ${d.reasoning}`).join("\n")}\n` : "";
  return `You are Milady, an AI orchestrator managing a swarm of coding agents. ` + `A ${taskCtx.agentType} coding agent ("${taskCtx.label}", session: ${taskCtx.sessionId}) ` + `just finished a turn and is back at the idle prompt waiting for input.\n\n` + `Original task: "${taskCtx.originalTask}"\n` + `Working directory: ${taskCtx.workdir}\n` + historySection + `\nOutput from this turn:\n` + `---\n${turnOutput.slice(-3000)}\n---\n\n` + `The agent completed a turn. Decide if the OVERALL task is done or if more work is needed.\n\n` + `IMPORTANT: Coding agents work in multiple turns. A single turn completing does NOT mean ` + `the task is done. You must verify that EVERY objective in the original task has been addressed ` + `in the output before declaring "complete".\n\n` + `Your options:\n\n` + `1. "respond" \u2014 The agent finished a step but the overall task is NOT done yet. ` + `Send a follow-up instruction to continue. Set "response" to the next instruction ` + `(e.g. "Now run the tests", "Create a PR with these changes", "Continue with the next part"). ` + `THIS IS THE DEFAULT \u2014 most turns are intermediate steps, not the final result.

` + `2. "complete" \u2014 The original task objectives have ALL been fully met. For repo-based tasks, ` + `this means code was written, changes were committed, pushed, AND a pull request was created. ` + `Only use this when you can point to specific evidence in the output for EVERY objective ` + `(e.g. "Created pull request #N" in the output).\n\n` + `3. "escalate" \u2014 Something looks wrong or you're unsure whether the task is complete. ` + `Let the human decide.\n\n` + `4. "ignore" \u2014 Should not normally be used here.

` + `Guidelines:\n` + `- BEFORE choosing "complete", enumerate each objective from the original task and verify ` + `evidence in the output. If ANY objective lacks evidence, use "respond" with the missing work.\n` + `- A PR being created does NOT mean the task is done \u2014 check that the PR covers ALL requested changes.
` + `- If the task mentions multiple features/fixes, verify EACH one is addressed, not just the first.\n` + `- If the agent only analyzed code or read files, it hasn't done the actual work yet \u2014 send a follow-up.
` + `- If the agent wrote code but didn't test it and testing seems appropriate, ask it to run tests.\n` + `- If the output shows errors or failed tests, send a follow-up to fix them.\n` + `- IMPORTANT: If the working directory is a git repository clone (not a scratch dir), the agent ` + `MUST commit its changes, push them, and create a pull request before the task can be "complete". ` + `If the output only shows code edits with no git commit or PR, respond with "Now commit your changes, push, and create a pull request".\n` + `- CRITICAL: Creating a PR is NEVER the final step. After you see "Created pull request" or a PR URL ` + `in the output, you MUST respond with "Review your PR, run each test plan item to verify it works, ` + `update the PR to check off each item, then confirm all items pass". NEVER mark as "complete" on the ` + `same turn that a PR was created \u2014 always send this follow-up first.
` + `- Only mark as "complete" AFTER the agent has confirmed it verified the test plan items ` + `(look for output like "all items pass", "verified", "checked off", or similar confirmation).\n` + `- Keep follow-up instructions concise and specific.\n` + `- Default to "respond" \u2014 only use "complete" when you're certain ALL work is done.

` + `Respond with ONLY a JSON object:\n` + `{"action": "respond|complete|escalate|ignore", "response": "...", "useKeys": false, "keys": [], "reasoning": "..."}`;
}
function parseCoordinationResponse(llmOutput) {
  const jsonMatch = llmOutput.match(/\{[\s\S]*\}/);
  if (!jsonMatch)
    return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const validActions = ["respond", "escalate", "ignore", "complete"];
    if (!validActions.includes(parsed.action))
      return null;
    const result = {
      action: parsed.action,
      reasoning: parsed.reasoning || "No reasoning provided"
    };
    if (parsed.action === "respond") {
      if (parsed.useKeys && Array.isArray(parsed.keys)) {
        result.useKeys = true;
        result.keys = parsed.keys.map(String);
      } else if (typeof parsed.response === "string") {
        result.response = parsed.response;
      } else {
        return null;
      }
    }
    return result;
  } catch {
    return null;
  }
}

// src/services/swarm-decision-loop.ts
var exports_swarm_decision_loop = {};
__export(exports_swarm_decision_loop, {
  makeCoordinationDecision: () => makeCoordinationDecision,
  isOutOfScopeAccess: () => isOutOfScopeAccess,
  handleTurnComplete: () => handleTurnComplete,
  handleConfirmDecision: () => handleConfirmDecision,
  handleBlocked: () => handleBlocked,
  handleAutonomousDecision: () => handleAutonomousDecision,
  executeDecision: () => executeDecision
});
import * as path from "node:path";
import {ModelType as ModelType2} from "@elizaos/core";
function toContextSummary(taskCtx) {
  return {
    sessionId: taskCtx.sessionId,
    agentType: taskCtx.agentType,
    label: taskCtx.label,
    originalTask: taskCtx.originalTask,
    workdir: taskCtx.workdir,
    repo: taskCtx.repo
  };
}
function toDecisionHistory(taskCtx) {
  return taskCtx.decisions.filter((d) => d.decision !== "auto_resolved").slice(-5).map((d) => ({
    event: d.event,
    promptText: d.promptText,
    action: d.decision,
    response: d.response,
    reasoning: d.reasoning
  }));
}
function formatDecisionResponse(decision) {
  if (decision.action !== "respond")
    return;
  return decision.useKeys ? `keys:${decision.keys?.join(",")}` : decision.response;
}
function isOutOfScopeAccess(promptText, workdir) {
  const pathPattern = /\/[\w.-]+(?:\/[\w.-]+)+/g;
  const matches = promptText.match(pathPattern);
  if (!matches)
    return false;
  const resolvedWorkdir = path.resolve(workdir);
  return matches.some((p) => {
    const resolved = path.resolve(p);
    return !resolved.startsWith(resolvedWorkdir + path.sep) && resolved !== resolvedWorkdir;
  });
}
async function fetchRecentOutput(ctx, sessionId, lines = 50) {
  if (!ctx.ptyService)
    return "";
  try {
    return await ctx.ptyService.getSessionOutput(sessionId, lines);
  } catch {
    return "";
  }
}
async function makeCoordinationDecision(ctx, taskCtx, promptText, recentOutput) {
  const prompt = buildCoordinationPrompt(toContextSummary(taskCtx), promptText, recentOutput, toDecisionHistory(taskCtx));
  try {
    const result = await ctx.runtime.useModel(ModelType2.TEXT_SMALL, {
      prompt
    });
    return parseCoordinationResponse(result);
  } catch (err) {
    ctx.log(`LLM coordination call failed: ${err}`);
    return null;
  }
}
async function executeDecision(ctx, sessionId, decision) {
  if (!ctx.ptyService)
    return;
  switch (decision.action) {
    case "respond":
      if (decision.useKeys && decision.keys) {
        await ctx.ptyService.sendKeysToSession(sessionId, decision.keys);
      } else if (decision.response !== undefined) {
        await ctx.ptyService.sendToSession(sessionId, decision.response);
      }
      break;
    case "complete": {
      const taskCtx = ctx.tasks.get(sessionId);
      if (taskCtx) {
        taskCtx.status = "completed";
      }
      ctx.broadcast({
        type: "task_complete",
        sessionId,
        timestamp: Date.now(),
        data: { reasoning: decision.reasoning }
      });
      let summary = "";
      try {
        const rawOutput = await ctx.ptyService.getSessionOutput(sessionId, 50);
        summary = extractCompletionSummary(rawOutput);
      } catch {
      }
      ctx.sendChatMessage(summary ? `Finished "${taskCtx?.label ?? sessionId}".\n\n${summary}` : `Finished "${taskCtx?.label ?? sessionId}".`, "coding-agent");
      ctx.ptyService.stopSession(sessionId).catch((err) => {
        ctx.log(`Failed to stop session after LLM-detected completion: ${err}`);
      });
      break;
    }
    case "escalate":
      ctx.broadcast({
        type: "escalation",
        sessionId,
        timestamp: Date.now(),
        data: {
          reasoning: decision.reasoning
        }
      });
      break;
    case "ignore":
      break;
  }
}
async function handleBlocked(ctx, sessionId, taskCtx, data) {
  const eventData = data;
  const promptText = eventData.promptInfo?.prompt ?? eventData.promptInfo?.instructions ?? "";
  if (eventData.autoResponded) {
    if (isOutOfScopeAccess(promptText, taskCtx.workdir)) {
      taskCtx.decisions.push({
        timestamp: Date.now(),
        event: "blocked",
        promptText,
        decision: "escalate",
        reasoning: `SECURITY: Auto-response approved access outside workspace (${taskCtx.workdir}). Session stopped.`
      });
      ctx.broadcast({
        type: "escalation",
        sessionId,
        timestamp: Date.now(),
        data: {
          prompt: promptText,
          reason: "out_of_scope_auto_approved",
          workdir: taskCtx.workdir
        }
      });
      ctx.sendChatMessage(`[${taskCtx.label}] WARNING: Auto-approved access to path outside workspace (${taskCtx.workdir}). ` + `Prompt: "${promptText.slice(0, 150)}". Stopping session for safety.`, "coding-agent");
      taskCtx.status = "error";
      ctx.ptyService.stopSession(sessionId).catch((err) => {
        ctx.log(`Failed to stop session after out-of-scope auto-approval: ${err}`);
      });
      return;
    }
    taskCtx.autoResolvedCount++;
    taskCtx.decisions.push({
      timestamp: Date.now(),
      event: "blocked",
      promptText,
      decision: "auto_resolved",
      reasoning: "Handled by auto-response rules"
    });
    ctx.broadcast({
      type: "blocked_auto_resolved",
      sessionId,
      timestamp: Date.now(),
      data: {
        prompt: promptText,
        promptType: eventData.promptInfo?.type,
        autoResolvedCount: taskCtx.autoResolvedCount
      }
    });
    const count = taskCtx.autoResolvedCount;
    if (count <= 2 || count % 5 === 0) {
      const excerpt = promptText.length > 120 ? `${promptText.slice(0, 120)}...` : promptText;
      ctx.sendChatMessage(`[${taskCtx.label}] Approved: ${excerpt}`, "coding-agent");
    }
    return;
  }
  ctx.broadcast({
    type: "blocked",
    sessionId,
    timestamp: Date.now(),
    data: {
      prompt: promptText,
      promptType: eventData.promptInfo?.type,
      supervisionLevel: ctx.getSupervisionLevel()
    }
  });
  if (taskCtx.autoResolvedCount >= MAX_AUTO_RESPONSES) {
    taskCtx.decisions.push({
      timestamp: Date.now(),
      event: "blocked",
      promptText,
      decision: "escalate",
      reasoning: `Escalating after ${MAX_AUTO_RESPONSES} consecutive auto-responses`
    });
    ctx.broadcast({
      type: "escalation",
      sessionId,
      timestamp: Date.now(),
      data: {
        prompt: promptText,
        reason: "max_auto_responses_exceeded"
      }
    });
    return;
  }
  switch (ctx.getSupervisionLevel()) {
    case "autonomous":
      await handleAutonomousDecision(ctx, sessionId, taskCtx, promptText, "");
      break;
    case "confirm":
      await handleConfirmDecision(ctx, sessionId, taskCtx, promptText, "");
      break;
    case "notify":
      taskCtx.decisions.push({
        timestamp: Date.now(),
        event: "blocked",
        promptText,
        decision: "escalate",
        reasoning: "Supervision level is notify \u2014 broadcasting only"
      });
      break;
  }
}
async function handleTurnComplete(ctx, sessionId, taskCtx, data) {
  if (ctx.inFlightDecisions.has(sessionId)) {
    ctx.log(`Skipping turn-complete assessment for ${sessionId} (in-flight)`);
    return;
  }
  ctx.inFlightDecisions.add(sessionId);
  try {
    ctx.log(`Turn complete for "${taskCtx.label}" \u2014 assessing whether task is done`);
    const rawResponse = data.response ?? "";
    let turnOutput = cleanForChat(rawResponse);
    if (!turnOutput) {
      const raw = await fetchRecentOutput(ctx, sessionId);
      turnOutput = cleanForChat(raw);
    }
    const prompt = buildTurnCompletePrompt(toContextSummary(taskCtx), turnOutput, toDecisionHistory(taskCtx));
    let decision = null;
    try {
      const result = await ctx.runtime.useModel(ModelType2.TEXT_SMALL, {
        prompt
      });
      decision = parseCoordinationResponse(result);
    } catch (err) {
      ctx.log(`Turn-complete LLM call failed: ${err}`);
    }
    if (!decision) {
      ctx.log(`Turn-complete for "${taskCtx.label}": LLM invalid response \u2014 defaulting to complete`);
      decision = {
        action: "complete",
        reasoning: "LLM returned invalid response \u2014 defaulting to complete"
      };
    }
    ctx.log(`Turn assessment for "${taskCtx.label}": ${decision.action}${decision.action === "respond" ? ` \u2192 "${(decision.response ?? "").slice(0, 80)}"` : ""} \u2014 ${decision.reasoning.slice(0, 120)}`);
    taskCtx.decisions.push({
      timestamp: Date.now(),
      event: "turn_complete",
      promptText: "Agent finished a turn",
      decision: decision.action,
      response: formatDecisionResponse(decision),
      reasoning: decision.reasoning
    });
    ctx.broadcast({
      type: "turn_assessment",
      sessionId,
      timestamp: Date.now(),
      data: {
        action: decision.action,
        reasoning: decision.reasoning
      }
    });
    if (decision.action === "respond") {
      const instruction = decision.response ?? "";
      const preview = instruction.length > 120 ? `${instruction.slice(0, 120)}...` : instruction;
      ctx.sendChatMessage(`[${taskCtx.label}] Turn done, continuing: ${preview}`, "coding-agent");
    } else if (decision.action === "escalate") {
      ctx.sendChatMessage(`[${taskCtx.label}] Turn finished \u2014 needs your attention: ${decision.reasoning}`, "coding-agent");
    }
    await executeDecision(ctx, sessionId, decision);
  } finally {
    ctx.inFlightDecisions.delete(sessionId);
  }
}
async function handleAutonomousDecision(ctx, sessionId, taskCtx, promptText, recentOutput) {
  if (ctx.inFlightDecisions.has(sessionId)) {
    ctx.log(`Skipping duplicate decision for ${sessionId} (in-flight)`);
    return;
  }
  ctx.inFlightDecisions.add(sessionId);
  try {
    let output = recentOutput;
    if (!output) {
      output = await fetchRecentOutput(ctx, sessionId);
    }
    let decision = await makeCoordinationDecision(ctx, taskCtx, promptText, output);
    if (!decision) {
      taskCtx.decisions.push({
        timestamp: Date.now(),
        event: "blocked",
        promptText,
        decision: "escalate",
        reasoning: "LLM returned invalid coordination response"
      });
      ctx.broadcast({
        type: "escalation",
        sessionId,
        timestamp: Date.now(),
        data: {
          prompt: promptText,
          reason: "invalid_llm_response"
        }
      });
      return;
    }
    if (decision.action === "respond" && isOutOfScopeAccess(promptText, taskCtx.workdir)) {
      decision = {
        action: "respond",
        response: `No \u2014 that path is outside your workspace. Use ${taskCtx.workdir} instead. Create any files or directories you need there.`,
        reasoning: `Declined out-of-scope access (outside ${taskCtx.workdir}) and redirected agent to workspace.`
      };
      ctx.sendChatMessage(`[${taskCtx.label}] Declined out-of-scope access and redirected to workspace (${taskCtx.workdir}). If you intended broader access, send the agent an override.`, "coding-agent");
    }
    taskCtx.decisions.push({
      timestamp: Date.now(),
      event: "blocked",
      promptText,
      decision: decision.action,
      response: formatDecisionResponse(decision),
      reasoning: decision.reasoning
    });
    taskCtx.autoResolvedCount = 0;
    ctx.broadcast({
      type: "coordination_decision",
      sessionId,
      timestamp: Date.now(),
      data: {
        action: decision.action,
        response: decision.response,
        useKeys: decision.useKeys,
        keys: decision.keys,
        reasoning: decision.reasoning
      }
    });
    if (decision.action === "respond") {
      const actionDesc = decision.useKeys ? `Sent keys: ${decision.keys?.join(", ")}` : decision.response ? `Responded: ${decision.response.length > 100 ? `${decision.response.slice(0, 100)}...` : decision.response}` : "Responded";
      const reasonExcerpt = decision.reasoning.length > 150 ? `${decision.reasoning.slice(0, 150)}...` : decision.reasoning;
      ctx.sendChatMessage(`[${taskCtx.label}] ${actionDesc} \u2014 ${reasonExcerpt}`, "coding-agent");
    } else if (decision.action === "escalate") {
      ctx.sendChatMessage(`[${taskCtx.label}] Needs your attention: ${decision.reasoning}`, "coding-agent");
    }
    await executeDecision(ctx, sessionId, decision);
  } finally {
    ctx.inFlightDecisions.delete(sessionId);
  }
}
async function handleConfirmDecision(ctx, sessionId, taskCtx, promptText, recentOutput) {
  if (ctx.inFlightDecisions.has(sessionId))
    return;
  ctx.inFlightDecisions.add(sessionId);
  try {
    let output = recentOutput;
    if (!output) {
      output = await fetchRecentOutput(ctx, sessionId);
    }
    const decision = await makeCoordinationDecision(ctx, taskCtx, promptText, output);
    if (!decision) {
      ctx.pendingDecisions.set(sessionId, {
        sessionId,
        promptText,
        recentOutput: output,
        llmDecision: {
          action: "escalate",
          reasoning: "LLM returned invalid response \u2014 needs human review"
        },
        taskContext: taskCtx,
        createdAt: Date.now()
      });
    } else {
      ctx.pendingDecisions.set(sessionId, {
        sessionId,
        promptText,
        recentOutput: output,
        llmDecision: decision,
        taskContext: taskCtx,
        createdAt: Date.now()
      });
    }
    ctx.broadcast({
      type: "pending_confirmation",
      sessionId,
      timestamp: Date.now(),
      data: {
        prompt: promptText,
        suggestedAction: decision?.action,
        suggestedResponse: decision?.response,
        reasoning: decision?.reasoning
      }
    });
  } finally {
    ctx.inFlightDecisions.delete(sessionId);
  }
}
var MAX_AUTO_RESPONSES = 10;
var init_swarm_decision_loop = __esm(() => {
  init_ansi_utils();
});

// src/actions/finalize-workspace.ts
var finalizeWorkspaceAction = {
  name: "FINALIZE_WORKSPACE",
  similes: ["COMMIT_AND_PR", "CREATE_PR", "SUBMIT_CHANGES", "FINISH_WORKSPACE"],
  description: "Finalize workspace changes by committing, pushing, and optionally creating a pull request. " + "Use after a coding agent completes its task.",
  examples: [
    [
      {
        name: "{{user1}}",
        content: { text: "Create a PR for the changes" }
      },
      {
        name: "{{agentName}}",
        content: {
          text: "I'll commit and create a pull request.",
          action: "FINALIZE_WORKSPACE"
        }
      }
    ],
    [
      {
        name: "{{user1}}",
        content: { text: "Submit the coding agent's work as a PR" }
      },
      {
        name: "{{agentName}}",
        content: {
          text: "Finalizing the workspace and creating PR.",
          action: "FINALIZE_WORKSPACE"
        }
      }
    ]
  ],
  validate: async (runtime, _message) => {
    const workspaceService = runtime.getService("CODING_WORKSPACE_SERVICE");
    return workspaceService != null;
  },
  handler: async (runtime, message, state, _options, callback) => {
    const workspaceService = runtime.getService("CODING_WORKSPACE_SERVICE");
    if (!workspaceService) {
      if (callback) {
        await callback({
          text: "Workspace Service is not available."
        });
      }
      return { success: false, error: "SERVICE_UNAVAILABLE" };
    }
    const content = message.content;
    let workspaceId = content.workspaceId;
    if (!workspaceId && state?.codingWorkspace) {
      workspaceId = state.codingWorkspace.id;
    }
    if (!workspaceId) {
      const workspaces = workspaceService.listWorkspaces();
      if (workspaces.length === 0) {
        if (callback) {
          await callback({
            text: "No workspaces available. Provision a workspace first."
          });
        }
        return { success: false, error: "NO_WORKSPACE" };
      }
      workspaceId = workspaces[workspaces.length - 1].id;
    }
    const workspace = workspaceService.getWorkspace(workspaceId);
    if (!workspace) {
      if (callback) {
        await callback({
          text: `Workspace ${workspaceId} not found.`
        });
      }
      return { success: false, error: "WORKSPACE_NOT_FOUND" };
    }
    try {
      const status = await workspaceService.getStatus(workspaceId);
      if (status.clean && status.staged.length === 0) {
        if (callback) {
          await callback({
            text: "No changes to commit in this workspace."
          });
        }
        return {
          success: true,
          text: "No changes to commit",
          data: { workspaceId, status }
        };
      }
      const commitMessage = content.commitMessage ?? `feat: automated changes from coding agent\n\nGenerated by Milady coding agent plugin.`;
      const commitHash = await workspaceService.commit(workspaceId, {
        message: commitMessage,
        all: true
      });
      await workspaceService.push(workspaceId, { setUpstream: true });
      let prInfo = null;
      if (!content.skipPR) {
        const prTitle = content.prTitle ?? `[Milady] ${workspace.branch}`;
        const prBody = content.prBody ?? `## Summary\n\nAutomated changes generated by Milady coding agent.\n\n` + `**Branch:** ${workspace.branch}\n` + `**Commit:** ${commitHash}\n\n` + `---\n*Generated by @elizaos/plugin-agent-orchestrator*`;
        prInfo = await workspaceService.createPR(workspaceId, {
          title: prTitle,
          body: prBody,
          base: content.baseBranch,
          draft: content.draft
        });
      }
      if (callback) {
        if (prInfo) {
          await callback({
            text: `Workspace finalized!\n` + `Commit: ${commitHash.slice(0, 8)}\n` + `PR #${prInfo.number}: ${prInfo.url}`
          });
        } else {
          await callback({
            text: `Workspace changes committed and pushed.\n` + `Commit: ${commitHash.slice(0, 8)}`
          });
        }
      }
      return {
        success: true,
        text: prInfo ? `Created PR #${prInfo.number}` : "Changes committed and pushed",
        data: {
          workspaceId,
          commitHash,
          pr: prInfo ? { number: prInfo.number, url: prInfo.url } : undefined
        }
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (callback) {
        await callback({
          text: `Failed to finalize workspace: ${errorMessage}`
        });
      }
      return { success: false, error: "FINALIZE_FAILED" };
    }
  },
  parameters: [
    {
      name: "workspaceId",
      description: "ID of the workspace to finalize. Uses current workspace if not specified.",
      required: false,
      schema: { type: "string" }
    },
    {
      name: "commitMessage",
      description: "Commit message for the changes.",
      required: false,
      schema: { type: "string" }
    },
    {
      name: "prTitle",
      description: "Title for the pull request.",
      required: false,
      schema: { type: "string" }
    },
    {
      name: "prBody",
      description: "Body/description for the pull request.",
      required: false,
      schema: { type: "string" }
    },
    {
      name: "baseBranch",
      description: "Base branch for the PR (e.g., main, develop).",
      required: false,
      schema: { type: "string" }
    },
    {
      name: "draft",
      description: "Create as draft PR.",
      required: false,
      schema: { type: "boolean" }
    },
    {
      name: "skipPR",
      description: "Skip PR creation, only commit and push.",
      required: false,
      schema: { type: "boolean" }
    }
  ]
};

// src/actions/list-agents.ts
var listAgentsAction = {
  name: "LIST_CODING_AGENTS",
  similes: [
    "SHOW_CODING_AGENTS",
    "GET_ACTIVE_AGENTS",
    "LIST_SESSIONS",
    "SHOW_CODING_SESSIONS"
  ],
  description: "List all active coding agent sessions. " + "Shows session IDs, agent types, status, and working directories.",
  examples: [
    [
      {
        name: "{{user1}}",
        content: { text: "What coding agents are running?" }
      },
      {
        name: "{{agentName}}",
        content: {
          text: "Let me check the active coding sessions.",
          action: "LIST_CODING_AGENTS"
        }
      }
    ],
    [
      {
        name: "{{user1}}",
        content: { text: "Show me the coding sessions" }
      },
      {
        name: "{{agentName}}",
        content: {
          text: "Here are the active coding agents.",
          action: "LIST_CODING_AGENTS"
        }
      }
    ]
  ],
  validate: async (runtime, _message) => {
    const ptyService = runtime.getService("PTY_SERVICE");
    return ptyService != null;
  },
  handler: async (runtime, _message, _state, _options, callback) => {
    const ptyService = runtime.getService("PTY_SERVICE");
    if (!ptyService) {
      if (callback) {
        await callback({
          text: "PTY Service is not available."
        });
      }
      return { success: false, error: "SERVICE_UNAVAILABLE" };
    }
    const sessions = await ptyService.listSessions();
    if (sessions.length === 0) {
      if (callback) {
        await callback({
          text: "No active coding agents. Use SPAWN_CODING_AGENT to start one."
        });
      }
      return {
        success: true,
        text: "No active coding agents",
        data: { sessions: [] }
      };
    }
    const sessionSummaries = sessions.map((session) => ({
      id: session.id,
      agentType: session.agentType,
      status: session.status,
      workdir: session.workdir,
      createdAt: session.createdAt.toISOString(),
      lastActivity: session.lastActivityAt.toISOString()
    }));
    const lines = sessions.map((session, index) => {
      const statusEmoji = {
        running: "\u25B6\uFE0F",
        idle: "\u23F8\uFE0F",
        blocked: "\u26A0\uFE0F",
        completed: "\u2705",
        error: "\u274C"
      }[session.status] ?? "\u2753";
      return `${index + 1}. ${statusEmoji} ${session.agentType} (${session.id.slice(0, 8)}...)
   \uD83D\uDCC1 ${session.workdir}\n   Status: ${session.status}`;
    });
    if (callback) {
      await callback({
        text: `Active coding agents:\n\n${lines.join("\n\n")}`
      });
    }
    return {
      success: true,
      text: `Found ${sessions.length} active coding agents`,
      data: { sessions: sessionSummaries }
    };
  },
  parameters: []
};

// src/actions/manage-issues.ts
async function handleOperation(service, repo, operation, params, originalText, callback) {
  try {
    switch (operation.toLowerCase()) {
      case "create": {
        const title = params.title;
        const body = params.body;
        if (!title) {
          const items = extractBulkItems(params.text ?? originalText);
          if (items.length > 0) {
            const labels2 = parseLabels(params.labels);
            const created = [];
            for (const item of items) {
              const issue2 = await service.createIssue(repo, {
                title: item.title,
                body: item.body ?? "",
                labels: labels2.length > 0 ? labels2 : undefined
              });
              created.push(issue2);
            }
            if (callback) {
              const summary = created.map((i) => `#${i.number}: ${i.title}\n  ${i.url}`).join("\n");
              await callback({
                text: `Created ${created.length} issues:\n${summary}`
              });
            }
            return { success: true, data: { issues: created } };
          }
          if (callback)
            await callback({ text: "Issue title is required for create." });
          return { success: false, error: "MISSING_TITLE" };
        }
        const labels = parseLabels(params.labels);
        const issue = await service.createIssue(repo, {
          title,
          body: body ?? "",
          labels: labels.length > 0 ? labels : undefined
        });
        if (callback) {
          await callback({
            text: `Created issue #${issue.number}: ${issue.title}\n${issue.url}`
          });
        }
        return { success: true, data: { issue } };
      }
      case "list": {
        const stateFilter = params.state ?? "open";
        const labels = parseLabels(params.labels);
        const issues = await service.listIssues(repo, {
          state: stateFilter,
          labels: labels.length > 0 ? labels : undefined
        });
        if (callback) {
          if (issues.length === 0) {
            await callback({
              text: `No ${stateFilter} issues found in ${repo}.`
            });
          } else {
            const summary = issues.map((i) => `#${i.number} [${i.state}] ${i.title}${i.labels.length > 0 ? ` (${i.labels.join(", ")})` : ""}`).join("\n");
            await callback({ text: `Issues in ${repo}:\n${summary}` });
          }
        }
        return { success: true, data: { issues } };
      }
      case "get": {
        const issueNumber = Number(params.issueNumber);
        if (!issueNumber) {
          if (callback)
            await callback({ text: "Issue number is required." });
          return { success: false, error: "MISSING_ISSUE_NUMBER" };
        }
        const issue = await service.getIssue(repo, issueNumber);
        if (callback) {
          await callback({
            text: `Issue #${issue.number}: ${issue.title} [${issue.state}]\n\n${issue.body}\n\nLabels: ${issue.labels.join(", ") || "none"}\n${issue.url}`
          });
        }
        return { success: true, data: { issue } };
      }
      case "update": {
        const issueNumber = Number(params.issueNumber);
        if (!issueNumber) {
          if (callback)
            await callback({ text: "Issue number is required." });
          return { success: false, error: "MISSING_ISSUE_NUMBER" };
        }
        const labels = parseLabels(params.labels);
        const issue = await service.updateIssue(repo, issueNumber, {
          title: params.title,
          body: params.body,
          labels: labels.length > 0 ? labels : undefined
        });
        if (callback) {
          await callback({
            text: `Updated issue #${issue.number}: ${issue.title}`
          });
        }
        return { success: true, data: { issue } };
      }
      case "comment": {
        const issueNumber = Number(params.issueNumber);
        const body = params.body;
        if (!issueNumber || !body) {
          if (callback)
            await callback({
              text: "Issue number and comment body are required."
            });
          return { success: false, error: "MISSING_PARAMS" };
        }
        const comment = await service.addComment(repo, issueNumber, body);
        if (callback) {
          await callback({
            text: `Added comment to issue #${issueNumber}: ${comment.url}`
          });
        }
        return { success: true, data: { comment } };
      }
      case "close": {
        const issueNumber = Number(params.issueNumber);
        if (!issueNumber) {
          if (callback)
            await callback({ text: "Issue number is required." });
          return { success: false, error: "MISSING_ISSUE_NUMBER" };
        }
        const issue = await service.closeIssue(repo, issueNumber);
        if (callback) {
          await callback({
            text: `Closed issue #${issue.number}: ${issue.title}`
          });
        }
        return { success: true, data: { issue } };
      }
      case "reopen": {
        const issueNumber = Number(params.issueNumber);
        if (!issueNumber) {
          if (callback)
            await callback({ text: "Issue number is required." });
          return { success: false, error: "MISSING_ISSUE_NUMBER" };
        }
        const issue = await service.reopenIssue(repo, issueNumber);
        if (callback) {
          await callback({
            text: `Reopened issue #${issue.number}: ${issue.title}`
          });
        }
        return { success: true, data: { issue } };
      }
      case "add_labels": {
        const issueNumber = Number(params.issueNumber);
        const labels = parseLabels(params.labels);
        if (!issueNumber || labels.length === 0) {
          if (callback)
            await callback({ text: "Issue number and labels are required." });
          return { success: false, error: "MISSING_PARAMS" };
        }
        await service.addLabels(repo, issueNumber, labels);
        if (callback) {
          await callback({
            text: `Added labels [${labels.join(", ")}] to issue #${issueNumber}`
          });
        }
        return { success: true };
      }
      default:
        if (callback) {
          await callback({
            text: `Unknown operation: ${operation}. Use: create, list, get, update, comment, close, reopen, add_labels`
          });
        }
        return { success: false, error: "UNKNOWN_OPERATION" };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (callback) {
      await callback({ text: `Issue operation failed: ${errorMessage}` });
    }
    return { success: false, error: errorMessage };
  }
}
function extractBulkItems(text) {
  if (!text)
    return [];
  const numberedPattern = /(?:^|\s)(\d+)[).:-]\s*(.+?)(?=(?:\s+\d+[).:-]\s)|$)/gs;
  const items = [];
  for (const match of text.matchAll(numberedPattern)) {
    const raw = match[2].trim();
    if (raw.length > 0) {
      items.push({ title: raw });
    }
  }
  if (items.length >= 2)
    return items;
  const bulletPattern = /(?:^|\n)\s*[-*•]\s+(.+)/g;
  const bulletItems = [];
  for (const match of text.matchAll(bulletPattern)) {
    const raw = match[1].trim();
    if (raw.length > 0) {
      bulletItems.push({ title: raw });
    }
  }
  if (bulletItems.length >= 2)
    return bulletItems;
  return [];
}
function inferOperation(text) {
  const lower = text.toLowerCase();
  if (/\b(create|open|file|submit|make|add)\b.*\bissue/.test(lower))
    return "create";
  if (/\bissue.*\b(create|open|file|submit|make)\b/.test(lower))
    return "create";
  if (/\b(close|resolve)\b.*\bissue/.test(lower))
    return "close";
  if (/\bissue.*\b(close|resolve)\b/.test(lower))
    return "close";
  if (/\b(reopen|re-open)\b.*\bissue/.test(lower))
    return "reopen";
  if (/\b(comment|reply)\b.*\bissue/.test(lower))
    return "comment";
  if (/\bissue.*\b(comment|reply)\b/.test(lower))
    return "comment";
  if (/\b(update|edit|modify)\b.*\bissue/.test(lower))
    return "update";
  if (/\bissue.*\b(update|edit|modify)\b/.test(lower))
    return "update";
  if (/\b(label|tag)\b.*\bissue/.test(lower))
    return "add_labels";
  if (/\bget\b.*\bissue\s*#?\d/.test(lower))
    return "get";
  if (/\bissue\s*#?\d/.test(lower) && !/\b(list|show|all)\b/.test(lower))
    return "get";
  if (/\b(list|show|check|what are)\b.*\bissue/.test(lower))
    return "list";
  return "list";
}
function parseLabels(input) {
  if (!input)
    return [];
  if (Array.isArray(input))
    return input.map(String);
  if (typeof input === "string")
    return input.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}
var manageIssuesAction = {
  name: "MANAGE_ISSUES",
  similes: [
    "CREATE_ISSUE",
    "LIST_ISSUES",
    "CLOSE_ISSUE",
    "COMMENT_ISSUE",
    "UPDATE_ISSUE",
    "GET_ISSUE"
  ],
  description: "Manage GitHub issues for a repository. " + "Supports creating issues, listing issues, getting issue details, " + "adding comments, updating, closing, and reopening issues.",
  examples: [
    [
      {
        name: "{{user1}}",
        content: {
          text: "Create an issue on the testbed repo to add a login page"
        }
      },
      {
        name: "{{agentName}}",
        content: {
          text: "I'll create that issue for you.",
          action: "MANAGE_ISSUES"
        }
      }
    ],
    [
      {
        name: "{{user1}}",
        content: {
          text: "List the open issues on HaruHunab1320/git-workspace-service-testbed"
        }
      },
      {
        name: "{{agentName}}",
        content: {
          text: "Let me check the open issues for that repo.",
          action: "MANAGE_ISSUES"
        }
      }
    ],
    [
      {
        name: "{{user1}}",
        content: { text: "Close issue #3 on the testbed repo" }
      },
      {
        name: "{{agentName}}",
        content: {
          text: "I'll close that issue.",
          action: "MANAGE_ISSUES"
        }
      }
    ]
  ],
  validate: async (runtime, _message) => {
    const workspaceService = runtime.getService("CODING_WORKSPACE_SERVICE");
    return workspaceService != null;
  },
  handler: async (runtime, message, _state, options, callback) => {
    const workspaceService = runtime.getService("CODING_WORKSPACE_SERVICE");
    if (!workspaceService) {
      if (callback) {
        await callback({ text: "Workspace Service is not available." });
      }
      return { success: false, error: "SERVICE_UNAVAILABLE" };
    }
    workspaceService.setAuthPromptCallback((prompt) => {
      if (callback) {
        callback({
          text: `I need GitHub access to manage issues. Please authorize me:\n\n` + `Go to: ${prompt.verificationUri}\n` + `Enter code: **${prompt.userCode}**\n\n` + `This code expires in ${Math.floor(prompt.expiresIn / 60)} minutes. ` + `I'll wait for you to complete authorization...`
        });
      }
    });
    const params = options?.parameters;
    const content = message.content;
    const text = content.text ?? "";
    const operation = params?.operation ?? content.operation ?? inferOperation(text);
    const repo = params?.repo ?? content.repo;
    if (!repo) {
      const urlMatch = text?.match(/(?:https?:\/\/github\.com\/)?([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)/);
      if (!urlMatch) {
        if (callback) {
          await callback({
            text: "Please specify a repository (e.g., owner/repo or a GitHub URL)."
          });
        }
        return { success: false, error: "MISSING_REPO" };
      }
      return handleOperation(workspaceService, urlMatch[1], operation, params ?? content, text, callback);
    }
    return handleOperation(workspaceService, repo, operation, params ?? content, text, callback);
  },
  parameters: [
    {
      name: "operation",
      description: "The operation to perform: create, list, get, update, comment, close, reopen, add_labels",
      required: true,
      schema: { type: "string" }
    },
    {
      name: "repo",
      description: "Repository in owner/repo format or full GitHub URL.",
      required: true,
      schema: { type: "string" }
    },
    {
      name: "title",
      description: "Issue title (for create operation).",
      required: false,
      schema: { type: "string" }
    },
    {
      name: "body",
      description: "Issue body/description (for create or comment operations).",
      required: false,
      schema: { type: "string" }
    },
    {
      name: "issueNumber",
      description: "Issue number (for get, update, comment, close, reopen operations).",
      required: false,
      schema: { type: "number" }
    },
    {
      name: "labels",
      description: "Labels to add (comma-separated string or array).",
      required: false,
      schema: { type: "string" }
    },
    {
      name: "state",
      description: "Filter by state: open, closed, or all (for list operation).",
      required: false,
      schema: { type: "string" }
    }
  ]
};

// src/actions/provision-workspace.ts
var provisionWorkspaceAction = {
  name: "PROVISION_WORKSPACE",
  similes: [
    "CREATE_WORKSPACE",
    "CLONE_REPO",
    "SETUP_WORKSPACE",
    "PREPARE_WORKSPACE"
  ],
  description: "Create a git workspace for coding tasks. " + "Can clone a repository or create a git worktree for isolated development.",
  examples: [
    [
      {
        name: "{{user1}}",
        content: {
          text: "Clone the repo and create a workspace for the feature"
        }
      },
      {
        name: "{{agentName}}",
        content: {
          text: "I'll set up a workspace for you.",
          action: "PROVISION_WORKSPACE"
        }
      }
    ],
    [
      {
        name: "{{user1}}",
        content: { text: "Create a worktree for the bug fix" }
      },
      {
        name: "{{agentName}}",
        content: {
          text: "Creating an isolated worktree for the bug fix.",
          action: "PROVISION_WORKSPACE"
        }
      }
    ]
  ],
  validate: async (runtime, _message) => {
    const workspaceService = runtime.getService("CODING_WORKSPACE_SERVICE");
    return workspaceService != null;
  },
  handler: async (runtime, message, state, _options, callback) => {
    const workspaceService = runtime.getService("CODING_WORKSPACE_SERVICE");
    if (!workspaceService) {
      if (callback) {
        await callback({
          text: "Workspace Service is not available."
        });
      }
      return { success: false, error: "SERVICE_UNAVAILABLE" };
    }
    const content = message.content;
    let repo = content.repo;
    if (!repo && content.text) {
      const urlMatch = content.text.match(/https?:\/\/(?:github\.com|gitlab\.com|bitbucket\.org)\/[\w.-]+\/[\w.-]+(?:\.git)?/i);
      if (urlMatch) {
        repo = urlMatch[0];
      }
    }
    if (!repo && !content.useWorktree) {
      if (callback) {
        await callback({
          text: "Please specify a repository URL or use worktree mode with a parent workspace."
        });
      }
      return { success: false, error: "MISSING_REPO" };
    }
    if (repo) {
      const ALLOWED_DOMAINS = /^https?:\/\/(github\.com|gitlab\.com|bitbucket\.org)\//i;
      if (!ALLOWED_DOMAINS.test(repo)) {
        if (callback) {
          await callback({
            text: "Repository URL must be from github.com, gitlab.com, or bitbucket.org."
          });
        }
        return { success: false, error: "INVALID_REPO_DOMAIN" };
      }
    }
    let parentWorkspaceId = content.parentWorkspaceId;
    if (content.useWorktree && !parentWorkspaceId) {
      if (state?.codingWorkspace) {
        parentWorkspaceId = state.codingWorkspace.id;
      } else {
        if (callback) {
          await callback({
            text: "Worktree mode requires a parent workspace. Clone a repo first or specify parentWorkspaceId."
          });
        }
        return { success: false, error: "MISSING_PARENT" };
      }
    }
    try {
      const workspace = await workspaceService.provisionWorkspace({
        repo: repo ?? "",
        baseBranch: content.baseBranch,
        useWorktree: content.useWorktree,
        parentWorkspaceId
      });
      if (state) {
        state.codingWorkspace = {
          id: workspace.id,
          path: workspace.path,
          branch: workspace.branch,
          isWorktree: workspace.isWorktree
        };
      }
      if (callback) {
        await callback({
          text: `Created workspace at ${workspace.path}\n` + `Branch: ${workspace.branch}\n` + `Type: ${workspace.isWorktree ? "worktree" : "clone"}`
        });
      }
      return {
        success: true,
        text: `Created workspace ${workspace.id}`,
        data: {
          workspaceId: workspace.id,
          path: workspace.path,
          branch: workspace.branch,
          isWorktree: workspace.isWorktree
        }
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (callback) {
        await callback({
          text: `Failed to provision workspace: ${errorMessage}`
        });
      }
      return { success: false, error: errorMessage };
    }
  },
  parameters: [
    {
      name: "repo",
      description: "Git repository URL to clone.",
      required: false,
      schema: { type: "string" }
    },
    {
      name: "baseBranch",
      description: "Base branch to create feature branch from (default: main).",
      required: false,
      schema: { type: "string" }
    },
    {
      name: "useWorktree",
      description: "Create a git worktree instead of a full clone.",
      required: false,
      schema: { type: "boolean" }
    },
    {
      name: "parentWorkspaceId",
      description: "Parent workspace ID for worktree creation.",
      required: false,
      schema: { type: "string" }
    }
  ]
};

// src/actions/send-to-agent.ts
var sendToAgentAction = {
  name: "SEND_TO_CODING_AGENT",
  similes: [
    "MESSAGE_CODING_AGENT",
    "INPUT_TO_AGENT",
    "RESPOND_TO_AGENT",
    "TELL_CODING_AGENT"
  ],
  description: "Send text input to a running coding agent session. " + "Use this to respond to agent prompts, provide feedback, or give new instructions.",
  examples: [
    [
      {
        name: "{{user1}}",
        content: { text: "Tell the coding agent to accept the changes" }
      },
      {
        name: "{{agentName}}",
        content: {
          text: "I'll send the approval to the coding agent.",
          action: "SEND_TO_CODING_AGENT"
        }
      }
    ],
    [
      {
        name: "{{user1}}",
        content: { text: "Say yes to the agent prompt" }
      },
      {
        name: "{{agentName}}",
        content: {
          text: "Sending confirmation to the agent.",
          action: "SEND_TO_CODING_AGENT"
        }
      }
    ]
  ],
  validate: async (runtime, _message) => {
    const ptyService = runtime.getService("PTY_SERVICE");
    if (!ptyService) {
      return false;
    }
    try {
      const sessions = await Promise.race([
        ptyService.listSessions(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("validate timeout")), 2000))
      ]);
      return sessions.length > 0;
    } catch {
      return false;
    }
  },
  handler: async (runtime, message, state, _options, callback) => {
    const ptyService = runtime.getService("PTY_SERVICE");
    if (!ptyService) {
      if (callback) {
        await callback({
          text: "PTY Service is not available."
        });
      }
      return { success: false, error: "SERVICE_UNAVAILABLE" };
    }
    const content = message.content;
    let sessionId = content.sessionId;
    if (!sessionId && state?.codingSession) {
      sessionId = state.codingSession.id;
    }
    if (!sessionId) {
      const sessions = await ptyService.listSessions();
      if (sessions.length === 0) {
        if (callback) {
          await callback({
            text: "No active coding sessions. Spawn an agent first."
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
          text: `Session ${sessionId} not found.`
        });
      }
      return { success: false, error: "SESSION_NOT_FOUND" };
    }
    try {
      if (content.keys) {
        await ptyService.sendKeysToSession(sessionId, content.keys);
        if (callback) {
          await callback({
            text: `Sent key sequence to coding agent.`
          });
        }
        return {
          success: true,
          text: "Sent key sequence",
          data: { sessionId, keys: content.keys }
        };
      } else if (content.input) {
        await ptyService.sendToSession(sessionId, content.input);
        if (callback) {
          await callback({
            text: `Sent to coding agent: "${content.input}"`
          });
        }
        return {
          success: true,
          text: "Sent input to agent",
          data: { sessionId, input: content.input }
        };
      } else {
        if (callback) {
          await callback({
            text: "No input provided. Specify 'input' or 'keys' parameter."
          });
        }
        return { success: false, error: "NO_INPUT" };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (callback) {
        await callback({
          text: `Failed to send to agent: ${errorMessage}`
        });
      }
      return { success: false, error: errorMessage };
    }
  },
  parameters: [
    {
      name: "sessionId",
      description: "ID of the coding session to send to. If not specified, uses the current session.",
      required: false,
      schema: { type: "string" }
    },
    {
      name: "input",
      description: "Text input to send to the agent.",
      required: false,
      schema: { type: "string" }
    },
    {
      name: "keys",
      description: "Special key sequence to send (e.g., 'Enter', 'Ctrl-C', 'y').",
      required: false,
      schema: { type: "string" }
    }
  ]
};

// src/actions/spawn-agent.ts
import * as os from "node:os";
import * as path2 from "node:path";
import {
logger as logger3
} from "@elizaos/core";

// src/services/pty-service.ts
import {mkdir, readFile, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {logger as logger2} from "@elizaos/core";
import {
checkAdapters,
createAdapter,
generateApprovalConfig
} from "coding-agent-adapters";
import {PTYConsoleBridge} from "pty-console";

// src/services/agent-metrics.ts
class AgentMetricsTracker {
  metrics = new Map;
  get(agentType) {
    let m = this.metrics.get(agentType);
    if (!m) {
      m = {
        spawned: 0,
        completed: 0,
        completedViaFastPath: 0,
        completedViaClassifier: 0,
        stallCount: 0,
        avgCompletionMs: 0,
        totalCompletionMs: 0
      };
      this.metrics.set(agentType, m);
    }
    return m;
  }
  recordCompletion(agentType, method, durationMs) {
    const m = this.get(agentType);
    m.completed++;
    if (method === "fast-path")
      m.completedViaFastPath++;
    else
      m.completedViaClassifier++;
    m.totalCompletionMs += durationMs;
    m.avgCompletionMs = Math.round(m.totalCompletionMs / m.completed);
  }
  incrementStalls(agentType) {
    this.get(agentType).stallCount++;
  }
  getAll() {
    const result = {};
    for (const [type, m] of this.metrics) {
      const { totalCompletionMs: _, ...rest } = m;
      result[type] = { ...rest };
    }
    return result;
  }
}

// src/services/agent-selection.ts
function computeAgentScore(metrics) {
  if (!metrics || metrics.spawned === 0)
    return 0.5;
  const { spawned, completed, stallCount, avgCompletionMs } = metrics;
  const rawSuccess = completed / spawned;
  const volumeWeight = Math.min(1, spawned / 5);
  const successRate = rawSuccess * volumeWeight + 0.5 * (1 - volumeWeight);
  const stallPenalty = stallCount / spawned * 0.3;
  const speedPenalty = Math.min(avgCompletionMs / 300000, 1) * 0.1;
  return Math.max(0, successRate - stallPenalty - speedPenalty);
}
function selectAgentType(ctx) {
  if (ctx.config.strategy === "fixed") {
    return ctx.config.fixedAgentType;
  }
  const installed = new Set(ctx.installedAgents.filter((r) => r.installed).map((r) => r.adapter));
  if (installed.size === 0) {
    return ctx.config.fixedAgentType;
  }
  let bestAgent = ctx.config.fixedAgentType;
  let bestScore = -1;
  for (const agent of DEFAULT_ORDER) {
    if (!installed.has(agent))
      continue;
    const score = computeAgentScore(ctx.metrics[agent]);
    if (score > bestScore) {
      bestScore = score;
      bestAgent = agent;
    }
  }
  return bestAgent;
}
var DEFAULT_ORDER = ["claude", "gemini", "codex", "aider"];

// src/services/pty-auto-response.ts
async function pushDefaultRules(ctx, sessionId, agentType) {
  const rules = [];
  if (agentType === "aider") {
    rules.push({
      pattern: /\.aider\*.*\.gitignore.*\(Y\)es\/\(N\)o/i,
      type: "config",
      response: "y",
      description: "Auto-accept adding .aider* to .gitignore",
      safe: true
    });
  }
  if (agentType === "gemini") {
    const geminiApiKey = ctx.runtime.getSetting("GENERATIVE_AI_API_KEY");
    if (geminiApiKey) {
      rules.push({
        pattern: /Log in with Google|Use an API key|Use Vertex AI|gemini api key/i,
        type: "config",
        response: "2",
        description: "Select 'Use an API key' from Gemini auth menu",
        safe: true
      });
      rules.push({
        pattern: /^(?:\s|[>$#])*(?:Enter|Paste) (?:your )?(?:Google AI|Gemini) API key:/i,
        type: "config",
        response: geminiApiKey,
        description: "Input Gemini API key from Gemini CLI auth prompt",
        safe: true,
        once: true
      });
    } else {
      rules.push({
        pattern: /Log in with Google|Use an API key|Use Vertex AI|gemini api key/i,
        type: "config",
        response: "1",
        description: "Select 'Log in with Google' from Gemini auth menu (browser OAuth)",
        safe: true
      });
    }
  }
  if (rules.length === 0)
    return;
  try {
    if (ctx.usingBunWorker) {
      for (const rule of rules) {
        await ctx.manager.addAutoResponseRule(sessionId, rule);
      }
    } else {
      const nodeManager = ctx.manager;
      for (const rule of rules) {
        nodeManager.addAutoResponseRule(sessionId, rule);
      }
    }
    ctx.log(`Pushed ${rules.length} auto-response rules to session ${sessionId}`);
  } catch (err) {
    ctx.log(`Failed to push rules to session ${sessionId}: ${err}`);
  }
}
async function handleGeminiAuth(ctx, sessionId, sendKeysToSession) {
  const apiKey = ctx.runtime.getSetting("GENERATIVE_AI_API_KEY");
  if (apiKey) {
    ctx.log(`Gemini auth: API key available, sending /auth to start API key flow`);
  } else {
    ctx.log(`Gemini auth: no API key configured, sending /auth for Google OAuth flow`);
  }
  try {
    await sendKeysToSession(sessionId, "/auth");
    await new Promise((r) => setTimeout(r, 50));
    await sendKeysToSession(sessionId, "enter");
  } catch (err) {
    ctx.log(`Gemini auth: failed to send /auth: ${err}`);
  }
}

// src/services/pty-init.ts
init_ansi_utils();
import {createRequire as createRequire2} from "node:module";
import {createAllAdapters} from "coding-agent-adapters";
import {
BunCompatiblePTYManager,
isBun,
PTYManager,
ShellAdapter
} from "pty-manager";
async function initializePTYManager(ctx) {
  const usingBunWorker = isBun();
  if (usingBunWorker) {
    ctx.log("Detected Bun runtime, using BunCompatiblePTYManager");
    ctx.log(`Resolved adapter module: ${resolvedAdapterModule}`);
    const bunManager = new BunCompatiblePTYManager({
      adapterModules: [resolvedAdapterModule],
      stallDetectionEnabled: true,
      stallTimeoutMs: 4000,
      onStallClassify: async (sessionId, recentOutput, _stallDurationMs) => {
        return ctx.classifyStall(sessionId, recentOutput);
      }
    });
    bunManager.on("session_ready", (session) => {
      ctx.log(`session_ready event received for ${session.id} (type: ${session.type}, status: ${session.status})`);
      ctx.emitEvent(session.id, "ready", { session });
    });
    bunManager.on("session_exit", (id, code) => {
      ctx.emitEvent(id, "stopped", { reason: `exit code ${code}` });
    });
    bunManager.on("session_error", (id, error) => {
      ctx.emitEvent(id, "error", { message: error });
    });
    bunManager.on("blocking_prompt", (session, promptInfo, autoResponded) => {
      const info = promptInfo;
      ctx.log(`blocking_prompt for ${session.id}: type=${info?.type}, autoResponded=${autoResponded}, prompt="${(info?.prompt ?? "").slice(0, 80)}"`);
      ctx.emitEvent(session.id, "blocked", { promptInfo, autoResponded });
    });
    bunManager.on("login_required", (session, instructions, url) => {
      if (session.type === "gemini") {
        ctx.handleGeminiAuth(session.id);
      }
      ctx.emitEvent(session.id, "login_required", { instructions, url });
    });
    bunManager.on("task_complete", (session) => {
      const response = captureTaskResponse(session.id, ctx.sessionOutputBuffers, ctx.taskResponseMarkers);
      const durationMs = session.startedAt ? Date.now() - new Date(session.startedAt).getTime() : 0;
      ctx.metricsTracker.recordCompletion(session.type, "fast-path", durationMs);
      ctx.log(`Task complete for ${session.id} (adapter fast-path), response: ${response.length} chars`);
      ctx.emitEvent(session.id, "task_complete", { session, response });
    });
    bunManager.on("tool_running", (session, info) => {
      ctx.log(`tool_running for ${session.id}: ${info.toolName}${info.description ? ` \u2014 ${info.description}` : ""}`);
      ctx.emitEvent(session.id, "tool_running", { session, ...info });
    });
    bunManager.on("message", (message) => {
      ctx.emitEvent(message.sessionId, "message", message);
    });
    bunManager.on("worker_error", (err) => {
      const raw = typeof err === "string" ? err : String(err);
      const msg = raw.replace(/^Invalid JSON from worker:\s*/i, "").trim();
      if (!msg)
        return;
      if (msg.includes("Task completion trace")) {
        ctx.traceEntries.push(msg);
        if (ctx.traceEntries.length > ctx.maxTraceEntries) {
          ctx.traceEntries.splice(0, ctx.traceEntries.length - ctx.maxTraceEntries);
        }
      }
      if (msg.includes("suppressing stall emission")) {
        return;
      }
      if (msg.includes("ready") || msg.includes("blocking") || msg.includes("auto-response") || msg.includes("Auto-responding") || msg.includes("detectReady") || msg.includes("stall") || msg.includes("Stall") || msg.includes("Task completion") || msg.includes("Spawning") || msg.includes("PTY session")) {
        console.log("[PTYService/Worker]", msg);
      } else {
        console.error("[PTYService/Worker]", msg.slice(0, 200));
      }
    });
    bunManager.on("worker_exit", (info) => {
      console.error("[PTYService] Worker exited:", info);
    });
    await bunManager.waitForReady();
    return { manager: bunManager, usingBunWorker: true };
  }
  ctx.log("Using native PTYManager");
  const managerConfig = {
    maxLogLines: ctx.serviceConfig.maxLogLines,
    stallDetectionEnabled: true,
    stallTimeoutMs: 4000,
    onStallClassify: async (sessionId, recentOutput, _stallDurationMs) => {
      return ctx.classifyStall(sessionId, recentOutput);
    }
  };
  const nodeManager = new PTYManager(managerConfig);
  nodeManager.registerAdapter(new ShellAdapter);
  if (ctx.serviceConfig.registerCodingAdapters) {
    const codingAdapters = createAllAdapters();
    for (const adapter of codingAdapters) {
      nodeManager.registerAdapter(adapter);
      ctx.log(`Registered ${adapter.adapterType} adapter`);
    }
  }
  nodeManager.on("session_ready", (session) => {
    ctx.emitEvent(session.id, "ready", { session });
  });
  nodeManager.on("blocking_prompt", (session, promptInfo, autoResponded) => {
    ctx.emitEvent(session.id, "blocked", { promptInfo, autoResponded });
  });
  nodeManager.on("login_required", (session, instructions, url) => {
    if (session.type === "gemini") {
      ctx.handleGeminiAuth(session.id);
    }
    ctx.emitEvent(session.id, "login_required", { instructions, url });
  });
  nodeManager.on("task_complete", (session) => {
    const response = captureTaskResponse(session.id, ctx.sessionOutputBuffers, ctx.taskResponseMarkers);
    const durationMs = session.startedAt ? Date.now() - new Date(session.startedAt).getTime() : 0;
    ctx.metricsTracker.recordCompletion(session.type, "fast-path", durationMs);
    ctx.log(`Task complete for ${session.id} (adapter fast-path), response: ${response.length} chars`);
    ctx.emitEvent(session.id, "task_complete", { session, response });
  });
  nodeManager.on("tool_running", (session, info) => {
    ctx.log(`tool_running for ${session.id}: ${info.toolName}${info.description ? ` \u2014 ${info.description}` : ""}`);
    ctx.emitEvent(session.id, "tool_running", { session, ...info });
  });
  nodeManager.on("session_stopped", (session, reason) => {
    ctx.emitEvent(session.id, "stopped", { reason });
  });
  nodeManager.on("session_error", (session, error) => {
    ctx.emitEvent(session.id, "error", { message: error });
  });
  nodeManager.on("message", (message) => {
    ctx.emitEvent(message.sessionId, "message", message);
  });
  return { manager: nodeManager, usingBunWorker: false };
}
var _require = createRequire2(import.meta.url);
var resolvedAdapterModule = "coding-agent-adapters";
try {
  resolvedAdapterModule = _require.resolve("coding-agent-adapters");
} catch {
}

// src/services/pty-session-io.ts
async function sendToSession(ctx, sessionId, input) {
  const session = ctx.manager.get(sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }
  const buffer = ctx.sessionOutputBuffers.get(sessionId);
  if (buffer) {
    ctx.taskResponseMarkers.set(sessionId, buffer.length);
  }
  if (ctx.usingBunWorker) {
    await ctx.manager.send(sessionId, input);
    return;
  } else {
    return ctx.manager.send(sessionId, input);
  }
}
async function sendKeysToSession(ctx, sessionId, keys) {
  if (ctx.usingBunWorker) {
    await ctx.manager.sendKeys(sessionId, keys);
  } else {
    const ptySession = ctx.manager.getSession(sessionId);
    if (!ptySession) {
      throw new Error(`Session ${sessionId} not found`);
    }
    ptySession.sendKeys(keys);
  }
}
async function stopSession(ctx, sessionId, sessionMetadata, sessionWorkdirs, log) {
  const session = ctx.manager.get(sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }
  if (ctx.usingBunWorker) {
    await ctx.manager.kill(sessionId);
  } else {
    await ctx.manager.stop(sessionId);
  }
  const unsubscribe = ctx.outputUnsubscribers.get(sessionId);
  if (unsubscribe) {
    unsubscribe();
    ctx.outputUnsubscribers.delete(sessionId);
  }
  sessionMetadata.delete(sessionId);
  sessionWorkdirs.delete(sessionId);
  ctx.sessionOutputBuffers.delete(sessionId);
  ctx.taskResponseMarkers.delete(sessionId);
  log(`Stopped session ${sessionId}`);
}
function subscribeToOutput(ctx, sessionId, callback) {
  if (ctx.usingBunWorker) {
    const unsubscribe2 = ctx.manager.onSessionData(sessionId, callback);
    ctx.outputUnsubscribers.set(sessionId, unsubscribe2);
    return unsubscribe2;
  }
  const ptySession = ctx.manager.getSession(sessionId);
  if (!ptySession) {
    throw new Error(`Session ${sessionId} not found`);
  }
  ptySession.on("output", callback);
  const unsubscribe = () => ptySession.off("output", callback);
  ctx.outputUnsubscribers.set(sessionId, unsubscribe);
  return unsubscribe;
}
async function getSessionOutput(ctx, sessionId, lines) {
  if (ctx.usingBunWorker) {
    const buffer = ctx.sessionOutputBuffers.get(sessionId);
    if (!buffer)
      return "";
    const tail = lines ?? buffer.length;
    return buffer.slice(-tail).join("\n");
  }
  const output = [];
  for await (const line of ctx.manager.logs(sessionId, {
    tail: lines
  })) {
    output.push(line);
  }
  return output.join("\n");
}

// src/services/pty-spawn.ts
function buildSanitizedBaseEnv() {
  const env = {};
  for (const key of ENV_ALLOWLIST) {
    const val = process.env[key];
    if (val)
      env[key] = val;
  }
  return env;
}
function setupOutputBuffer(ctx, sessionId) {
  const buffer = [];
  ctx.sessionOutputBuffers.set(sessionId, buffer);
  const unsubscribe = ctx.manager.onSessionData(sessionId, (data) => {
    const lines = data.split("\n");
    buffer.push(...lines);
    while (buffer.length > (ctx.serviceConfig.maxLogLines ?? 1000)) {
      buffer.shift();
    }
  });
  ctx.outputUnsubscribers.set(sessionId, unsubscribe);
}
function setupDeferredTaskDelivery(ctx, session, task, agentType) {
  const sid = session.id;
  const POST_READY_DELAY = {
    claude: 800,
    gemini: 300,
    codex: 300,
    aider: 200
  };
  const settleMs = POST_READY_DELAY[agentType] ?? 300;
  const VERIFY_DELAY_MS = 5000;
  const MAX_RETRIES = 2;
  const MIN_NEW_LINES = 15;
  const sendTaskWithRetry = (attempt) => {
    const buffer = ctx.sessionOutputBuffers.get(sid);
    const baselineLength = buffer?.length ?? 0;
    ctx.log(`Session ${sid} \u2014 sending task (attempt ${attempt + 1}, ${settleMs}ms settle, baseline ${baselineLength} lines)`);
    ctx.sendToSession(sid, task).catch((err) => ctx.log(`Failed to send deferred task to ${sid}: ${err}`));
    if (attempt < MAX_RETRIES) {
      setTimeout(() => {
        const currentLength = buffer?.length ?? 0;
        const newLines = currentLength - baselineLength;
        if (newLines < MIN_NEW_LINES) {
          ctx.log(`Session ${sid} \u2014 task may not have been accepted (only ${newLines} new lines after ${VERIFY_DELAY_MS}ms). Retrying (attempt ${attempt + 2}/${MAX_RETRIES + 1})`);
          sendTaskWithRetry(attempt + 1);
        } else {
          ctx.log(`Session ${sid} \u2014 task accepted (${newLines} new lines after ${VERIFY_DELAY_MS}ms)`);
        }
      }, VERIFY_DELAY_MS);
    }
  };
  let taskSent = false;
  const sendTask = () => {
    if (taskSent)
      return;
    taskSent = true;
    setTimeout(() => sendTaskWithRetry(0), settleMs);
    if (ctx.usingBunWorker) {
      ctx.manager.removeListener("session_ready", onReady);
    } else {
      ctx.manager.removeListener("session_ready", onReady);
    }
  };
  const onReady = (readySession) => {
    if (readySession.id !== sid)
      return;
    sendTask();
  };
  if (session.status === "ready") {
    sendTask();
  } else {
    if (ctx.usingBunWorker) {
      ctx.manager.on("session_ready", onReady);
    } else {
      ctx.manager.on("session_ready", onReady);
    }
  }
}
function buildSpawnConfig(sessionId, options, workdir) {
  const modelPrefs = options.metadata?.modelPrefs;
  let modelEnv;
  if (modelPrefs?.powerful) {
    const envKeyMap = {
      claude: "ANTHROPIC_MODEL",
      gemini: "GEMINI_MODEL",
      codex: "OPENAI_MODEL",
      aider: "AIDER_MODEL"
    };
    const key = envKeyMap[options.agentType];
    if (key)
      modelEnv = { [key]: modelPrefs.powerful };
  }
  return {
    id: sessionId,
    name: options.name,
    type: options.agentType,
    workdir,
    inheritProcessEnv: false,
    env: { ...buildSanitizedBaseEnv(), ...options.env, ...modelEnv },
    ...options.skipAdapterAutoResponse ? { skipAdapterAutoResponse: true } : {},
    adapterConfig: {
      ...options.credentials,
      ...options.customCredentials ? { custom: options.customCredentials } : {},
      interactive: true,
      approvalPreset: options.approvalPreset,
      ...options.metadata?.provider ? { provider: options.metadata.provider } : {},
      ...options.metadata?.modelTier ? { modelTier: options.metadata.modelTier } : {}
    }
  };
}
var ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TMPDIR",
  "XDG_RUNTIME_DIR",
  "NODE_OPTIONS",
  "BUN_INSTALL"
];

// src/services/pty-types.ts
var PI_AGENT_ALIASES = new Set([
  "pi",
  "pi-ai",
  "piai",
  "pi-coding-agent",
  "picodingagent"
]);
var isPiAgentType = (input) => {
  if (!input)
    return false;
  return PI_AGENT_ALIASES.has(input.toLowerCase().trim());
};
var normalizeAgentType = (input) => {
  const normalized = input.toLowerCase().trim();
  if (isPiAgentType(normalized)) {
    return "shell";
  }
  const mapping = {
    claude: "claude",
    "claude-code": "claude",
    claudecode: "claude",
    codex: "codex",
    openai: "codex",
    "openai-codex": "codex",
    gemini: "gemini",
    google: "gemini",
    aider: "aider",
    shell: "shell",
    bash: "shell"
  };
  return mapping[normalized] ?? "claude";
};
var toPiCommand = (task) => {
  const trimmed = task?.trim();
  if (!trimmed)
    return "pi";
  const shellSafe = `'${trimmed.replace(/'/g, `'"'"'`)}'`;
  return `pi ${shellSafe}`;
};

// src/services/stall-classifier.ts
init_ansi_utils();
import {ModelType} from "@elizaos/core";
import {
buildTaskCompletionTimeline,
extractTaskCompletionTraceRecords
} from "pty-manager";
function buildStallClassificationPrompt(agentType, sessionId, output) {
  return `You are Milady, an AI orchestrator managing coding agent sessions. ` + `A ${agentType} coding agent (session: ${sessionId}) appears to have stalled \u2014 ` + `it has stopped producing output while in a busy state.\n\n` + `Here is the recent terminal output:\n` + `---\n${output.slice(-1500)}\n---\n\n` + `Classify what's happening. Read the output carefully and choose the MOST specific match:\n\n` + `1. "task_complete" \u2014 The agent FINISHED its task and returned to its idle prompt. ` + `Strong indicators: a summary of completed work ("Done", "All done", "Here's what was completed"), ` + `timing info ("Baked for", "Churned for", "Crunched for", "Cooked for", "Worked for"), ` + `or the agent's main prompt symbol (\u276F) appearing AFTER completion output. ` + `If the output contains evidence of completed work followed by an idle prompt, this is ALWAYS task_complete, ` + `even though the agent is technically "waiting" \u2014 it is waiting for a NEW task, not asking a question.

` + `2. "waiting_for_input" \u2014 The agent is MID-TASK and blocked on a specific question or permission prompt. ` + `The agent has NOT finished its work \u2014 it needs a response to continue. ` + `Examples: Y/n confirmation, file permission dialogs, "Do you want to proceed?", ` + `tool approval prompts, or interactive menus. ` + `This is NOT the same as the agent sitting at its idle prompt after finishing work.\n\n` + `3. "still_working" \u2014 The agent is actively processing (API call, compilation, thinking, etc.) ` + `and has not produced final output yet. No prompt or completion summary visible.\n\n` + `4. "error" \u2014 The agent hit an error state (crash, unrecoverable error, stack trace).

` + `5. "tool_running" \u2014 The agent is using an external tool (browser automation, ` + `MCP tool, etc.). Indicators: "Claude in Chrome", "javascript_tool", ` + `"computer_tool", "screenshot", "navigate", tool execution output. ` + `The agent is actively working but the terminal may be quiet.\n\n` + `IMPORTANT: If you see BOTH completed work output AND an idle prompt (\u276F), choose "task_complete". ` + `Only choose "waiting_for_input" if the agent is clearly asking a question mid-task.\n\n` + `If "waiting_for_input", also provide:\n` + `- "prompt": the text of what it's asking\n` + `- "suggestedResponse": what to type/send. Use "keys:enter" for TUI menu confirmation, ` + `"keys:down,enter" to select a non-default option, or plain text like "y" for text prompts.\n\n` + `Respond with ONLY a JSON object:\n` + `{"state": "...", "prompt": "...", "suggestedResponse": "..."}`;
}
async function writeStallSnapshot(sessionId, agentType, recentOutput, effectiveOutput, buffers, traceEntries, log) {
  try {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const snapshotDir = path.join(os.homedir(), ".milady", "debug");
    fs.mkdirSync(snapshotDir, { recursive: true });
    const ourBuffer = buffers.get(sessionId);
    const ourTail = ourBuffer ? ourBuffer.slice(-100).join("\n") : "(no buffer)";
    let traceTimeline = "(no trace entries)";
    try {
      const records = extractTaskCompletionTraceRecords(traceEntries);
      const timeline = buildTaskCompletionTimeline(records, {
        adapterType: agentType
      });
      traceTimeline = JSON.stringify(timeline, null, 2);
    } catch (e) {
      traceTimeline = `(trace error: ${e})`;
    }
    const snapshot = [
      `=== STALL SNAPSHOT @ ${new Date().toISOString()} ===`,
      `Session: ${sessionId} | Agent: ${agentType}`,
      `recentOutput length: ${recentOutput.length} | effectiveOutput length: ${effectiveOutput.length}`,
      ``,
      `--- effectiveOutput (what LLM sees) ---`,
      effectiveOutput.slice(-1500),
      ``,
      `--- trace timeline ---`,
      traceTimeline,
      ``,
      `--- raw trace entries (last 20 of ${traceEntries.length}) ---`,
      traceEntries.slice(-20).join("\n"),
      ``
    ].join("\n");
    const snapshotPath = path.join(snapshotDir, `stall-snapshot-${sessionId}.txt`);
    fs.writeFileSync(snapshotPath, snapshot);
    log(`Stall snapshot \u2192 ${snapshotPath}`);
  } catch (_) {
  }
}
async function classifyStallOutput(ctx) {
  const {
    sessionId,
    recentOutput,
    agentType,
    buffers,
    traceEntries,
    runtime,
    manager,
    metricsTracker,
    log
  } = ctx;
  metricsTracker.incrementStalls(agentType);
  let effectiveOutput = recentOutput;
  if (!recentOutput || recentOutput.trim().length < 200) {
    const ourBuffer = buffers.get(sessionId);
    if (ourBuffer && ourBuffer.length > 0) {
      const rawTail = ourBuffer.slice(-100).join("\n");
      const stripped = stripAnsi(rawTail);
      if (stripped.length > effectiveOutput.length) {
        effectiveOutput = stripped;
        log(`Using own buffer for stall classification (${effectiveOutput.length} chars after stripping, pty-manager had ${recentOutput.length})`);
      }
    }
  }
  const systemPrompt = buildStallClassificationPrompt(agentType, sessionId, effectiveOutput);
  if (ctx.debugSnapshots) {
    await writeStallSnapshot(sessionId, agentType, recentOutput, effectiveOutput, buffers, traceEntries, log);
  }
  try {
    log(`Stall detected for ${sessionId}, asking LLM to classify...`);
    const result = await runtime.useModel(ModelType.TEXT_SMALL, {
      prompt: systemPrompt
    });
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      log(`Stall classification: no JSON in LLM response`);
      return null;
    }
    const parsed = JSON.parse(jsonMatch[0]);
    const validStates = [
      "waiting_for_input",
      "still_working",
      "task_complete",
      "error",
      "tool_running"
    ];
    if (!validStates.includes(parsed.state)) {
      log(`Stall classification: invalid state "${parsed.state}"`);
      return null;
    }
    const mappedState = parsed.state === "tool_running" ? "still_working" : parsed.state;
    const classification = {
      state: mappedState,
      prompt: parsed.prompt,
      suggestedResponse: parsed.suggestedResponse
    };
    log(`Stall classification for ${sessionId}: ${classification.state}${classification.suggestedResponse ? ` \u2192 "${classification.suggestedResponse}"` : ""}`);
    if (classification.state === "task_complete") {
      const session = manager?.get(sessionId);
      const durationMs = session?.startedAt ? Date.now() - new Date(session.startedAt).getTime() : 0;
      metricsTracker.recordCompletion(agentType, "classifier", durationMs);
    }
    return classification;
  } catch (err) {
    log(`Stall classification failed: ${err}`);
    return null;
  }
}

// src/services/swarm-coordinator.ts
init_ansi_utils();
init_swarm_decision_loop();
import {logger} from "@elizaos/core";

// src/services/swarm-idle-watchdog.ts
init_ansi_utils();
init_swarm_decision_loop();
import {ModelType as ModelType3} from "@elizaos/core";
async function scanIdleSessions(ctx) {
  const now = Date.now();
  for (const taskCtx of ctx.tasks.values()) {
    if (taskCtx.status !== "active")
      continue;
    const idleMs = now - taskCtx.lastActivityAt;
    if (idleMs < IDLE_THRESHOLD_MS)
      continue;
    if (ctx.inFlightDecisions.has(taskCtx.sessionId))
      continue;
    if (ctx.ptyService) {
      try {
        const currentOutput = await ctx.ptyService.getSessionOutput(taskCtx.sessionId, 20);
        const lastSeen = ctx.lastSeenOutput.get(taskCtx.sessionId) ?? "";
        ctx.lastSeenOutput.set(taskCtx.sessionId, currentOutput);
        if (currentOutput !== lastSeen) {
          taskCtx.lastActivityAt = now;
          taskCtx.idleCheckCount = 0;
          ctx.log(`Idle watchdog: "${taskCtx.label}" has fresh PTY output \u2014 not idle`);
          continue;
        }
      } catch {
      }
    }
    taskCtx.idleCheckCount++;
    const idleMinutes = Math.round(idleMs / 60000);
    ctx.log(`Idle watchdog: "${taskCtx.label}" idle for ${idleMinutes}m (check ${taskCtx.idleCheckCount}/${MAX_IDLE_CHECKS})`);
    if (taskCtx.idleCheckCount > MAX_IDLE_CHECKS) {
      ctx.log(`Idle watchdog: force-escalating "${taskCtx.label}" after ${MAX_IDLE_CHECKS} checks`);
      taskCtx.decisions.push({
        timestamp: now,
        event: "idle_watchdog",
        promptText: `Session idle for ${idleMinutes} minutes`,
        decision: "escalate",
        reasoning: `Force-escalated after ${MAX_IDLE_CHECKS} idle checks with no activity`
      });
      ctx.broadcast({
        type: "escalation",
        sessionId: taskCtx.sessionId,
        timestamp: now,
        data: {
          reason: "idle_watchdog_max_checks",
          idleMinutes,
          idleCheckCount: taskCtx.idleCheckCount
        }
      });
      ctx.sendChatMessage(`[${taskCtx.label}] Session has been idle for ${idleMinutes} minutes with no progress. Needs your attention.`, "coding-agent");
      continue;
    }
    await handleIdleCheck(ctx, taskCtx, idleMinutes);
  }
}
async function handleIdleCheck(ctx, taskCtx, idleMinutes) {
  const sessionId = taskCtx.sessionId;
  ctx.inFlightDecisions.add(sessionId);
  try {
    let recentOutput = "";
    if (ctx.ptyService) {
      try {
        const raw = await ctx.ptyService.getSessionOutput(sessionId, 50);
        recentOutput = cleanForChat(raw);
      } catch {
        recentOutput = "";
      }
    }
    const contextSummary = {
      sessionId,
      agentType: taskCtx.agentType,
      label: taskCtx.label,
      originalTask: taskCtx.originalTask,
      workdir: taskCtx.workdir
    };
    const decisionHistory = taskCtx.decisions.filter((d) => d.decision !== "auto_resolved").slice(-5).map((d) => ({
      event: d.event,
      promptText: d.promptText,
      action: d.decision,
      response: d.response,
      reasoning: d.reasoning
    }));
    const prompt = buildIdleCheckPrompt(contextSummary, recentOutput, idleMinutes, taskCtx.idleCheckCount, MAX_IDLE_CHECKS, decisionHistory);
    let decision = null;
    try {
      const result = await ctx.runtime.useModel(ModelType3.TEXT_SMALL, {
        prompt
      });
      decision = parseCoordinationResponse(result);
    } catch (err) {
      ctx.log(`Idle check LLM call failed: ${err}`);
    }
    if (!decision) {
      ctx.log(`Idle check for "${taskCtx.label}": LLM returned invalid response \u2014 escalating`);
      ctx.sendChatMessage(`[${taskCtx.label}] Session idle for ${idleMinutes}m \u2014 couldn't determine status. Needs your attention.`, "coding-agent");
      return;
    }
    taskCtx.decisions.push({
      timestamp: Date.now(),
      event: "idle_watchdog",
      promptText: `Session idle for ${idleMinutes} minutes`,
      decision: decision.action,
      response: decision.action === "respond" ? decision.useKeys ? `keys:${decision.keys?.join(",")}` : decision.response : undefined,
      reasoning: decision.reasoning
    });
    ctx.broadcast({
      type: "idle_check_decision",
      sessionId,
      timestamp: Date.now(),
      data: {
        action: decision.action,
        idleMinutes,
        idleCheckNumber: taskCtx.idleCheckCount,
        reasoning: decision.reasoning
      }
    });
    if (decision.action === "complete") {
    } else if (decision.action === "respond") {
      const actionDesc = decision.useKeys ? `Sent keys: ${decision.keys?.join(", ")}` : `Nudged: ${decision.response ?? ""}`;
      ctx.sendChatMessage(`[${taskCtx.label}] Idle for ${idleMinutes}m \u2014 ${actionDesc}`, "coding-agent");
    } else if (decision.action === "escalate") {
      ctx.sendChatMessage(`[${taskCtx.label}] Idle for ${idleMinutes}m \u2014 needs your attention: ${decision.reasoning}`, "coding-agent");
    } else if (decision.action === "ignore") {
      ctx.log(`Idle check for "${taskCtx.label}": LLM says still working \u2014 ${decision.reasoning}`);
    }
    await executeDecision(ctx, sessionId, decision);
  } finally {
    ctx.inFlightDecisions.delete(sessionId);
  }
}
var IDLE_THRESHOLD_MS = 5 * 60 * 1000;
var MAX_IDLE_CHECKS = 4;

// src/services/swarm-coordinator.ts
var UNREGISTERED_BUFFER_MS = 2000;
var IDLE_SCAN_INTERVAL_MS = 60 * 1000;

class SwarmCoordinator {
  static serviceType = "SWARM_COORDINATOR";
  runtime;
  ptyService = null;
  unsubscribeEvents = null;
  tasks = new Map;
  sseClients = new Set;
  supervisionLevel = "autonomous";
  pendingDecisions = new Map;
  inFlightDecisions = new Set;
  chatCallback = null;
  wsBroadcast = null;
  unregisteredBuffer = new Map;
  idleWatchdogTimer = null;
  lastSeenOutput = new Map;
  lastToolNotification = new Map;
  constructor(runtime) {
    this.runtime = runtime;
  }
  setChatCallback(cb) {
    this.chatCallback = cb;
    this.log("Chat callback wired");
  }
  setWsBroadcast(cb) {
    this.wsBroadcast = cb;
    this.log("WS broadcast callback wired");
  }
  sendChatMessage(text, source) {
    if (!this.chatCallback)
      return;
    this.chatCallback(text, source).catch((err) => {
      this.log(`Failed to send chat message: ${err}`);
    });
  }
  start(ptyService) {
    this.ptyService = ptyService;
    this.unsubscribeEvents = ptyService.onSessionEvent((sessionId, event, data) => {
      this.handleSessionEvent(sessionId, event, data).catch((err) => {
        this.log(`Error handling event: ${err}`);
      });
    });
    this.idleWatchdogTimer = setInterval(() => {
      scanIdleSessions(this).catch((err) => {
        this.log(`Idle watchdog error: ${err}`);
      });
    }, IDLE_SCAN_INTERVAL_MS);
    this.log("SwarmCoordinator started");
  }
  stop() {
    if (this.idleWatchdogTimer) {
      clearInterval(this.idleWatchdogTimer);
      this.idleWatchdogTimer = null;
    }
    if (this.unsubscribeEvents) {
      this.unsubscribeEvents();
      this.unsubscribeEvents = null;
    }
    for (const client of this.sseClients) {
      if (!client.writableEnded) {
        client.end();
      }
    }
    this.sseClients.clear();
    this.tasks.clear();
    this.pendingDecisions.clear();
    this.inFlightDecisions.clear();
    this.unregisteredBuffer.clear();
    this.lastSeenOutput.clear();
    this.lastToolNotification.clear();
    this.log("SwarmCoordinator stopped");
  }
  registerTask(sessionId, context) {
    this.tasks.set(sessionId, {
      sessionId,
      agentType: context.agentType,
      label: context.label,
      originalTask: context.originalTask,
      workdir: context.workdir,
      repo: context.repo,
      status: "active",
      decisions: [],
      autoResolvedCount: 0,
      registeredAt: Date.now(),
      lastActivityAt: Date.now(),
      idleCheckCount: 0
    });
    this.broadcast({
      type: "task_registered",
      sessionId,
      timestamp: Date.now(),
      data: {
        agentType: context.agentType,
        label: context.label,
        originalTask: context.originalTask
      }
    });
    const buffered = this.unregisteredBuffer.get(sessionId);
    if (buffered) {
      this.unregisteredBuffer.delete(sessionId);
      for (const entry of buffered) {
        this.handleSessionEvent(sessionId, entry.event, entry.data).catch((err) => {
          this.log(`Error replaying buffered event: ${err}`);
        });
      }
    }
  }
  getLastUsedRepo() {
    let latest;
    for (const task of this.tasks.values()) {
      if (task.repo && (!latest || task.registeredAt > latest.registeredAt)) {
        latest = task;
      }
    }
    return latest?.repo;
  }
  getTaskContext(sessionId) {
    return this.tasks.get(sessionId);
  }
  getAllTaskContexts() {
    return Array.from(this.tasks.values());
  }
  addSseClient(res) {
    this.sseClients.add(res);
    const snapshot = {
      type: "snapshot",
      sessionId: "*",
      timestamp: Date.now(),
      data: {
        tasks: this.getAllTaskContexts(),
        supervisionLevel: this.supervisionLevel,
        pendingCount: this.pendingDecisions.size
      }
    };
    this.writeSseEvent(res, snapshot);
    const cleanup = () => {
      this.sseClients.delete(res);
    };
    res.on("close", cleanup);
    return cleanup;
  }
  broadcast(event) {
    const dead = [];
    for (const client of this.sseClients) {
      if (client.writableEnded) {
        dead.push(client);
        continue;
      }
      this.writeSseEvent(client, event);
    }
    for (const d of dead) {
      this.sseClients.delete(d);
    }
    this.wsBroadcast?.(event);
  }
  writeSseEvent(res, event) {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {
    }
  }
  async handleSessionEvent(sessionId, event, data) {
    const taskCtx = this.tasks.get(sessionId);
    if (!taskCtx) {
      if (event === "blocked" || event === "task_complete" || event === "error") {
        let buffer = this.unregisteredBuffer.get(sessionId);
        if (!buffer) {
          buffer = [];
          this.unregisteredBuffer.set(sessionId, buffer);
        }
        buffer.push({ event, data, receivedAt: Date.now() });
        setTimeout(() => {
          const stillBuffered = this.unregisteredBuffer.get(sessionId);
          if (stillBuffered && stillBuffered.length > 0) {
            const ctx = this.tasks.get(sessionId);
            if (ctx) {
              this.unregisteredBuffer.delete(sessionId);
              for (const entry of stillBuffered) {
                this.handleSessionEvent(sessionId, entry.event, entry.data).catch(() => {
                });
              }
            } else {
              this.unregisteredBuffer.delete(sessionId);
              this.log(`Discarding ${stillBuffered.length} buffered events for unregistered session ${sessionId}`);
            }
          }
        }, UNREGISTERED_BUFFER_MS);
      }
      return;
    }
    if (taskCtx.status === "stopped" || taskCtx.status === "error" || taskCtx.status === "completed") {
      if (event !== "stopped" && event !== "error") {
        this.log(`Ignoring "${event}" for ${taskCtx.label} (status: ${taskCtx.status})`);
        return;
      }
    }
    taskCtx.lastActivityAt = Date.now();
    taskCtx.idleCheckCount = 0;
    switch (event) {
      case "blocked":
        await handleBlocked(this, sessionId, taskCtx, data);
        break;
      case "task_complete": {
        this.broadcast({
          type: "turn_complete",
          sessionId,
          timestamp: Date.now(),
          data
        });
        await handleTurnComplete(this, sessionId, taskCtx, data);
        break;
      }
      case "error": {
        taskCtx.status = "error";
        this.broadcast({
          type: "error",
          sessionId,
          timestamp: Date.now(),
          data
        });
        const errorMsg = data.message ?? "unknown error";
        this.sendChatMessage(`"${taskCtx.label}" hit an error: ${errorMsg}`, "coding-agent");
        break;
      }
      case "stopped":
        taskCtx.status = "stopped";
        this.inFlightDecisions.delete(sessionId);
        this.broadcast({
          type: "stopped",
          sessionId,
          timestamp: Date.now(),
          data
        });
        break;
      case "ready":
        this.broadcast({
          type: "ready",
          sessionId,
          timestamp: Date.now(),
          data
        });
        break;
      case "tool_running": {
        taskCtx.lastActivityAt = Date.now();
        taskCtx.idleCheckCount = 0;
        this.broadcast({
          type: "tool_running",
          sessionId,
          timestamp: Date.now(),
          data
        });
        const toolData = data;
        const now = Date.now();
        const lastNotif = this.lastToolNotification.get(sessionId) ?? 0;
        if (now - lastNotif > 30000) {
          this.lastToolNotification.set(sessionId, now);
          const toolDesc = toolData.description ?? toolData.toolName ?? "an external tool";
          let urlSuffix = "";
          if (this.ptyService) {
            try {
              const recentOutput = await this.ptyService.getSessionOutput(sessionId, 50);
              const devUrl = extractDevServerUrl(recentOutput);
              if (devUrl) {
                urlSuffix = ` Dev server running at ${devUrl}`;
              }
            } catch {
            }
          }
          this.sendChatMessage(`[${taskCtx.label}] Running ${toolDesc}.${urlSuffix} The agent is working outside the terminal \u2014 I'll let it finish.`, "coding-agent");
        }
        break;
      }
      default:
        this.broadcast({
          type: event,
          sessionId,
          timestamp: Date.now(),
          data
        });
    }
  }
  async makeCoordinationDecision(taskCtx, promptText, recentOutput) {
    const { makeCoordinationDecision: mkDecision } = await Promise.resolve().then(() => (init_swarm_decision_loop(), exports_swarm_decision_loop));
    return mkDecision(this, taskCtx, promptText, recentOutput);
  }
  async executeDecision(sessionId, decision) {
    return executeDecision(this, sessionId, decision);
  }
  setSupervisionLevel(level) {
    this.supervisionLevel = level;
    this.broadcast({
      type: "supervision_changed",
      sessionId: "*",
      timestamp: Date.now(),
      data: { level }
    });
    this.log(`Supervision level set to: ${level}`);
  }
  getSupervisionLevel() {
    return this.supervisionLevel;
  }
  getPendingConfirmations() {
    return Array.from(this.pendingDecisions.values());
  }
  async confirmDecision(sessionId, approved, override) {
    const pending = this.pendingDecisions.get(sessionId);
    if (!pending) {
      throw new Error(`No pending decision for session ${sessionId}`);
    }
    this.pendingDecisions.delete(sessionId);
    const taskCtx = this.tasks.get(sessionId);
    if (approved) {
      const decision = override ? {
        action: "respond",
        response: override.response,
        useKeys: override.useKeys,
        keys: override.keys,
        reasoning: "Human-approved (with override)"
      } : pending.llmDecision;
      if (taskCtx) {
        taskCtx.decisions.push({
          timestamp: Date.now(),
          event: "blocked",
          promptText: pending.promptText,
          decision: decision.action,
          response: decision.action === "respond" ? decision.useKeys ? `keys:${decision.keys?.join(",")}` : decision.response : undefined,
          reasoning: `Human-approved: ${decision.reasoning}`
        });
        taskCtx.autoResolvedCount = 0;
      }
      await this.executeDecision(sessionId, decision);
      this.broadcast({
        type: "confirmation_approved",
        sessionId,
        timestamp: Date.now(),
        data: {
          action: decision.action,
          response: decision.response,
          useKeys: decision.useKeys,
          keys: decision.keys
        }
      });
    } else {
      if (taskCtx) {
        taskCtx.decisions.push({
          timestamp: Date.now(),
          event: "blocked",
          promptText: pending.promptText,
          decision: "escalate",
          reasoning: "Human rejected the suggested action"
        });
      }
      this.broadcast({
        type: "confirmation_rejected",
        sessionId,
        timestamp: Date.now(),
        data: { prompt: pending.promptText }
      });
    }
  }
  log(message) {
    logger.info(`[SwarmCoordinator] ${message}`);
  }
}

// src/services/pty-service.ts
function getCoordinator(runtime) {
  const ptyService = runtime.getService("PTY_SERVICE");
  return ptyService?.coordinator ?? undefined;
}

class PTYService {
  static serviceType = "PTY_SERVICE";
  capabilityDescription = "Manages PTY sessions for CLI coding agents";
  runtime;
  manager = null;
  usingBunWorker = false;
  serviceConfig;
  sessionMetadata = new Map;
  sessionWorkdirs = new Map;
  eventCallbacks = [];
  outputUnsubscribers = new Map;
  sessionOutputBuffers = new Map;
  adapterCache = new Map;
  taskResponseMarkers = new Map;
  traceEntries = [];
  static MAX_TRACE_ENTRIES = 200;
  metricsTracker = new AgentMetricsTracker;
  consoleBridge = null;
  coordinator = null;
  constructor(runtime, config = {}) {
    this.runtime = runtime;
    this.serviceConfig = {
      maxLogLines: config.maxLogLines ?? 1000,
      debug: config.debug ?? false,
      registerCodingAdapters: config.registerCodingAdapters ?? true,
      maxConcurrentSessions: config.maxConcurrentSessions ?? 8,
      defaultApprovalPreset: config.defaultApprovalPreset ?? "permissive"
    };
  }
  static async start(runtime) {
    const config = runtime.getSetting("PTY_SERVICE_CONFIG");
    const service = new PTYService(runtime, config ?? {});
    await service.initialize();
    try {
      const coordinator = new SwarmCoordinator(runtime);
      coordinator.start(service);
      service.coordinator = coordinator;
      runtime.services.set("SWARM_COORDINATOR", [coordinator]);
      logger2.info("[PTYService] SwarmCoordinator wired and started");
    } catch (err) {
      logger2.error(`[PTYService] Failed to wire SwarmCoordinator: ${err}`);
    }
    return service;
  }
  static async stopRuntime(runtime) {
    const service = runtime.getService("PTY_SERVICE");
    if (service) {
      await service.stop();
    }
  }
  async initialize() {
    const result = await initializePTYManager({
      serviceConfig: this.serviceConfig,
      classifyStall: (id, out) => this.classifyStall(id, out),
      emitEvent: (id, event, data) => this.emitEvent(id, event, data),
      handleGeminiAuth: (id) => this.handleGeminiAuth(id),
      sessionOutputBuffers: this.sessionOutputBuffers,
      taskResponseMarkers: this.taskResponseMarkers,
      metricsTracker: this.metricsTracker,
      traceEntries: this.traceEntries,
      maxTraceEntries: PTYService.MAX_TRACE_ENTRIES,
      log: (msg) => this.log(msg)
    });
    this.manager = result.manager;
    this.usingBunWorker = result.usingBunWorker;
    try {
      this.consoleBridge = new PTYConsoleBridge(this.manager, {
        maxBufferedCharsPerSession: 1e5
      });
      this.log("PTYConsoleBridge wired");
    } catch (err) {
      this.log(`Failed to wire PTYConsoleBridge: ${err}`);
    }
    this.log("PTYService initialized");
  }
  async stop() {
    if (this.coordinator) {
      this.coordinator.stop();
      this.runtime.services.delete("SWARM_COORDINATOR");
      this.coordinator = null;
    }
    if (this.consoleBridge) {
      this.consoleBridge.close();
      this.consoleBridge = null;
    }
    for (const unsubscribe of this.outputUnsubscribers.values()) {
      unsubscribe();
    }
    this.outputUnsubscribers.clear();
    if (this.manager) {
      await this.manager.shutdown();
      this.manager = null;
    }
    this.sessionMetadata.clear();
    this.sessionWorkdirs.clear();
    this.sessionOutputBuffers.clear();
    this.log("PTYService shutdown complete");
  }
  generateSessionId() {
    return `pty-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  }
  ioContext() {
    return {
      manager: this.manager,
      usingBunWorker: this.usingBunWorker,
      sessionOutputBuffers: this.sessionOutputBuffers,
      taskResponseMarkers: this.taskResponseMarkers,
      outputUnsubscribers: this.outputUnsubscribers
    };
  }
  async spawnSession(options) {
    if (!this.manager) {
      throw new Error("PTYService not initialized");
    }
    const piRequested = isPiAgentType(options.agentType);
    const resolvedAgentType = piRequested ? "shell" : options.agentType;
    const resolvedInitialTask = piRequested ? toPiCommand(options.initialTask) : options.initialTask;
    const maxSessions = this.serviceConfig.maxConcurrentSessions ?? 8;
    const activeSessions = (await this.listSessions()).length;
    if (activeSessions >= maxSessions) {
      throw new Error(`Concurrent session limit reached (${maxSessions})`);
    }
    const sessionId = this.generateSessionId();
    const workdir = options.workdir ?? process.cwd();
    this.sessionWorkdirs.set(sessionId, workdir);
    if (options.memoryContent && resolvedAgentType !== "shell") {
      try {
        const writtenPath = await this.writeMemoryFile(resolvedAgentType, workdir, options.memoryContent);
        this.log(`Wrote memory file for ${resolvedAgentType}: ${writtenPath}`);
      } catch (err) {
        this.log(`Failed to write memory file for ${resolvedAgentType}: ${err}`);
      }
    }
    if (options.approvalPreset && resolvedAgentType !== "shell") {
      try {
        const written = await this.getAdapter(resolvedAgentType).writeApprovalConfig(workdir, {
          name: options.name,
          type: resolvedAgentType,
          workdir,
          adapterConfig: { approvalPreset: options.approvalPreset }
        });
        this.log(`Wrote approval config (${options.approvalPreset}) for ${resolvedAgentType}: ${written.join(", ")}`);
      } catch (err) {
        this.log(`Failed to write approval config: ${err}`);
      }
    }
    if (resolvedAgentType === "claude") {
      try {
        const settingsPath = join(workdir, ".claude", "settings.json");
        let settings = {};
        try {
          settings = JSON.parse(await readFile(settingsPath, "utf-8"));
        } catch {
        }
        const permissions = settings.permissions ?? {};
        permissions.allowedDirectories = [workdir];
        settings.permissions = permissions;
        await mkdir(dirname(settingsPath), { recursive: true });
        await writeFile(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
        this.log(`Wrote allowedDirectories [${workdir}] to ${settingsPath}`);
      } catch (err) {
        this.log(`Failed to write allowedDirectories: ${err}`);
      }
    }
    const spawnConfig = buildSpawnConfig(sessionId, {
      ...options,
      agentType: resolvedAgentType,
      initialTask: resolvedInitialTask
    }, workdir);
    const session = await this.manager.spawn(spawnConfig);
    this.sessionMetadata.set(session.id, {
      ...options.metadata,
      requestedType: options.metadata?.requestedType ?? options.agentType,
      agentType: resolvedAgentType,
      coordinatorManaged: !!options.skipAdapterAutoResponse
    });
    const ctx = {
      manager: this.manager,
      usingBunWorker: this.usingBunWorker,
      serviceConfig: this.serviceConfig,
      sessionMetadata: this.sessionMetadata,
      sessionWorkdirs: this.sessionWorkdirs,
      sessionOutputBuffers: this.sessionOutputBuffers,
      outputUnsubscribers: this.outputUnsubscribers,
      taskResponseMarkers: this.taskResponseMarkers,
      getAdapter: (t) => this.getAdapter(t),
      sendToSession: (id, input) => this.sendToSession(id, input),
      sendKeysToSession: (id, keys) => this.sendKeysToSession(id, keys),
      pushDefaultRules: (id, type) => this.pushDefaultRules(id, type),
      toSessionInfo: (s, w) => this.toSessionInfo(s, w),
      log: (msg) => this.log(msg)
    };
    if (this.usingBunWorker) {
      setupOutputBuffer(ctx, session.id);
    }
    if (resolvedInitialTask) {
      setupDeferredTaskDelivery(ctx, session, resolvedInitialTask, resolvedAgentType);
    }
    await this.pushDefaultRules(session.id, resolvedAgentType);
    this.metricsTracker.get(resolvedAgentType).spawned++;
    this.log(`Spawned session ${session.id} (${resolvedAgentType})`);
    return this.toSessionInfo(session, workdir);
  }
  autoResponseContext() {
    return {
      manager: this.manager,
      usingBunWorker: this.usingBunWorker,
      runtime: this.runtime,
      log: (msg) => this.log(msg)
    };
  }
  async pushDefaultRules(sessionId, agentType) {
    if (!this.manager)
      return;
    await pushDefaultRules(this.autoResponseContext(), sessionId, agentType);
  }
  async handleGeminiAuth(sessionId) {
    await handleGeminiAuth(this.autoResponseContext(), sessionId, (id, keys) => this.sendKeysToSession(id, keys));
  }
  async sendToSession(sessionId, input) {
    if (!this.manager)
      throw new Error("PTYService not initialized");
    return sendToSession(this.ioContext(), sessionId, input);
  }
  async sendKeysToSession(sessionId, keys) {
    if (!this.manager)
      throw new Error("PTYService not initialized");
    return sendKeysToSession(this.ioContext(), sessionId, keys);
  }
  async stopSession(sessionId) {
    if (!this.manager)
      throw new Error("PTYService not initialized");
    return stopSession(this.ioContext(), sessionId, this.sessionMetadata, this.sessionWorkdirs, (msg) => this.log(msg));
  }
  get defaultApprovalPreset() {
    const fromEnv = this.runtime.getSetting("PARALLAX_DEFAULT_APPROVAL_PRESET");
    if (fromEnv && ["readonly", "standard", "permissive", "autonomous"].includes(fromEnv)) {
      return fromEnv;
    }
    return this.serviceConfig.defaultApprovalPreset ?? "permissive";
  }
  get agentSelectionStrategy() {
    const fromEnv = this.runtime.getSetting("PARALLAX_AGENT_SELECTION_STRATEGY");
    if (fromEnv && (fromEnv === "fixed" || fromEnv === "ranked")) {
      return fromEnv;
    }
    return "fixed";
  }
  get defaultAgentType() {
    const fromEnv = this.runtime.getSetting("PARALLAX_DEFAULT_AGENT_TYPE");
    if (fromEnv && ["claude", "gemini", "codex", "aider"].includes(fromEnv.toLowerCase())) {
      return fromEnv.toLowerCase();
    }
    return "claude";
  }
  async resolveAgentType() {
    const strategy = this.agentSelectionStrategy;
    const fixedAgentType = this.defaultAgentType;
    if (strategy === "fixed") {
      return fixedAgentType;
    }
    const preflight = await this.checkAvailableAgents();
    const metrics = this.metricsTracker.getAll();
    return selectAgentType({
      config: { strategy, fixedAgentType },
      metrics,
      installedAgents: preflight
    });
  }
  getSession(sessionId) {
    if (!this.manager)
      return;
    const session = this.manager.get(sessionId);
    if (!session)
      return;
    return this.toSessionInfo(session, this.sessionWorkdirs.get(sessionId));
  }
  async listSessions(filter) {
    if (!this.manager)
      return [];
    const sessions = this.usingBunWorker ? await this.manager.list() : this.manager.list(filter);
    return sessions.map((s) => this.toSessionInfo(s, this.sessionWorkdirs.get(s.id)));
  }
  subscribeToOutput(sessionId, callback) {
    if (!this.manager)
      throw new Error("PTYService not initialized");
    return subscribeToOutput(this.ioContext(), sessionId, callback);
  }
  async getSessionOutput(sessionId, lines) {
    if (!this.manager)
      throw new Error("PTYService not initialized");
    return getSessionOutput(this.ioContext(), sessionId, lines);
  }
  isSessionBlocked(sessionId) {
    const session = this.getSession(sessionId);
    return session?.status === "authenticating";
  }
  async checkAvailableAgents(types) {
    const agentTypes = types ?? ["claude", "gemini", "codex", "aider"];
    return checkAdapters(agentTypes);
  }
  getSupportedAgentTypes() {
    return ["shell", "claude", "gemini", "codex", "aider", "pi"];
  }
  async classifyStall(sessionId, recentOutput) {
    const meta = this.sessionMetadata.get(sessionId);
    const agentType = meta?.agentType ?? "unknown";
    const classification = await classifyStallOutput({
      sessionId,
      recentOutput,
      agentType,
      buffers: this.sessionOutputBuffers,
      traceEntries: this.traceEntries,
      runtime: this.runtime,
      manager: this.manager,
      metricsTracker: this.metricsTracker,
      debugSnapshots: this.serviceConfig.debug === true,
      log: (msg) => this.log(msg)
    });
    if (classification && meta?.coordinatorManaged && classification.suggestedResponse) {
      this.log(`Suppressing stall auto-response for coordinator-managed session ${sessionId} ` + `(would have sent: "${classification.suggestedResponse}")`);
      classification.suggestedResponse = undefined;
    }
    return classification;
  }
  getAdapter(agentType) {
    let adapter = this.adapterCache.get(agentType);
    if (!adapter) {
      adapter = createAdapter(agentType);
      this.adapterCache.set(agentType, adapter);
    }
    return adapter;
  }
  getWorkspaceFiles(agentType) {
    return this.getAdapter(agentType).getWorkspaceFiles();
  }
  getMemoryFilePath(agentType) {
    return this.getAdapter(agentType).memoryFilePath;
  }
  getApprovalConfig(agentType, preset) {
    return generateApprovalConfig(agentType, preset);
  }
  async writeMemoryFile(agentType, workspacePath, content, options) {
    return this.getAdapter(agentType).writeMemoryFile(workspacePath, content, options);
  }
  onSessionEvent(callback) {
    this.eventCallbacks.push(callback);
    return () => {
      const idx = this.eventCallbacks.indexOf(callback);
      if (idx !== -1)
        this.eventCallbacks.splice(idx, 1);
    };
  }
  registerAdapter(adapter) {
    if (!this.manager) {
      throw new Error("PTYService not initialized");
    }
    if (this.usingBunWorker) {
      this.log("registerAdapter not available with Bun worker - adapters must be in the worker");
      return;
    }
    this.manager.registerAdapter(adapter);
    this.log(`Registered adapter`);
  }
  toSessionInfo(session, workdir) {
    const metadata = this.sessionMetadata.get(session.id);
    const requestedType = typeof metadata?.requestedType === "string" ? metadata.requestedType : undefined;
    const displayAgentType = session.type === "shell" && isPiAgentType(requestedType) ? "pi" : session.type;
    return {
      id: session.id,
      name: session.name,
      agentType: displayAgentType,
      workdir: workdir ?? process.cwd(),
      status: session.status,
      createdAt: session.startedAt ? new Date(session.startedAt) : new Date,
      lastActivityAt: session.lastActivityAt ? new Date(session.lastActivityAt) : new Date,
      metadata
    };
  }
  emitEvent(sessionId, event, data) {
    for (const callback of this.eventCallbacks) {
      try {
        callback(sessionId, event, data);
      } catch (err) {
        this.log(`Event callback error: ${err}`);
      }
    }
  }
  getAgentMetrics() {
    return this.metricsTracker.getAll();
  }
  log(message) {
    if (this.serviceConfig.debug) {
      logger2.debug(`[PTYService] ${message}`);
    }
  }
}

// src/actions/spawn-agent.ts
var spawnAgentAction = {
  name: "SPAWN_CODING_AGENT",
  similes: [
    "START_CODING_AGENT",
    "LAUNCH_CODING_AGENT",
    "CREATE_CODING_AGENT",
    "SPAWN_CODER",
    "RUN_CODING_AGENT"
  ],
  description: "Spawn a CLI coding agent (Claude Code, Codex, Gemini, Aider, Pi) to work on a coding task. " + "The agent runs in a PTY session and can execute code, run tests, and make changes. " + "Returns a session ID that can be used to interact with the agent.",
  examples: [
    [
      {
        name: "{{user1}}",
        content: { text: "Spawn Claude Code to fix the bug in auth.ts" }
      },
      {
        name: "{{agentName}}",
        content: {
          text: "I'll spawn Claude Code to work on that. Let me set up the coding session.",
          action: "SPAWN_CODING_AGENT"
        }
      }
    ],
    [
      {
        name: "{{user1}}",
        content: { text: "Start a coding agent to implement the new feature" }
      },
      {
        name: "{{agentName}}",
        content: {
          text: "I'll create a coding session for that task.",
          action: "SPAWN_CODING_AGENT"
        }
      }
    ]
  ],
  validate: async (runtime, _message) => {
    const ptyService = runtime.getService("PTY_SERVICE");
    if (!ptyService) {
      logger3.warn("[SPAWN_CODING_AGENT] PTYService not available");
      return false;
    }
    return true;
  },
  handler: async (runtime, message, state, options, callback) => {
    const ptyService = runtime.getService("PTY_SERVICE");
    if (!ptyService) {
      if (callback) {
        await callback({
          text: "PTY Service is not available. Cannot spawn coding agent."
        });
      }
      return { success: false, error: "SERVICE_UNAVAILABLE" };
    }
    const params = options?.parameters;
    const content = message.content;
    const rawAgentType = params?.agentType ?? content.agentType ?? "claude";
    const agentType = normalizeAgentType(rawAgentType);
    const task = params?.task ?? content.task;
    const piRequested = isPiAgentType(rawAgentType);
    const initialTask = piRequested ? toPiCommand(task) : task;
    let workdir = params?.workdir ?? content.workdir;
    if (!workdir && state?.codingWorkspace) {
      workdir = state.codingWorkspace.path;
    }
    if (!workdir) {
      const wsService = runtime.getService("CODING_WORKSPACE_SERVICE");
      if (wsService) {
        const workspaces = wsService.listWorkspaces();
        if (workspaces.length > 0) {
          workdir = workspaces[workspaces.length - 1].path;
        }
      }
    }
    if (!workdir) {
      if (callback) {
        await callback({
          text: "No workspace found. Please provision a workspace first using PROVISION_WORKSPACE or provide a workdir."
        });
      }
      return { success: false, error: "NO_WORKSPACE" };
    }
    const resolvedWorkdir = path2.resolve(workdir);
    const workspaceBaseDir = path2.join(os.homedir(), ".milady", "workspaces");
    const allowedPrefixes = [
      path2.resolve(workspaceBaseDir),
      path2.resolve(process.cwd())
    ];
    const isAllowed = allowedPrefixes.some((prefix) => resolvedWorkdir.startsWith(prefix + path2.sep) || resolvedWorkdir === prefix);
    if (!isAllowed) {
      if (callback) {
        await callback({
          text: "The specified workdir is outside of allowed directories. Please use a workspace directory."
        });
      }
      return { success: false, error: "WORKDIR_OUTSIDE_ALLOWED" };
    }
    workdir = resolvedWorkdir;
    const memoryContent = params?.memoryContent ?? content.memoryContent;
    const approvalPreset = params?.approvalPreset ?? content.approvalPreset;
    const customCredentialKeys = runtime.getSetting("CUSTOM_CREDENTIAL_KEYS");
    let customCredentials;
    if (customCredentialKeys) {
      customCredentials = {};
      for (const key of customCredentialKeys.split(",").map((k) => k.trim())) {
        const val = runtime.getSetting(key);
        if (val)
          customCredentials[key] = val;
      }
    }
    const credentials = {
      anthropicKey: runtime.getSetting("ANTHROPIC_API_KEY"),
      openaiKey: runtime.getSetting("OPENAI_API_KEY"),
      googleKey: runtime.getSetting("GOOGLE_GENERATIVE_AI_API_KEY"),
      githubToken: runtime.getSetting("GITHUB_TOKEN")
    };
    try {
      if (agentType !== "shell" && agentType !== "pi") {
        const [preflight] = await ptyService.checkAvailableAgents([
          agentType
        ]);
        if (preflight && !preflight.installed) {
          if (callback) {
            await callback({
              text: `${preflight.adapter} CLI is not installed.\n` + `Install with: ${preflight.installCommand}\n` + `Docs: ${preflight.docsUrl}`
            });
          }
          return { success: false, error: "AGENT_NOT_INSTALLED" };
        }
      }
      const coordinator = getCoordinator(runtime);
      const session = await ptyService.spawnSession({
        name: `coding-${Date.now()}`,
        agentType,
        workdir,
        initialTask,
        memoryContent,
        credentials,
        approvalPreset: approvalPreset ?? ptyService.defaultApprovalPreset,
        customCredentials,
        ...coordinator ? { skipAdapterAutoResponse: true } : {},
        metadata: {
          requestedType: rawAgentType,
          messageId: message.id,
          userId: message.userId
        }
      });
      ptyService.onSessionEvent((sessionId, event, data) => {
        if (sessionId !== session.id)
          return;
        logger3.debug(`[Session ${sessionId}] ${event}: ${JSON.stringify(data)}`);
        if (!coordinator) {
          if (event === "blocked" && callback) {
            callback({
              text: `Coding agent is waiting for input: ${data.prompt ?? "unknown prompt"}`
            });
          }
          if (event === "completed" && callback) {
            callback({
              text: "Coding agent completed the task."
            });
          }
          if (event === "error" && callback) {
            callback({
              text: `Coding agent encountered an error: ${data.message ?? "unknown error"}`
            });
          }
        }
      });
      if (coordinator && task) {
        coordinator.registerTask(session.id, {
          agentType,
          label: `agent-${session.id.slice(-8)}`,
          originalTask: task,
          workdir
        });
      }
      if (state) {
        state.codingSession = {
          id: session.id,
          agentType: session.agentType,
          workdir: session.workdir,
          status: session.status
        };
      }
      if (callback) {
        await callback({
          text: `Started ${piRequested ? "pi" : agentType} coding agent in ${workdir}${task ? ` with task: "${task}"` : ""}. Session ID: ${session.id}`
        });
      }
      return {
        success: true,
        text: `Started ${piRequested ? "pi" : agentType} coding agent`,
        data: {
          sessionId: session.id,
          agentType: piRequested ? "pi" : session.agentType,
          workdir: session.workdir,
          status: session.status
        }
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger3.error("[SPAWN_CODING_AGENT] Failed to spawn agent:", errorMessage);
      if (callback) {
        await callback({
          text: `Failed to spawn coding agent: ${errorMessage}`
        });
      }
      return { success: false, error: errorMessage };
    }
  },
  parameters: [
    {
      name: "agentType",
      description: "Type of coding agent to spawn. Options: claude (Claude Code), codex (OpenAI Codex), gemini (Google Gemini), aider, pi, shell (generic shell)",
      required: false,
      schema: { type: "string", default: "claude" }
    },
    {
      name: "workdir",
      description: "Working directory for the agent. Defaults to current directory.",
      required: false,
      schema: { type: "string" }
    },
    {
      name: "task",
      description: "Initial task or prompt to send to the agent once spawned.",
      required: false,
      schema: { type: "string" }
    },
    {
      name: "memoryContent",
      description: "Instructions/context to write to the agent's memory file (e.g. CLAUDE.md) before spawning.",
      required: false,
      schema: { type: "string" }
    },
    {
      name: "approvalPreset",
      description: "Permission level: readonly (safe audit), standard (reads+web auto, writes prompt), permissive (file ops auto, shell prompts), autonomous (all auto, use with sandbox)",
      required: false,
      schema: {
        type: "string",
        enum: ["readonly", "standard", "permissive", "autonomous"]
      }
    }
  ]
};

// src/actions/coding-task-handlers.ts
import {
logger as logger5
} from "@elizaos/core";

// src/actions/coding-task-helpers.ts
import {randomUUID} from "node:crypto";
import * as fs from "node:fs";
import * as os2 from "node:os";
import * as path3 from "node:path";
import {
logger as logger4
} from "@elizaos/core";
function createScratchDir() {
  const baseDir = path3.join(os2.homedir(), ".milady", "workspaces");
  const scratchId = randomUUID();
  const scratchDir = path3.join(baseDir, scratchId);
  fs.mkdirSync(scratchDir, { recursive: true });
  return scratchDir;
}
function generateLabel(repo, task) {
  const parts = [];
  if (repo) {
    const match = repo.match(/\/([^/]+?)(?:\.git)?$/);
    parts.push(match ? match[1] : "repo");
  } else {
    parts.push("scratch");
  }
  if (task) {
    const slug = task.toLowerCase().replace(/[^a-z0-9\s-]/g, "").split(/\s+/).filter((w) => w.length > 2 && !["the", "and", "for", "with", "that", "this", "from"].includes(w)).slice(0, 3).join("-");
    if (slug)
      parts.push(slug);
  }
  return parts.join("/");
}
function registerSessionEvents(ptyService, runtime, sessionId, label, scratchDir, callback, coordinatorActive = false) {
  ptyService.onSessionEvent((sid, event, data) => {
    if (sid !== sessionId)
      return;
    if (!coordinatorActive) {
      if (event === "blocked" && callback) {
        callback({
          text: `Agent "${label}" is waiting for input: ${data.prompt ?? "unknown prompt"}`
        });
      }
      if (event === "task_complete") {
        if (callback) {
          const response = data.response ?? "";
          const preview = response.length > 500 ? `${response.slice(0, 500)}...` : response;
          callback({
            text: preview ? `Agent "${label}" completed the task.\n\n${preview}` : `Agent "${label}" completed the task.`
          });
        }
        ptyService.stopSession(sessionId).catch((err) => {
          logger4.warn(`[START_CODING_TASK] Failed to stop session for "${label}" after task complete: ${err}`);
        });
      }
      if (event === "error" && callback) {
        callback({
          text: `Agent "${label}" encountered an error: ${data.message ?? "unknown error"}`
        });
      }
    }
    if ((event === "stopped" || event === "task_complete" || event === "error") && scratchDir) {
      const wsService = runtime.getService("CODING_WORKSPACE_SERVICE");
      if (wsService) {
        wsService.removeScratchDir(scratchDir).catch((err) => {
          logger4.warn(`[START_CODING_TASK] Failed to cleanup scratch dir for "${label}": ${err}`);
        });
      }
    }
  });
}

// src/actions/coding-task-handlers.ts
async function handleMultiAgent(ctx, agentsParam) {
  const {
    runtime,
    ptyService,
    wsService,
    credentials,
    customCredentials,
    callback,
    message,
    state,
    repo,
    defaultAgentType,
    rawAgentType,
    memoryContent,
    approvalPreset,
    explicitLabel
  } = ctx;
  const agentSpecs = agentsParam.split("|").map((s) => s.trim()).filter(Boolean);
  if (agentSpecs.length === 0) {
    if (callback) {
      await callback({
        text: "No agent tasks provided in agents parameter."
      });
    }
    return { success: false, error: "EMPTY_AGENTS_PARAM" };
  }
  if (agentSpecs.length > MAX_CONCURRENT_AGENTS) {
    if (callback) {
      await callback({
        text: `Too many agents requested (${agentSpecs.length}). Maximum is ${MAX_CONCURRENT_AGENTS}.`
      });
    }
    return { success: false, error: "TOO_MANY_AGENTS" };
  }
  if (repo && !wsService) {
    if (callback) {
      await callback({
        text: "Workspace Service is not available. Cannot clone repository."
      });
    }
    return { success: false, error: "WORKSPACE_SERVICE_UNAVAILABLE" };
  }
  if (callback) {
    await callback({
      text: `Launching ${agentSpecs.length} agents${repo ? ` on ${repo}` : ""}...`
    });
  }
  const results = [];
  for (const [i, spec] of agentSpecs.entries()) {
    let specAgentType = defaultAgentType;
    let specPiRequested = isPiAgentType(rawAgentType);
    let specRequestedType = rawAgentType;
    let specTask = spec;
    const colonIdx = spec.indexOf(":");
    if (colonIdx > 0 && colonIdx < 20) {
      const prefix = spec.slice(0, colonIdx).trim().toLowerCase();
      const knownTypes = [
        "claude",
        "claude-code",
        "claudecode",
        "codex",
        "openai",
        "gemini",
        "google",
        "aider",
        "pi",
        "pi-ai",
        "piai",
        "pi-coding-agent",
        "picodingagent",
        "shell",
        "bash"
      ];
      if (knownTypes.includes(prefix)) {
        specRequestedType = prefix;
        specPiRequested = isPiAgentType(prefix);
        specAgentType = normalizeAgentType(prefix);
        specTask = spec.slice(colonIdx + 1).trim();
      }
    }
    const specLabel = explicitLabel ? `${explicitLabel}-${i + 1}` : generateLabel(repo, specTask);
    try {
      let workdir;
      let workspaceId;
      let branch;
      if (repo && wsService) {
        const workspace = await wsService.provisionWorkspace({ repo });
        workdir = workspace.path;
        workspaceId = workspace.id;
        branch = workspace.branch;
        wsService.setLabel(workspace.id, specLabel);
      } else {
        workdir = createScratchDir();
      }
      if (specAgentType !== "shell" && specAgentType !== "pi") {
        const [preflight] = await ptyService.checkAvailableAgents([
          specAgentType
        ]);
        if (preflight && !preflight.installed) {
          results.push({
            sessionId: "",
            agentType: specAgentType,
            workdir,
            label: specLabel,
            status: "failed",
            error: `${preflight.adapter} CLI is not installed`
          });
          continue;
        }
      }
      const coordinator = getCoordinator(runtime);
      const initialTask = specPiRequested ? toPiCommand(specTask) : specTask;
      const displayType = specPiRequested ? "pi" : specAgentType;
      const session = await ptyService.spawnSession({
        name: `coding-${Date.now()}-${i}`,
        agentType: specAgentType,
        workdir,
        initialTask,
        memoryContent,
        credentials,
        approvalPreset: approvalPreset ?? ptyService.defaultApprovalPreset,
        customCredentials,
        ...coordinator ? { skipAdapterAutoResponse: true } : {},
        metadata: {
          requestedType: specRequestedType,
          messageId: message.id,
          userId: message.userId,
          workspaceId,
          label: specLabel,
          multiAgentIndex: i
        }
      });
      const isScratch = !repo;
      const scratchDir = isScratch ? workdir : null;
      registerSessionEvents(ptyService, runtime, session.id, specLabel, scratchDir, callback, !!coordinator);
      if (coordinator && specTask) {
        coordinator.registerTask(session.id, {
          agentType: specAgentType,
          label: specLabel,
          originalTask: specTask,
          workdir,
          repo
        });
      }
      results.push({
        sessionId: session.id,
        agentType: displayType,
        workdir,
        workspaceId,
        branch,
        label: specLabel,
        status: session.status
      });
      if (callback) {
        await callback({
          text: `[${i + 1}/${agentSpecs.length}] Spawned ${displayType} agent as "${specLabel}"`
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger5.error(`[START_CODING_TASK] Failed to spawn agent ${i + 1}:`, errorMessage);
      results.push({
        sessionId: "",
        agentType: specAgentType,
        workdir: "",
        label: specLabel,
        status: "failed",
        error: errorMessage
      });
    }
  }
  if (state) {
    state.codingSessions = results.filter((r) => r.sessionId);
  }
  const succeeded = results.filter((r) => r.sessionId);
  const failed = results.filter((r) => !r.sessionId);
  const summary = [
    `Launched ${succeeded.length}/${agentSpecs.length} agents${repo ? ` on ${repo}` : ""}:`,
    ...succeeded.map((r) => `  - "${r.label}" (${r.agentType}) [session: ${r.sessionId}]`),
    ...failed.length > 0 ? [`Failed: ${failed.map((r) => `"${r.label}": ${r.error}`).join(", ")}`] : []
  ].join("\n");
  if (callback) {
    await callback({ text: summary });
  }
  return {
    success: failed.length === 0,
    text: summary,
    data: { agents: results }
  };
}
async function handleSingleAgent(ctx, task) {
  logger5.debug(`[START_CODING_TASK] handleSingleAgent called, agentType=${ctx.defaultAgentType}, task=${task ? "yes" : "none"}, repo=${ctx.repo ?? "none"}`);
  const {
    runtime,
    ptyService,
    wsService,
    credentials,
    customCredentials,
    callback,
    message,
    state,
    repo,
    defaultAgentType: agentType,
    rawAgentType,
    memoryContent,
    approvalPreset,
    explicitLabel
  } = ctx;
  const label = explicitLabel || generateLabel(repo, task);
  let workdir;
  let workspaceId;
  let branch;
  if (repo) {
    if (!wsService) {
      if (callback) {
        await callback({
          text: "Workspace Service is not available. Cannot clone repository."
        });
      }
      return { success: false, error: "WORKSPACE_SERVICE_UNAVAILABLE" };
    }
    try {
      if (callback) {
        await callback({ text: `Cloning ${repo}...` });
      }
      const workspace = await wsService.provisionWorkspace({ repo });
      workdir = workspace.path;
      workspaceId = workspace.id;
      branch = workspace.branch;
      wsService.setLabel(workspace.id, label);
      if (state) {
        state.codingWorkspace = {
          id: workspace.id,
          path: workspace.path,
          branch: workspace.branch,
          isWorktree: workspace.isWorktree,
          label
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (callback) {
        await callback({
          text: `Failed to clone repository: ${errorMessage}`
        });
      }
      return { success: false, error: errorMessage };
    }
  } else {
    workdir = createScratchDir();
  }
  logger5.debug(`[START_CODING_TASK] Spawning ${agentType} agent, task: ${task ? `"${task.slice(0, 80)}..."` : "(none)"}, workdir: ${workdir}`);
  try {
    if (agentType !== "shell" && agentType !== "pi") {
      const [preflight] = await ptyService.checkAvailableAgents([
        agentType
      ]);
      if (preflight && !preflight.installed) {
        logger5.warn(`[START_CODING_TASK] ${preflight.adapter} CLI not installed`);
        if (callback) {
          await callback({
            text: `${preflight.adapter} CLI is not installed.\nInstall with: ${preflight.installCommand}\nDocs: ${preflight.docsUrl}`
          });
        }
        return { success: false, error: "AGENT_NOT_INSTALLED" };
      }
      logger5.debug(`[START_CODING_TASK] Preflight OK: ${preflight?.adapter} installed`);
    }
    const piRequested = isPiAgentType(rawAgentType);
    const initialTask = piRequested ? toPiCommand(task) : task;
    const displayType = piRequested ? "pi" : agentType;
    const coordinator = getCoordinator(runtime);
    logger5.debug(`[START_CODING_TASK] Calling spawnSession (${agentType}, coordinator=${!!coordinator})`);
    const session = await ptyService.spawnSession({
      name: `coding-${Date.now()}`,
      agentType,
      workdir,
      initialTask,
      memoryContent,
      credentials,
      approvalPreset: approvalPreset ?? ptyService.defaultApprovalPreset,
      customCredentials,
      ...coordinator ? { skipAdapterAutoResponse: true } : {},
      metadata: {
        requestedType: rawAgentType,
        messageId: message.id,
        userId: message.userId,
        workspaceId,
        label
      }
    });
    logger5.debug(`[START_CODING_TASK] Session spawned: ${session.id} (${session.status})`);
    const isScratchWorkspace = !repo;
    const scratchDir = isScratchWorkspace ? workdir : null;
    registerSessionEvents(ptyService, runtime, session.id, label, scratchDir, callback, !!coordinator);
    if (coordinator && task) {
      coordinator.registerTask(session.id, {
        agentType,
        label,
        originalTask: task,
        workdir,
        repo
      });
    }
    if (state) {
      state.codingSession = {
        id: session.id,
        agentType: session.agentType,
        workdir: session.workdir,
        status: session.status
      };
    }
    const summary = repo ? `Cloned ${repo} and started ${displayType} agent as "${label}"${task ? ` with task: "${task}"` : ""}` : `Started ${displayType} agent as "${label}" in scratch workspace${task ? ` with task: "${task}"` : ""}`;
    if (callback) {
      await callback({ text: `${summary}\nSession ID: ${session.id}` });
    }
    return {
      success: true,
      text: summary,
      data: {
        sessionId: session.id,
        agentType: displayType,
        workdir: session.workdir,
        workspaceId,
        branch,
        label,
        status: session.status
      }
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger5.error("[START_CODING_TASK] Failed to spawn agent:", errorMessage);
    if (callback) {
      await callback({
        text: `Failed to start coding agent: ${errorMessage}`
      });
    }
    return { success: false, error: errorMessage };
  }
}
var MAX_CONCURRENT_AGENTS = 8;

// src/actions/start-coding-task.ts
var startCodingTaskAction = {
  name: "START_CODING_TASK",
  similes: [
    "LAUNCH_CODING_TASK",
    "RUN_CODING_TASK",
    "START_AGENT_TASK",
    "SPAWN_AND_PROVISION",
    "CODE_THIS"
  ],
  description: "Start a coding task: optionally clone a repo, then spawn a coding agent (Claude Code, Codex, Gemini, Aider, Pi) " + "to work on it. If no repo is provided, the agent runs in a safe scratch directory. " + "Use this whenever the user asks to work on code, research something with an agent, or run any agent task. " + "IMPORTANT: If the user references a repository from conversation history (e.g. 'in the same repo', " + "'on that project', 'add a feature to it'), you MUST include the repo URL in the `repo` parameter. " + "If the task involves code changes to a real project but you don't know the repo URL, ASK the user for it " + "before calling this action \u2014 do not default to a scratch directory for real project work.",
  examples: [
    [
      {
        name: "{{user1}}",
        content: {
          text: "Set up a workspace for https://github.com/acme/my-app and have Claude fix the auth bug"
        }
      },
      {
        name: "{{agentName}}",
        content: {
          text: "I'll clone the repo and spawn Claude to fix the auth bug.",
          action: "START_CODING_TASK"
        }
      }
    ],
    [
      {
        name: "{{user1}}",
        content: {
          text: "Use a coding agent to research the latest React patterns"
        }
      },
      {
        name: "{{agentName}}",
        content: {
          text: "I'll spin up an agent to research that for you.",
          action: "START_CODING_TASK"
        }
      }
    ]
  ],
  validate: async (runtime, _message) => {
    const ptyService = runtime.getService("PTY_SERVICE");
    return ptyService != null;
  },
  handler: async (runtime, message, state, options, callback) => {
    const ptyService = runtime.getService("PTY_SERVICE");
    if (!ptyService) {
      if (callback) {
        await callback({
          text: "PTY Service is not available. Cannot start coding task."
        });
      }
      return { success: false, error: "SERVICE_UNAVAILABLE" };
    }
    const wsService = runtime.getService("CODING_WORKSPACE_SERVICE");
    const params = options?.parameters;
    const content = message.content;
    const explicitRawType = params?.agentType ?? content.agentType;
    const rawAgentType = explicitRawType ?? await ptyService.resolveAgentType();
    const defaultAgentType = normalizeAgentType(rawAgentType);
    const memoryContent = params?.memoryContent ?? content.memoryContent;
    const approvalPreset = params?.approvalPreset ?? content.approvalPreset;
    let repo = params?.repo ?? content.repo;
    if (!repo && content.text) {
      const urlMatch = content.text.match(/https?:\/\/(?:github\.com|gitlab\.com|bitbucket\.org)\/[\w.-]+\/[\w.-]+(?:\.git)?/i);
      if (urlMatch) {
        repo = urlMatch[0];
      }
    }
    if (!repo) {
      const coordinator = getCoordinator(runtime);
      const lastRepo = coordinator?.getLastUsedRepo();
      if (lastRepo) {
        repo = lastRepo;
      }
    }
    const customCredentialKeys = runtime.getSetting("CUSTOM_CREDENTIAL_KEYS");
    let customCredentials;
    if (customCredentialKeys) {
      customCredentials = {};
      for (const key of customCredentialKeys.split(",").map((k) => k.trim())) {
        const val = runtime.getSetting(key);
        if (val)
          customCredentials[key] = val;
      }
    }
    const credentials = {
      anthropicKey: runtime.getSetting("ANTHROPIC_API_KEY"),
      openaiKey: runtime.getSetting("OPENAI_API_KEY"),
      googleKey: runtime.getSetting("GOOGLE_GENERATIVE_AI_API_KEY"),
      githubToken: runtime.getSetting("GITHUB_TOKEN")
    };
    const explicitLabel = params?.label ?? content.label;
    const ctx = {
      runtime,
      ptyService,
      wsService,
      credentials,
      customCredentials,
      callback,
      message,
      state,
      repo,
      defaultAgentType,
      rawAgentType,
      memoryContent,
      approvalPreset,
      explicitLabel
    };
    const agentsParam = params?.agents ?? content.agents;
    if (agentsParam) {
      return handleMultiAgent(ctx, agentsParam);
    }
    const task = params?.task ?? content.task;
    return handleSingleAgent(ctx, task);
  },
  parameters: [
    {
      name: "repo",
      description: "Git repository URL to clone (e.g. https://github.com/owner/repo). " + "ALWAYS provide this when the user is working on a real project or references a repo from context. " + "Only omit for pure research/scratch tasks with no target repository. " + "If unsure which repo, ask the user before spawning.",
      required: false,
      schema: { type: "string" }
    },
    {
      name: "agentType",
      description: "Type of coding agent to spawn (default for all agents). Options: claude, codex, gemini, aider, pi, shell.",
      required: false,
      schema: { type: "string", default: "claude" }
    },
    {
      name: "task",
      description: "The task or prompt to send to the agent once it's ready. Used for single-agent mode.",
      required: false,
      schema: { type: "string" }
    },
    {
      name: "agents",
      description: "Pipe-delimited list of agent tasks for multi-agent mode. Each segment is a task description. " + "Optionally prefix with agent type: 'claude:Fix auth | gemini:Write tests | codex:Update docs'. " + "Each agent gets its own workspace clone. If provided, the 'task' parameter is ignored.",
      required: false,
      schema: { type: "string" }
    },
    {
      name: "memoryContent",
      description: "Instructions/context to write to each agent's memory file (e.g. CLAUDE.md) before spawning.",
      required: false,
      schema: { type: "string" }
    },
    {
      name: "label",
      description: "Short semantic label for this workspace. In multi-agent mode, each agent gets '{label}-1', '{label}-2', etc. " + "Auto-generated from repo/task if not provided.",
      required: false,
      schema: { type: "string" }
    },
    {
      name: "approvalPreset",
      description: "Permission level for all agents: readonly, standard, permissive, autonomous.",
      required: false,
      schema: {
        type: "string",
        enum: ["readonly", "standard", "permissive", "autonomous"]
      }
    }
  ]
};

// src/actions/stop-agent.ts
import {
logger as logger6
} from "@elizaos/core";
var stopAgentAction = {
  name: "STOP_CODING_AGENT",
  similes: [
    "KILL_CODING_AGENT",
    "TERMINATE_AGENT",
    "END_CODING_SESSION",
    "CANCEL_AGENT"
  ],
  description: "Stop a running coding agent session. " + "Terminates the PTY session and cleans up resources.",
  examples: [
    [
      {
        name: "{{user1}}",
        content: { text: "Stop the coding agent" }
      },
      {
        name: "{{agentName}}",
        content: {
          text: "I'll stop the coding session.",
          action: "STOP_CODING_AGENT"
        }
      }
    ],
    [
      {
        name: "{{user1}}",
        content: { text: "Kill the stuck agent" }
      },
      {
        name: "{{agentName}}",
        content: {
          text: "Terminating the coding agent.",
          action: "STOP_CODING_AGENT"
        }
      }
    ]
  ],
  validate: async (runtime, _message) => {
    const ptyService = runtime.getService("PTY_SERVICE");
    if (!ptyService) {
      return false;
    }
    try {
      const sessions = await Promise.race([
        ptyService.listSessions(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("validate timeout")), 2000))
      ]);
      return sessions.length > 0;
    } catch {
      return false;
    }
  },
  handler: async (runtime, message, state, _options, callback) => {
    const ptyService = runtime.getService("PTY_SERVICE");
    if (!ptyService) {
      if (callback) {
        await callback({
          text: "PTY Service is not available."
        });
      }
      return { success: false, error: "SERVICE_UNAVAILABLE" };
    }
    const content = message.content;
    if (content.all) {
      const sessions = await ptyService.listSessions();
      if (sessions.length === 0) {
        if (callback) {
          await callback({
            text: "No active coding sessions to stop."
          });
        }
        return { success: true, text: "No sessions to stop" };
      }
      for (const session2 of sessions) {
        try {
          await ptyService.stopSession(session2.id);
        } catch (err) {
          logger6.error(`Failed to stop session ${session2.id}: ${err}`);
        }
      }
      if (state?.codingSession) {
        delete state.codingSession;
      }
      if (callback) {
        await callback({
          text: `Stopped ${sessions.length} coding session(s).`
        });
      }
      return {
        success: true,
        text: `Stopped ${sessions.length} sessions`,
        data: { stoppedCount: sessions.length }
      };
    }
    let sessionId = content.sessionId;
    if (!sessionId && state?.codingSession) {
      sessionId = state.codingSession.id;
    }
    if (!sessionId) {
      const sessions = await ptyService.listSessions();
      if (sessions.length === 0) {
        if (callback) {
          await callback({
            text: "No active coding sessions to stop."
          });
        }
        return { success: true, text: "No sessions to stop" };
      }
      sessionId = sessions[sessions.length - 1].id;
    }
    const session = ptyService.getSession(sessionId);
    if (!session) {
      if (callback) {
        await callback({
          text: `Session ${sessionId} not found.`
        });
      }
      return { success: false, error: "SESSION_NOT_FOUND" };
    }
    try {
      await ptyService.stopSession(sessionId);
      if (state?.codingSession && state.codingSession.id === sessionId) {
        delete state.codingSession;
      }
      if (callback) {
        await callback({
          text: `Stopped coding agent session ${sessionId}.`
        });
      }
      return {
        success: true,
        text: `Stopped session ${sessionId}`,
        data: { sessionId, agentType: session.agentType }
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (callback) {
        await callback({
          text: `Failed to stop agent: ${errorMessage}`
        });
      }
      return { success: false, error: errorMessage };
    }
  },
  parameters: [
    {
      name: "sessionId",
      description: "ID of the session to stop. If not specified, stops the current session.",
      required: false,
      schema: { type: "string" }
    },
    {
      name: "all",
      description: "If true, stop all active coding sessions.",
      required: false,
      schema: { type: "boolean" }
    }
  ]
};

// src/providers/action-examples.ts
function formatExample(ex) {
  const actionTags = ex.actions.map((a) => `  <action>${a}</action>`).join("\n");
  const paramBlocks = Object.entries(ex.params ?? {}).map(([actionName, params]) => {
    const inner = Object.entries(params).map(([k, v]) => `    <${k}>${v}</${k}>`).join("\n");
    return `  <${actionName}>\n${inner}\n  </${actionName}>`;
  }).join("\n");
  const paramsSection = paramBlocks ? `\n<params>\n${paramBlocks}\n</params>` : "";
  return `User: ${ex.user}\nAssistant:\n<actions>\n${actionTags}\n</actions>${paramsSection}`;
}
var CODING_AGENT_EXAMPLES = [
  {
    user: "Can you set up a workspace for https://github.com/acme/my-app and have Claude fix the login bug?",
    actions: ["REPLY", "START_CODING_TASK"],
    params: {
      START_CODING_TASK: {
        repo: "https://github.com/acme/my-app",
        agentType: "claude",
        task: "Fix the login bug in src/auth.ts \u2014 users are getting 401 errors after token refresh"
      }
    }
  },
  {
    user: "Use a coding agent to research the latest Next.js patterns and summarize them",
    actions: ["REPLY", "START_CODING_TASK"],
    params: {
      START_CODING_TASK: {
        agentType: "claude",
        task: "Research the latest Next.js patterns (app router, server components, etc.) and write a summary in RESEARCH.md"
      }
    }
  },
  {
    user: "Use pi to investigate flaky tests and write findings to FLAKY_TESTS.md",
    actions: ["REPLY", "START_CODING_TASK"],
    params: {
      START_CODING_TASK: {
        agentType: "pi",
        task: "Investigate flaky tests, identify likely root causes, and write your findings to FLAKY_TESTS.md"
      }
    }
  },
  {
    user: "Tell the coding agent to accept those changes",
    actions: ["REPLY", "SEND_TO_CODING_AGENT"],
    params: {
      SEND_TO_CODING_AGENT: {
        input: "Yes, accept the changes"
      }
    }
  },
  {
    user: "The agent is asking me to press enter, can you handle that?",
    actions: ["REPLY", "SEND_TO_CODING_AGENT"],
    params: {
      SEND_TO_CODING_AGENT: {
        keys: "Enter"
      }
    }
  },
  {
    user: "Create a PR for what the agent did",
    actions: ["REPLY", "FINALIZE_WORKSPACE"],
    params: {
      FINALIZE_WORKSPACE: {
        prTitle: "Fix login bug in auth module",
        prBody: "Resolved 401 errors after token refresh by fixing the token expiry check"
      }
    }
  }
];
var MULTI_AGENT_EXAMPLE = `User: Spin up 3 agents on https://github.com/acme/app \u2014 one to fix auth, one to write tests, one to update docs
Assistant:
<actions>
  <action>REPLY</action>
  <action>START_CODING_TASK</action>
</actions>
<params>
  <START_CODING_TASK>
    <repo>https://github.com/acme/app</repo>
    <agents>Fix the authentication bug in src/auth.ts \u2014 users get 401 after token refresh. Your unique identifier is "alpha". | Write comprehensive unit tests for the auth module in src/auth.ts. Your unique identifier is "beta". | Update the API documentation in docs/ to reflect the new auth flow. Your unique identifier is "gamma".</agents>
  </START_CODING_TASK>
</params>`;
var codingAgentExamplesProvider = {
  name: "CODING_AGENT_EXAMPLES",
  description: "Structured examples showing how to use coding agent actions with parameters",
  position: -1,
  get: async (_runtime, _message, _state) => {
    const examples = CODING_AGENT_EXAMPLES.map(formatExample).join("\n\n");
    const text = [
      "# Coding Agent Action Call Examples",
      "When the user asks you to work on code, clone repos, spawn agents, or run agent tasks,",
      "you MUST select the appropriate actions and include parameters. Do NOT just describe",
      "what you would do \u2014 actually select the actions.",
      "",
      "IMPORTANT: Use START_CODING_TASK to launch coding agents. It handles workspace setup",
      "automatically. If a repo URL is provided, it clones it first. If no repo, the agent",
      "runs in a safe scratch directory. You do NOT need to call PROVISION_WORKSPACE separately.",
      "",
      "## Single Agent Examples",
      "",
      examples,
      "",
      "## Multi-Agent Example",
      "To spawn multiple agents, use the `agents` parameter with pipe-delimited (|) tasks.",
      "Each segment becomes a separate agent with its own workspace clone.",
      "You can optionally prefix each segment with an agent type: 'claude:task | gemini:task'.",
      "CRITICAL: Give each agent a DIFFERENT task with unique instructions, topics, file names,",
      "and unique identifiers so their work is clearly differentiated.",
      "",
      MULTI_AGENT_EXAMPLE
    ].join("\n");
    return {
      data: { codingAgentExamples: CODING_AGENT_EXAMPLES },
      values: { codingAgentExamples: text },
      text
    };
  }
};

// src/providers/active-workspace-context.ts
function formatStatus(status) {
  switch (status) {
    case "ready":
      return "idle";
    case "busy":
      return "working";
    case "starting":
      return "starting up";
    case "authenticating":
      return "authenticating";
    default:
      return status;
  }
}
function formatSessionLine(session) {
  const label = session.metadata?.label || session.name;
  const status = formatStatus(session.status);
  return `  - "${label}" (${session.agentType}, ${status}) [session: ${session.id}]`;
}
function formatWorkspaceLine(ws, sessions) {
  const label = ws.label || ws.id.slice(0, 8);
  const agents = sessions.filter((s) => s.workdir === ws.path);
  const agentSummary = agents.length > 0 ? agents.map((a) => `${a.agentType}:${formatStatus(a.status)}`).join(", ") : "no agents";
  return `  - "${label}" \u2192 ${ws.repo} (branch: ${ws.branch}, ${agentSummary})`;
}
var activeWorkspaceContextProvider = {
  name: "ACTIVE_WORKSPACE_CONTEXT",
  description: "Live status of active workspaces and coding agent sessions",
  position: 1,
  get: async (runtime, _message, _state) => {
    const ptyService = runtime.getService("PTY_SERVICE");
    const wsService = runtime.getService("CODING_WORKSPACE_SERVICE");
    let sessions = [];
    let workspaces = [];
    if (ptyService) {
      try {
        sessions = await Promise.race([
          ptyService.listSessions(),
          new Promise((resolve3) => setTimeout(() => resolve3([]), 2000))
        ]);
      } catch {
        sessions = [];
      }
    }
    if (wsService) {
      workspaces = wsService.listWorkspaces();
    }
    if (sessions.length === 0 && workspaces.length === 0) {
      const text2 = [
        "# Active Workspaces & Agents",
        "No active workspaces or coding agent sessions.",
        "Use START_CODING_TASK to launch a new coding agent."
      ].join("\n");
      return {
        data: { activeWorkspaces: [], activeSessions: [] },
        values: { activeWorkspaceContext: text2 },
        text: text2
      };
    }
    const lines = ["# Active Workspaces & Agents"];
    if (workspaces.length > 0) {
      lines.push("");
      lines.push(`## Workspaces (${workspaces.length})`);
      for (const ws of workspaces) {
        lines.push(formatWorkspaceLine(ws, sessions));
      }
    }
    const trackedPaths = new Set(workspaces.map((ws) => ws.path));
    const untrackedSessions = sessions.filter((s) => !trackedPaths.has(s.workdir));
    if (untrackedSessions.length > 0) {
      lines.push("");
      lines.push(`## Standalone Sessions (${untrackedSessions.length})`);
      for (const session of untrackedSessions) {
        lines.push(formatSessionLine(session));
      }
    }
    const coordinator = getCoordinator(runtime);
    if (coordinator) {
      const pending = coordinator.getPendingConfirmations();
      const supervisionLevel = coordinator.getSupervisionLevel();
      if (pending.length > 0) {
        lines.push("");
        lines.push(`## Pending Confirmations (${pending.length}) \u2014 supervision: ${supervisionLevel}`);
        for (const p of pending) {
          lines.push(`  - "${p.taskContext.label}" blocked: "${p.promptText}" \u2192 suggested: ${p.llmDecision.action}`);
        }
      } else if (supervisionLevel !== "autonomous") {
        lines.push("");
        lines.push(`Swarm supervision: ${supervisionLevel} (no pending items)`);
      }
    }
    if (sessions.length > 0) {
      lines.push("");
      lines.push("You can interact with agents using SEND_TO_CODING_AGENT (pass sessionId), " + "stop them with STOP_CODING_AGENT, or finalize their work with FINALIZE_WORKSPACE.");
    }
    const text = lines.join("\n");
    return {
      data: {
        activeWorkspaces: workspaces.map((ws) => ({
          id: ws.id,
          label: ws.label,
          repo: ws.repo,
          branch: ws.branch,
          path: ws.path
        })),
        activeSessions: sessions.map((s) => ({
          id: s.id,
          label: s.metadata?.label,
          agentType: s.agentType,
          status: s.status,
          workdir: s.workdir
        }))
      },
      values: { activeWorkspaceContext: text },
      text
    };
  }
};

// src/services/workspace-service.ts
import * as os3 from "node:os";
import * as path5 from "node:path";
import {
CredentialService,
GitHubPatClient as GitHubPatClient2,
MemoryTokenStore,
WorkspaceService
} from "git-workspace-service";

// src/services/workspace-github.ts
import {
GitHubPatClient,
OAuthDeviceFlow
} from "git-workspace-service";
function parseOwnerRepo(repo) {
  const match = repo.match(/(?:github\.com\/)?([^/]+)\/([^/.]+)/);
  if (!match) {
    throw new Error(`Cannot parse owner/repo from: ${repo}`);
  }
  return { owner: match[1], repo: match[2] };
}
async function ensureGitHubClient(ctx) {
  if (ctx.githubClient)
    return ctx.githubClient;
  if (ctx.githubAuthInProgress)
    return ctx.githubAuthInProgress;
  const githubToken = ctx.runtime.getSetting("GITHUB_TOKEN");
  if (githubToken) {
    const client = new GitHubPatClient({ token: githubToken });
    ctx.setGithubClient(client);
    ctx.log("GitHubPatClient initialized with PAT (late binding)");
    return client;
  }
  const clientId = ctx.runtime.getSetting("GITHUB_OAUTH_CLIENT_ID");
  if (!clientId) {
    throw new Error("GitHub access required but no credentials available. " + "Set GITHUB_TOKEN (PAT) or GITHUB_OAUTH_CLIENT_ID (for OAuth device flow).");
  }
  const authPromise = performOAuthFlow(ctx, clientId);
  ctx.setGithubAuthInProgress(authPromise);
  try {
    const client = await authPromise;
    return client;
  } finally {
    ctx.setGithubAuthInProgress(null);
  }
}
async function performOAuthFlow(ctx, clientId) {
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  const oauth = new OAuthDeviceFlow({
    clientId,
    clientSecret,
    permissions: {
      repositories: { type: "public" },
      contents: "write",
      issues: "write",
      pullRequests: "write",
      metadata: "read"
    },
    timeout: 300
  });
  const deviceCode = await oauth.requestDeviceCode();
  if (ctx.authPromptCallback) {
    ctx.authPromptCallback({
      verificationUri: deviceCode.verificationUri,
      userCode: deviceCode.userCode,
      expiresIn: deviceCode.expiresIn
    });
  } else {
    console.log(`\n[GitHub Auth] Go to ${deviceCode.verificationUri} and enter code: ${deviceCode.userCode}\n`);
  }
  const token = await oauth.pollForToken(deviceCode);
  const client = new GitHubPatClient({ token: token.accessToken });
  ctx.setGithubClient(client);
  ctx.log("GitHubPatClient initialized via OAuth device flow");
  return client;
}
async function createIssue(ctx, repo, options) {
  const client = await ensureGitHubClient(ctx);
  const { owner, repo: repoName } = parseOwnerRepo(repo);
  const issue = await client.createIssue(owner, repoName, options);
  ctx.log(`Created issue #${issue.number}: ${issue.title}`);
  return issue;
}
async function getIssue(ctx, repo, issueNumber) {
  const client = await ensureGitHubClient(ctx);
  const { owner, repo: repoName } = parseOwnerRepo(repo);
  return client.getIssue(owner, repoName, issueNumber);
}
async function listIssues(ctx, repo, options) {
  const client = await ensureGitHubClient(ctx);
  const { owner, repo: repoName } = parseOwnerRepo(repo);
  return client.listIssues(owner, repoName, options);
}
async function updateIssue(ctx, repo, issueNumber, options) {
  const client = await ensureGitHubClient(ctx);
  const { owner, repo: repoName } = parseOwnerRepo(repo);
  return client.updateIssue(owner, repoName, issueNumber, options);
}
async function addComment(ctx, repo, issueNumber, body) {
  const client = await ensureGitHubClient(ctx);
  const { owner, repo: repoName } = parseOwnerRepo(repo);
  return client.addComment(owner, repoName, issueNumber, { body });
}
async function listComments(ctx, repo, issueNumber) {
  const client = await ensureGitHubClient(ctx);
  const { owner, repo: repoName } = parseOwnerRepo(repo);
  return client.listComments(owner, repoName, issueNumber);
}
async function closeIssue(ctx, repo, issueNumber) {
  const client = await ensureGitHubClient(ctx);
  const { owner, repo: repoName } = parseOwnerRepo(repo);
  const issue = await client.closeIssue(owner, repoName, issueNumber);
  ctx.log(`Closed issue #${issueNumber}`);
  return issue;
}
async function reopenIssue(ctx, repo, issueNumber) {
  const client = await ensureGitHubClient(ctx);
  const { owner, repo: repoName } = parseOwnerRepo(repo);
  return client.reopenIssue(owner, repoName, issueNumber);
}
async function addLabels(ctx, repo, issueNumber, labels) {
  const client = await ensureGitHubClient(ctx);
  const { owner, repo: repoName } = parseOwnerRepo(repo);
  await client.addLabels(owner, repoName, issueNumber, labels);
}

// src/services/workspace-git-ops.ts
async function getStatus(workspacePath) {
  const { execFileSync } = await import("node:child_process");
  const statusOutput = execFileSync("git", ["status", "--porcelain"], {
    cwd: workspacePath,
    encoding: "utf-8"
  });
  const branchOutput = execFileSync("git", ["branch", "--show-current"], {
    cwd: workspacePath,
    encoding: "utf-8"
  }).trim();
  const lines = statusOutput.split("\n").filter(Boolean);
  const modified = [];
  const staged = [];
  const untracked = [];
  for (const line of lines) {
    const indexStatus = line[0];
    const workTreeStatus = line[1];
    const filename = line.slice(3);
    if (indexStatus === "?" && workTreeStatus === "?") {
      untracked.push(filename);
    } else if (indexStatus !== " " && indexStatus !== "?") {
      staged.push(filename);
    } else if (workTreeStatus !== " ") {
      modified.push(filename);
    }
  }
  return {
    branch: branchOutput,
    clean: lines.length === 0,
    modified,
    staged,
    untracked
  };
}
async function commit(workspacePath, options, log) {
  const { execFileSync } = await import("node:child_process");
  if (options.all) {
    execFileSync("git", ["add", "-A"], { cwd: workspacePath });
  }
  execFileSync("git", ["commit", "-m", options.message], {
    cwd: workspacePath
  });
  const hash = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: workspacePath,
    encoding: "utf-8"
  }).trim();
  log(`Committed ${hash.slice(0, 8)} in workspace at ${workspacePath}`);
  return hash;
}
async function push(workspacePath, branch, options, log) {
  const { execFileSync } = await import("node:child_process");
  const args = ["push"];
  if (options?.setUpstream) {
    args.push("-u", "origin", branch);
  }
  if (options?.force) {
    args.push("--force");
  }
  execFileSync("git", args, { cwd: workspacePath });
  log(`Pushed workspace at ${workspacePath}`);
}
async function createPR(workspaceService, workspace, workspaceId, options, log) {
  const finalization = {
    push: false,
    createPr: true,
    pr: {
      title: options.title,
      body: options.body,
      targetBranch: options.base ?? workspace.baseBranch,
      draft: options.draft,
      labels: options.labels,
      reviewers: options.reviewers
    },
    cleanup: false
  };
  const result = await workspaceService.finalize(workspaceId, finalization);
  if (!result) {
    throw new Error("Failed to create PR");
  }
  log(`Created PR #${result.number} for workspace ${workspaceId}`);
  return result;
}

// src/services/workspace-lifecycle.ts
import * as fs2 from "node:fs";
import * as path4 from "node:path";
async function removeScratchDir(dirPath, baseDir, log) {
  const resolved = path4.resolve(dirPath);
  const resolvedBase = path4.resolve(baseDir) + path4.sep;
  if (!resolved.startsWith(resolvedBase) && resolved !== path4.resolve(baseDir)) {
    console.warn(`[CodingWorkspaceService] Refusing to remove dir outside base: ${resolved}`);
    return;
  }
  try {
    await fs2.promises.rm(resolved, { recursive: true, force: true });
    log(`Removed scratch dir ${resolved}`);
  } catch (err) {
    console.warn(`[CodingWorkspaceService] Failed to remove scratch dir ${resolved}:`, err);
  }
}
async function gcOrphanedWorkspaces(baseDir, workspaceTtlMs, trackedWorkspaceIds, log) {
  if (workspaceTtlMs === 0) {
    log("Workspace GC disabled (workspaceTtlMs=0)");
    return;
  }
  let entries;
  try {
    entries = await fs2.promises.readdir(baseDir, { withFileTypes: true });
  } catch {
    return;
  }
  const now = Date.now();
  let removed = 0;
  let skipped = 0;
  for (const entry of entries) {
    if (!entry.isDirectory())
      continue;
    if (trackedWorkspaceIds.has(entry.name)) {
      skipped++;
      continue;
    }
    const dirPath = path4.join(baseDir, entry.name);
    try {
      const stat = await fs2.promises.stat(dirPath);
      const age = now - stat.mtimeMs;
      if (age > workspaceTtlMs) {
        await fs2.promises.rm(dirPath, { recursive: true, force: true });
        removed++;
      } else {
        skipped++;
      }
    } catch (err) {
      log(`GC: skipping ${entry.name}: ${err}`);
      skipped++;
    }
  }
  if (removed > 0 || skipped > 0) {
    console.log(`[CodingWorkspaceService] Startup GC: removed ${removed} orphaned workspace(s), kept ${skipped}`);
  }
}

// src/services/workspace-service.ts
class CodingWorkspaceService {
  static serviceType = "CODING_WORKSPACE_SERVICE";
  capabilityDescription = "Manages git workspaces for coding tasks";
  runtime;
  workspaceService = null;
  credentialService = null;
  githubClient = null;
  githubAuthInProgress = null;
  serviceConfig;
  workspaces = new Map;
  labels = new Map;
  eventCallbacks = [];
  authPromptCallback = null;
  constructor(runtime, config = {}) {
    this.runtime = runtime;
    this.serviceConfig = {
      baseDir: config.baseDir ?? path5.join(os3.homedir(), ".milady", "workspaces"),
      branchPrefix: config.branchPrefix ?? "milady",
      debug: config.debug ?? false,
      workspaceTtlMs: config.workspaceTtlMs ?? 24 * 60 * 60 * 1000
    };
  }
  static async start(runtime) {
    const config = runtime.getSetting("CODING_WORKSPACE_CONFIG");
    const service = new CodingWorkspaceService(runtime, config ?? {});
    await service.initialize();
    return service;
  }
  static async stopRuntime(runtime) {
    const service = runtime.getService("CODING_WORKSPACE_SERVICE");
    if (service) {
      await service.stop();
    }
  }
  async initialize() {
    this.credentialService = new CredentialService({
      tokenStore: new MemoryTokenStore
    });
    this.workspaceService = new WorkspaceService({
      config: {
        baseDir: this.serviceConfig.baseDir,
        branchPrefix: this.serviceConfig.branchPrefix
      },
      credentialService: this.credentialService,
      logger: this.serviceConfig.debug ? {
        info: (data, msg) => console.log(`[WorkspaceService] ${msg ?? ""}`, data),
        warn: (data, msg) => console.warn(`[WorkspaceService] ${msg ?? ""}`, data),
        error: (data, msg) => console.error(`[WorkspaceService] ${msg ?? ""}`, data),
        debug: (_data, msg) => this.log(`${msg ?? ""}`)
      } : undefined
    });
    await this.workspaceService.initialize();
    const githubToken = this.runtime.getSetting("GITHUB_TOKEN");
    if (githubToken) {
      this.githubClient = new GitHubPatClient2({ token: githubToken });
      this.log("GitHubPatClient initialized with PAT");
    } else {
      this.log("GITHUB_TOKEN not set - will use OAuth device flow when GitHub access is needed");
    }
    this.workspaceService.onEvent((event) => {
      this.emitEvent(event);
    });
    this.log("CodingWorkspaceService initialized");
    this.gcOrphanedWorkspaces().catch((err) => {
      console.warn("[CodingWorkspaceService] Startup GC failed:", err);
    });
  }
  async stop() {
    for (const [id] of this.workspaces) {
      try {
        await this.removeWorkspace(id);
      } catch (err) {
        this.log(`Error cleaning up workspace ${id}: ${err}`);
      }
    }
    this.workspaces.clear();
    this.workspaceService = null;
    this.credentialService = null;
    this.githubClient = null;
    this.log("CodingWorkspaceService shutdown complete");
  }
  async provisionWorkspace(options) {
    if (!this.workspaceService) {
      throw new Error("CodingWorkspaceService not initialized");
    }
    const repo = options.repo.replace(/\/+$/, "");
    const executionId = options.execution?.id ?? `exec-${Date.now()}`;
    const taskId = options.task?.id ?? `task-${Date.now()}`;
    const workspaceConfig = {
      repo,
      strategy: options.useWorktree ? "worktree" : "clone",
      parentWorkspace: options.parentWorkspaceId,
      branchStrategy: "feature_branch",
      branchName: options.branchName,
      baseBranch: options.baseBranch ?? "main",
      execution: {
        id: executionId,
        patternName: options.execution?.patternName ?? "milady-coding"
      },
      task: {
        id: taskId,
        role: options.task?.role ?? "coding-agent",
        slug: options.task?.slug
      },
      userCredentials: options.userCredentials ? {
        type: options.userCredentials.type,
        token: options.userCredentials.token ?? "",
        provider: "github"
      } : undefined
    };
    const workspace = await this.workspaceService.provision(workspaceConfig);
    const result = {
      id: workspace.id,
      path: workspace.path,
      branch: workspace.branch.name,
      baseBranch: workspace.branch.baseBranch,
      isWorktree: workspace.strategy === "worktree",
      repo: workspace.repo,
      status: workspace.status
    };
    this.workspaces.set(workspace.id, result);
    this.log(`Provisioned workspace ${workspace.id}`);
    return result;
  }
  getWorkspace(id) {
    return this.workspaces.get(id);
  }
  listWorkspaces() {
    return Array.from(this.workspaces.values());
  }
  setLabel(workspaceId, label) {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }
    if (workspace.label) {
      this.labels.delete(workspace.label);
    }
    const existing = this.labels.get(label);
    if (existing && existing !== workspaceId) {
      const oldWs = this.workspaces.get(existing);
      if (oldWs)
        oldWs.label = undefined;
    }
    workspace.label = label;
    this.labels.set(label, workspaceId);
    this.log(`Labeled workspace ${workspaceId} as "${label}"`);
  }
  getWorkspaceByLabel(label) {
    const id = this.labels.get(label);
    return id ? this.workspaces.get(id) : undefined;
  }
  resolveWorkspace(labelOrId) {
    return this.getWorkspaceByLabel(labelOrId) ?? this.workspaces.get(labelOrId);
  }
  async getStatus(workspaceId) {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }
    return getStatus(workspace.path);
  }
  async commit(workspaceId, options) {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }
    const hash = await commit(workspace.path, options, (msg) => this.log(msg));
    this.log(`Committed ${hash.slice(0, 8)} in workspace ${workspaceId}`);
    return hash;
  }
  async push(workspaceId, options) {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }
    await push(workspace.path, workspace.branch, options, (msg) => this.log(msg));
    this.log(`Pushed workspace ${workspaceId}`);
  }
  async createPR(workspaceId, options) {
    if (!this.workspaceService) {
      throw new Error("CodingWorkspaceService not initialized");
    }
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }
    return createPR(this.workspaceService, workspace, workspaceId, options, (msg) => this.log(msg));
  }
  getGitHubContext() {
    return {
      runtime: this.runtime,
      githubClient: this.githubClient,
      setGithubClient: (client) => {
        this.githubClient = client;
      },
      githubAuthInProgress: this.githubAuthInProgress,
      setGithubAuthInProgress: (p) => {
        this.githubAuthInProgress = p;
      },
      authPromptCallback: this.authPromptCallback,
      log: (msg) => this.log(msg)
    };
  }
  setAuthPromptCallback(callback) {
    this.authPromptCallback = callback;
  }
  async createIssue(repo, options) {
    return createIssue(this.getGitHubContext(), repo, options);
  }
  async getIssue(repo, issueNumber) {
    return getIssue(this.getGitHubContext(), repo, issueNumber);
  }
  async listIssues(repo, options) {
    return listIssues(this.getGitHubContext(), repo, options);
  }
  async updateIssue(repo, issueNumber, options) {
    return updateIssue(this.getGitHubContext(), repo, issueNumber, options);
  }
  async addComment(repo, issueNumber, body) {
    return addComment(this.getGitHubContext(), repo, issueNumber, body);
  }
  async listComments(repo, issueNumber) {
    return listComments(this.getGitHubContext(), repo, issueNumber);
  }
  async closeIssue(repo, issueNumber) {
    return closeIssue(this.getGitHubContext(), repo, issueNumber);
  }
  async reopenIssue(repo, issueNumber) {
    return reopenIssue(this.getGitHubContext(), repo, issueNumber);
  }
  async addLabels(repo, issueNumber, labels) {
    return addLabels(this.getGitHubContext(), repo, issueNumber, labels);
  }
  async removeWorkspace(workspaceId) {
    if (!this.workspaceService) {
      throw new Error("CodingWorkspaceService not initialized");
    }
    await this.workspaceService.cleanup(workspaceId);
    const workspace = this.workspaces.get(workspaceId);
    if (workspace?.label) {
      this.labels.delete(workspace.label);
    }
    this.workspaces.delete(workspaceId);
    this.log(`Removed workspace ${workspaceId}`);
  }
  onEvent(callback) {
    this.eventCallbacks.push(callback);
    return () => {
      const index = this.eventCallbacks.indexOf(callback);
      if (index !== -1) {
        this.eventCallbacks.splice(index, 1);
      }
    };
  }
  emitEvent(event) {
    for (const callback of this.eventCallbacks) {
      try {
        callback(event);
      } catch (err) {
        this.log(`Event callback error: ${err}`);
      }
    }
  }
  async removeScratchDir(dirPath) {
    return removeScratchDir(dirPath, this.serviceConfig.baseDir, (msg) => this.log(msg));
  }
  async gcOrphanedWorkspaces() {
    return gcOrphanedWorkspaces(this.serviceConfig.baseDir, this.serviceConfig.workspaceTtlMs ?? 24 * 60 * 60 * 1000, new Set(this.workspaces.keys()), (msg) => this.log(msg));
  }
  log(message) {
    if (this.serviceConfig.debug) {
      console.log(`[CodingWorkspaceService] ${message}`);
    }
  }
}
// src/api/agent-routes.ts
import * as os4 from "node:os";
import * as path6 from "node:path";
async function handleAgentRoutes(req, res, pathname, ctx) {
  const method = req.method?.toUpperCase();
  if (method === "GET" && pathname === "/api/coding-agents/preflight") {
    if (!ctx.ptyService) {
      sendError(res, "PTY Service not available", 503);
      return true;
    }
    try {
      const results = await ctx.ptyService.checkAvailableAgents();
      sendJson(res, results);
    } catch (error) {
      sendError(res, error instanceof Error ? error.message : "Preflight check failed", 500);
    }
    return true;
  }
  if (method === "GET" && pathname === "/api/coding-agents/metrics") {
    if (!ctx.ptyService) {
      sendError(res, "PTY Service not available", 503);
      return true;
    }
    sendJson(res, ctx.ptyService.getAgentMetrics());
    return true;
  }
  if (method === "GET" && pathname === "/api/coding-agents/workspace-files") {
    if (!ctx.ptyService) {
      sendError(res, "PTY Service not available", 503);
      return true;
    }
    try {
      const url = new URL(req.url || "", `http://${req.headers.host}`);
      const agentType = url.searchParams.get("agentType");
      if (!agentType) {
        sendError(res, "agentType query parameter required (claude, gemini, codex, aider, pi)", 400);
        return true;
      }
      if (isPiAgentType(agentType)) {
        sendJson(res, {
          agentType: "pi",
          memoryFilePath: ".pi/agent/settings.json",
          files: []
        });
        return true;
      }
      const files = ctx.ptyService.getWorkspaceFiles(agentType);
      const memoryFilePath = ctx.ptyService.getMemoryFilePath(agentType);
      sendJson(res, {
        agentType,
        memoryFilePath,
        files
      });
    } catch (error) {
      sendError(res, error instanceof Error ? error.message : "Failed to get workspace files", 500);
    }
    return true;
  }
  if (method === "GET" && pathname === "/api/coding-agents/approval-presets") {
    try {
      const { listPresets } = await import("coding-agent-adapters");
      const presets = listPresets();
      sendJson(res, presets);
    } catch (error) {
      sendError(res, error instanceof Error ? error.message : "Failed to list presets", 500);
    }
    return true;
  }
  if (method === "GET" && pathname === "/api/coding-agents/settings") {
    if (!ctx.ptyService) {
      sendError(res, "PTY Service not available", 503);
      return true;
    }
    sendJson(res, {
      defaultApprovalPreset: ctx.ptyService.defaultApprovalPreset,
      agentSelectionStrategy: ctx.ptyService.agentSelectionStrategy,
      defaultAgentType: ctx.ptyService.defaultAgentType
    });
    return true;
  }
  if (method === "GET" && pathname === "/api/coding-agents/approval-config") {
    if (!ctx.ptyService) {
      sendError(res, "PTY Service not available", 503);
      return true;
    }
    const url = new URL(req.url || "", `http://${req.headers.host}`);
    const agentType = url.searchParams.get("agentType");
    const preset = url.searchParams.get("preset");
    if (!agentType || !preset) {
      sendError(res, "agentType and preset query parameters required", 400);
      return true;
    }
    try {
      const config = ctx.ptyService.getApprovalConfig(agentType, preset);
      sendJson(res, config);
    } catch (error) {
      sendError(res, error instanceof Error ? error.message : "Failed to generate config", 500);
    }
    return true;
  }
  if (method === "GET" && pathname === "/api/coding-agents") {
    if (!ctx.ptyService) {
      sendError(res, "PTY Service not available", 503);
      return true;
    }
    try {
      const sessions = await ctx.ptyService.listSessions();
      sendJson(res, sessions);
    } catch (error) {
      sendError(res, error instanceof Error ? error.message : "Failed to list agents", 500);
    }
    return true;
  }
  if (method === "POST" && pathname === "/api/coding-agents/spawn") {
    if (!ctx.ptyService) {
      sendError(res, "PTY Service not available", 503);
      return true;
    }
    try {
      const body = await parseBody(req);
      const {
        agentType,
        workdir: rawWorkdir,
        task,
        memoryContent,
        approvalPreset,
        customCredentials,
        metadata
      } = body;
      const workspaceBaseDir = path6.join(os4.homedir(), ".milady", "workspaces");
      const allowedPrefixes = [
        path6.resolve(workspaceBaseDir),
        path6.resolve(process.cwd())
      ];
      let workdir = rawWorkdir;
      if (workdir) {
        const resolved = path6.resolve(workdir);
        const isAllowed = allowedPrefixes.some((prefix2) => resolved === prefix2 || resolved.startsWith(prefix2 + path6.sep));
        if (!isAllowed) {
          sendError(res, "workdir must be within workspace base directory or cwd", 403);
          return true;
        }
        workdir = resolved;
      }
      const activeSessions = await ctx.ptyService.listSessions();
      const maxSessions = 8;
      if (activeSessions.length >= maxSessions) {
        sendError(res, `Concurrent session limit reached (${maxSessions})`, 429);
        return true;
      }
      const credentials = {
        anthropicKey: ctx.runtime.getSetting("ANTHROPIC_API_KEY"),
        openaiKey: ctx.runtime.getSetting("OPENAI_API_KEY"),
        googleKey: ctx.runtime.getSetting("GOOGLE_GENERATIVE_AI_API_KEY"),
        githubToken: ctx.runtime.getSetting("GITHUB_TOKEN")
      };
      const agentStr = agentType ? agentType.toLowerCase() : await ctx.ptyService.resolveAgentType();
      const piRequested = isPiAgentType(agentStr);
      const normalizedType = normalizeAgentType(agentStr);
      const prefixMap = {
        claude: "PARALLAX_CLAUDE",
        gemini: "PARALLAX_GEMINI",
        codex: "PARALLAX_CODEX",
        aider: "PARALLAX_AIDER"
      };
      const prefix = prefixMap[agentStr];
      const modelPowerful = prefix ? ctx.runtime.getSetting(`${prefix}_MODEL_POWERFUL`) : null;
      const modelFast = prefix ? ctx.runtime.getSetting(`${prefix}_MODEL_FAST`) : null;
      const aiderProvider = agentStr === "aider" ? ctx.runtime.getSetting("PARALLAX_AIDER_PROVIDER") : null;
      const coordinator = getCoordinator(ctx.runtime);
      const session = await ctx.ptyService.spawnSession({
        name: `agent-${Date.now()}`,
        agentType: normalizedType,
        workdir,
        initialTask: piRequested ? toPiCommand(task) : task,
        memoryContent,
        credentials,
        approvalPreset,
        customCredentials,
        metadata: {
          requestedType: agentStr,
          ...metadata,
          ...aiderProvider ? { provider: aiderProvider } : {},
          modelPrefs: {
            ...modelPowerful ? { powerful: modelPowerful } : {},
            ...modelFast ? { fast: modelFast } : {}
          }
        }
      });
      if (coordinator && task) {
        const label = metadata?.label;
        coordinator.registerTask(session.id, {
          agentType: agentStr,
          label: label || `agent-${session.id.slice(-8)}`,
          originalTask: task,
          workdir: session.workdir
        });
      }
      sendJson(res, {
        sessionId: session.id,
        agentType: session.agentType,
        workdir: session.workdir,
        status: session.status
      }, 201);
    } catch (error) {
      sendError(res, error instanceof Error ? error.message : "Failed to spawn agent", 500);
    }
    return true;
  }
  const agentMatch = pathname.match(/^\/api\/coding-agents\/([^/]+)$/);
  if (method === "GET" && agentMatch) {
    if (!ctx.ptyService) {
      sendError(res, "PTY Service not available", 503);
      return true;
    }
    const sessionId = agentMatch[1];
    const session = ctx.ptyService.getSession(sessionId);
    if (!session) {
      sendError(res, "Agent session not found", 404);
      return true;
    }
    sendJson(res, session);
    return true;
  }
  const sendMatch = pathname.match(/^\/api\/coding-agents\/([^/]+)\/send$/);
  if (method === "POST" && sendMatch) {
    if (!ctx.ptyService) {
      sendError(res, "PTY Service not available", 503);
      return true;
    }
    try {
      const sessionId = sendMatch[1];
      const body = await parseBody(req);
      const { input, keys } = body;
      if (keys) {
        await ctx.ptyService.sendKeysToSession(sessionId, keys);
        sendJson(res, { success: true });
      } else if (input && typeof input === "string") {
        await ctx.ptyService.sendToSession(sessionId, input);
        sendJson(res, { success: true });
      } else {
        sendError(res, "Either 'input' (string) or 'keys' (string|string[]) required", 400);
        return true;
      }
    } catch (error) {
      sendError(res, error instanceof Error ? error.message : "Failed to send input", 500);
    }
    return true;
  }
  const stopMatch = pathname.match(/^\/api\/coding-agents\/([^/]+)\/stop$/);
  if (method === "POST" && stopMatch) {
    if (!ctx.ptyService) {
      sendError(res, "PTY Service not available", 503);
      return true;
    }
    try {
      const sessionId = stopMatch[1];
      await ctx.ptyService.stopSession(sessionId);
      sendJson(res, { success: true, sessionId });
    } catch (error) {
      sendError(res, error instanceof Error ? error.message : "Failed to stop agent", 500);
    }
    return true;
  }
  const outputMatch = pathname.match(/^\/api\/coding-agents\/([^/]+)\/output$/);
  if (method === "GET" && outputMatch) {
    if (!ctx.ptyService) {
      sendError(res, "PTY Service not available", 503);
      return true;
    }
    try {
      const sessionId = outputMatch[1];
      const url = new URL(req.url || "", `http://${req.headers.host}`);
      const lines = parseInt(url.searchParams.get("lines") || "100", 10);
      const output = await ctx.ptyService.getSessionOutput(sessionId, lines);
      sendJson(res, { sessionId, output });
    } catch (error) {
      sendError(res, error instanceof Error ? error.message : "Failed to get output", 500);
    }
    return true;
  }
  const bufferedMatch = pathname.match(/^\/api\/coding-agents\/([^/]+)\/buffered-output$/);
  if (method === "GET" && bufferedMatch) {
    if (!ctx.ptyService?.consoleBridge) {
      sendError(res, "Console bridge not available", 503);
      return true;
    }
    try {
      const sessionId = bufferedMatch[1];
      const output = ctx.ptyService.consoleBridge.getBufferedOutput(sessionId);
      sendJson(res, { sessionId, output });
    } catch (error) {
      sendError(res, error instanceof Error ? error.message : "Failed to get buffered output", 500);
    }
    return true;
  }
  return false;
}

// src/api/coordinator-routes.ts
async function handleCoordinatorRoutes(req, res, pathname, ctx) {
  if (!pathname.startsWith(COORDINATOR_PREFIX)) {
    return false;
  }
  const method = req.method?.toUpperCase();
  const subPath = pathname.slice(COORDINATOR_PREFIX.length);
  if (!ctx.coordinator) {
    sendError(res, "Swarm Coordinator not available", 503);
    return true;
  }
  const coordinator = ctx.coordinator;
  if (method === "GET" && subPath === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });
    res.write(":ok\n\n");
    const unsubscribe = coordinator.addSseClient(res);
    req.on("close", unsubscribe);
    const keepAlive = setInterval(() => {
      if (res.writableEnded) {
        clearInterval(keepAlive);
        return;
      }
      res.write(":ping\n\n");
    }, 30000);
    req.on("close", () => clearInterval(keepAlive));
    return true;
  }
  if (method === "GET" && subPath === "/status") {
    const tasks = coordinator.getAllTaskContexts();
    sendJson(res, {
      supervisionLevel: coordinator.getSupervisionLevel(),
      taskCount: tasks.length,
      tasks: tasks.map((t) => ({
        sessionId: t.sessionId,
        agentType: t.agentType,
        label: t.label,
        originalTask: t.originalTask,
        workdir: t.workdir,
        status: t.status,
        decisionCount: t.decisions.length,
        autoResolvedCount: t.autoResolvedCount
      })),
      pendingConfirmations: coordinator.getPendingConfirmations().length
    });
    return true;
  }
  const taskMatch = subPath.match(/^\/tasks\/([^/]+)$/);
  if (method === "GET" && taskMatch) {
    const sessionId = taskMatch[1];
    const task = coordinator.getTaskContext(sessionId);
    if (!task) {
      sendError(res, "Task context not found", 404);
      return true;
    }
    sendJson(res, task);
    return true;
  }
  if (method === "GET" && subPath === "/pending") {
    const pending = coordinator.getPendingConfirmations();
    sendJson(res, pending.map((p) => ({
      sessionId: p.sessionId,
      promptText: p.promptText,
      suggestedAction: p.llmDecision.action,
      suggestedResponse: p.llmDecision.response,
      reasoning: p.llmDecision.reasoning,
      agentType: p.taskContext.agentType,
      label: p.taskContext.label,
      createdAt: p.createdAt
    })));
    return true;
  }
  const confirmMatch = subPath.match(/^\/confirm\/([^/]+)$/);
  if (method === "POST" && confirmMatch) {
    try {
      const sessionId = confirmMatch[1];
      const body = await parseBody(req);
      const approved = body.approved !== false;
      const override = body.override;
      await coordinator.confirmDecision(sessionId, approved, override);
      sendJson(res, { success: true, sessionId, approved });
    } catch (error) {
      sendError(res, error instanceof Error ? error.message : "Failed to confirm decision", error instanceof Error && error.message.includes("No pending") ? 404 : 500);
    }
    return true;
  }
  if (method === "GET" && subPath === "/supervision") {
    sendJson(res, { level: coordinator.getSupervisionLevel() });
    return true;
  }
  if (method === "POST" && subPath === "/supervision") {
    try {
      const body = await parseBody(req);
      const level = body.level;
      if (!["autonomous", "confirm", "notify"].includes(level)) {
        sendError(res, 'Invalid supervision level. Must be "autonomous", "confirm", or "notify"', 400);
        return true;
      }
      coordinator.setSupervisionLevel(level);
      sendJson(res, { success: true, level });
    } catch (error) {
      sendError(res, error instanceof Error ? error.message : "Failed to set supervision level", 500);
    }
    return true;
  }
  return false;
}
var COORDINATOR_PREFIX = "/api/coding-agents/coordinator";

// src/api/issue-routes.ts
async function handleIssueRoutes(req, res, pathname, ctx) {
  const method = req.method?.toUpperCase();
  if (method === "GET" && pathname === "/api/issues") {
    if (!ctx.workspaceService) {
      sendError(res, "Workspace Service not available", 503);
      return true;
    }
    try {
      const url = new URL(req.url || "", `http://${req.headers.host}`);
      const repo = url.searchParams.get("repo");
      if (!repo) {
        sendError(res, "repo query parameter required", 400);
        return true;
      }
      const state = url.searchParams.get("state");
      const labelsParam = url.searchParams.get("labels");
      const labels = labelsParam ? labelsParam.split(",").map((s) => s.trim()) : undefined;
      const issues = await ctx.workspaceService.listIssues(repo, {
        state: state ?? "open",
        labels
      });
      sendJson(res, issues);
    } catch (error) {
      sendError(res, error instanceof Error ? error.message : "Failed to list issues", 500);
    }
    return true;
  }
  if (method === "POST" && pathname === "/api/issues") {
    if (!ctx.workspaceService) {
      sendError(res, "Workspace Service not available", 503);
      return true;
    }
    try {
      const body = await parseBody(req);
      const { repo, title, body: issueBody, labels } = body;
      if (!repo || !title) {
        sendError(res, "repo and title are required", 400);
        return true;
      }
      const issue = await ctx.workspaceService.createIssue(repo, {
        title,
        body: issueBody ?? "",
        labels
      });
      sendJson(res, issue, 201);
    } catch (error) {
      sendError(res, error instanceof Error ? error.message : "Failed to create issue", 500);
    }
    return true;
  }
  const issueGetMatch = pathname.match(/^\/api\/issues\/([^/]+)\/([^/]+)\/(\d+)$/);
  if (method === "GET" && issueGetMatch) {
    if (!ctx.workspaceService) {
      sendError(res, "Workspace Service not available", 503);
      return true;
    }
    try {
      const repo = `${issueGetMatch[1]}/${issueGetMatch[2]}`;
      const issueNumber = parseInt(issueGetMatch[3], 10);
      const issue = await ctx.workspaceService.getIssue(repo, issueNumber);
      sendJson(res, issue);
    } catch (error) {
      sendError(res, error instanceof Error ? error.message : "Failed to get issue", 500);
    }
    return true;
  }
  const commentMatch = pathname.match(/^\/api\/issues\/([^/]+)\/([^/]+)\/(\d+)\/comment$/);
  if (method === "POST" && commentMatch) {
    if (!ctx.workspaceService) {
      sendError(res, "Workspace Service not available", 503);
      return true;
    }
    try {
      const repo = `${commentMatch[1]}/${commentMatch[2]}`;
      const issueNumber = parseInt(commentMatch[3], 10);
      const body = await parseBody(req);
      if (!body.body) {
        sendError(res, "body is required", 400);
        return true;
      }
      const comment = await ctx.workspaceService.addComment(repo, issueNumber, body.body);
      sendJson(res, comment, 201);
    } catch (error) {
      sendError(res, error instanceof Error ? error.message : "Failed to add comment", 500);
    }
    return true;
  }
  const closeMatch = pathname.match(/^\/api\/issues\/([^/]+)\/([^/]+)\/(\d+)\/close$/);
  if (method === "POST" && closeMatch) {
    if (!ctx.workspaceService) {
      sendError(res, "Workspace Service not available", 503);
      return true;
    }
    try {
      const repo = `${closeMatch[1]}/${closeMatch[2]}`;
      const issueNumber = parseInt(closeMatch[3], 10);
      const issue = await ctx.workspaceService.closeIssue(repo, issueNumber);
      sendJson(res, issue);
    } catch (error) {
      sendError(res, error instanceof Error ? error.message : "Failed to close issue", 500);
    }
    return true;
  }
  return false;
}

// src/api/workspace-routes.ts
async function handleWorkspaceRoutes(req, res, pathname, ctx) {
  const method = req.method?.toUpperCase();
  if (method === "POST" && pathname === "/api/workspace/provision") {
    if (!ctx.workspaceService) {
      sendError(res, "Workspace Service not available", 503);
      return true;
    }
    try {
      const body = await parseBody(req);
      const { repo, baseBranch, useWorktree, parentWorkspaceId, branchName } = body;
      const workspace = await ctx.workspaceService.provisionWorkspace({
        repo,
        baseBranch,
        branchName,
        useWorktree,
        parentWorkspaceId
      });
      sendJson(res, {
        id: workspace.id,
        path: workspace.path,
        branch: workspace.branch,
        isWorktree: workspace.isWorktree
      }, 201);
    } catch (error) {
      sendError(res, error instanceof Error ? error.message : "Failed to provision workspace", 500);
    }
    return true;
  }
  const workspaceMatch = pathname.match(/^\/api\/workspace\/([^/]+)$/);
  if (method === "GET" && workspaceMatch) {
    if (!ctx.workspaceService) {
      sendError(res, "Workspace Service not available", 503);
      return true;
    }
    try {
      const workspaceId = workspaceMatch[1];
      const status = await ctx.workspaceService.getStatus(workspaceId);
      sendJson(res, status);
    } catch (error) {
      sendError(res, error instanceof Error ? error.message : "Failed to get workspace", 500);
    }
    return true;
  }
  const commitMatch = pathname.match(/^\/api\/workspace\/([^/]+)\/commit$/);
  if (method === "POST" && commitMatch) {
    if (!ctx.workspaceService) {
      sendError(res, "Workspace Service not available", 503);
      return true;
    }
    try {
      const workspaceId = commitMatch[1];
      const body = await parseBody(req);
      const { message } = body;
      const result = await ctx.workspaceService.commit(workspaceId, {
        message,
        all: true
      });
      sendJson(res, result);
    } catch (error) {
      sendError(res, error instanceof Error ? error.message : "Failed to commit", 500);
    }
    return true;
  }
  const pushMatch = pathname.match(/^\/api\/workspace\/([^/]+)\/push$/);
  if (method === "POST" && pushMatch) {
    if (!ctx.workspaceService) {
      sendError(res, "Workspace Service not available", 503);
      return true;
    }
    try {
      const workspaceId = pushMatch[1];
      const body = await parseBody(req);
      const result = await ctx.workspaceService.push(workspaceId, {
        force: body.force,
        setUpstream: body.setUpstream
      });
      sendJson(res, result);
    } catch (error) {
      sendError(res, error instanceof Error ? error.message : "Failed to push", 500);
    }
    return true;
  }
  const prMatch = pathname.match(/^\/api\/workspace\/([^/]+)\/pr$/);
  if (method === "POST" && prMatch) {
    if (!ctx.workspaceService) {
      sendError(res, "Workspace Service not available", 503);
      return true;
    }
    try {
      const workspaceId = prMatch[1];
      const body = await parseBody(req);
      const result = await ctx.workspaceService.createPR(workspaceId, {
        title: body.title,
        body: body.body,
        base: body.baseBranch,
        draft: body.draft
      });
      sendJson(res, result, 201);
    } catch (error) {
      sendError(res, error instanceof Error ? error.message : "Failed to create PR", 500);
    }
    return true;
  }
  const deleteMatch = pathname.match(/^\/api\/workspace\/([^/]+)$/);
  if (method === "DELETE" && deleteMatch) {
    if (!ctx.workspaceService) {
      sendError(res, "Workspace Service not available", 503);
      return true;
    }
    try {
      const workspaceId = deleteMatch[1];
      await ctx.workspaceService.removeWorkspace(workspaceId);
      sendJson(res, { success: true, workspaceId });
    } catch (error) {
      sendError(res, error instanceof Error ? error.message : "Failed to remove workspace", 500);
    }
    return true;
  }
  return false;
}

// src/api/routes.ts
async function parseBody(req) {
  return new Promise((resolve5, reject) => {
    let body = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += typeof chunk === "string" ? chunk.length : chunk.byteLength;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve5(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}
function sendJson(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}
function sendError(res, message, status = 400) {
  sendJson(res, { error: message }, status);
}
async function handleCodingAgentRoutes(req, res, pathname, ctx) {
  if (await handleCoordinatorRoutes(req, res, pathname, ctx)) {
    return true;
  }
  if (await handleAgentRoutes(req, res, pathname, ctx)) {
    return true;
  }
  if (await handleWorkspaceRoutes(req, res, pathname, ctx)) {
    return true;
  }
  if (await handleIssueRoutes(req, res, pathname, ctx)) {
    return true;
  }
  return false;
}
function createCodingAgentRouteHandler(runtime, coordinator) {
  const ptyService = runtime.getService("PTY_SERVICE");
  const workspaceService = runtime.getService("CODING_WORKSPACE_SERVICE");
  const ctx = {
    runtime,
    ptyService,
    workspaceService,
    coordinator
  };
  return (req, res, pathname) => handleCodingAgentRoutes(req, res, pathname, ctx);
}
var MAX_BODY_SIZE = 1024 * 1024;

// src/index.ts
var codingAgentPlugin = {
  name: "@elizaos/plugin-agent-orchestrator",
  description: "Orchestrate CLI coding agents (Claude Code, Codex, Gemini, Aider, Pi, etc.) via PTY sessions, " + "manage git workspaces, and handle GitHub issues for autonomous coding tasks",
  services: [PTYService, CodingWorkspaceService],
  actions: [
    startCodingTaskAction,
    spawnAgentAction,
    sendToAgentAction,
    stopAgentAction,
    listAgentsAction,
    provisionWorkspaceAction,
    finalizeWorkspaceAction,
    manageIssuesAction
  ],
  evaluators: [],
  providers: [
    activeWorkspaceContextProvider,
    codingAgentExamplesProvider
  ]
};
var src_default = codingAgentPlugin;
export {
  stopAgentAction,
  startCodingTaskAction,
  spawnAgentAction,
  sendToAgentAction,
  provisionWorkspaceAction,
  manageIssuesAction,
  listAgentsAction,
  handleCodingAgentRoutes,
  getCoordinator,
  finalizeWorkspaceAction,
  src_default as default,
  createCodingAgentRouteHandler,
  codingAgentPlugin,
  SwarmCoordinator,
  PTYService,
  CodingWorkspaceService
};

//# debugId=8ECA10FB673225DA64756E2164756E21
//# sourceMappingURL=index.js.map
