"use node";

import { Daytona, type Sandbox } from "@daytona/sdk";
import { v } from "convex/values";
import {
  assertPublicHttpsUrl,
  capArtifactContent,
  COMPUTE_TOOLS,
  defaultComputeSystemPrompt,
  extractToolCalls,
  inferArtifactType,
  inferMediaType,
  isAgentTimeoutError,
  isSandboxTool,
  knownArtifactPaths,
  looksLikeLeakedToolCall,
  looksLikeToolRefusal,
  openAiToolsForCompute,
  openAiToolsForSubagent,
  parsePlanSteps,
  parseToolArguments,
  planPromptSection,
  proposePlanTool,
  SUBAGENT_TOOLS,
  toolTraceSummary,
  validateToolCall,
  type AgentArtifact,
  type AgentPlanStepStatus,
  type AgentToolName,
  type AgentToolTraceEntry,
  type SubagentResult,
  type SubagentTask,
} from "../shared/agentTools";
import { clampSearchResultCount, parseExaSearchResponse } from "../shared/webSearch";
import { internal } from "./_generated/api";
import { internalAction, type ActionCtx } from "./_generated/server";
import { publicGitUrl, safeSandboxPath, structuredProcessOutput } from "./daytonaPolicy";

type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

type OpenRouterMessage = {
  role?: string;
  content?: string | null;
  tool_calls?: unknown;
};

const MODEL_ROUND_TIMEOUT_MS = 60_000;
// Production actions were observed being terminated at ~255s. Keep enough
// headroom to persist results and let the workflow engine journal completion.
const MAX_AGENT_ACTION_SECONDS = 220;
const FINAL_SYNTHESIS_RESERVE_MS = 35_000;
const MAX_TOOL_RESULT_CHARS = 24_000;

function daytonaClient() {
  const apiKey = process.env.DAYTONA_API_KEY?.trim();
  if (!apiKey) throw new Error("DAYTONA_API_KEY is not configured in Convex.");
  return new Daytona({
    apiKey,
    ...(process.env.DAYTONA_API_URL?.trim() ? { apiUrl: process.env.DAYTONA_API_URL.trim() } : {}),
    ...(process.env.DAYTONA_TARGET?.trim() ? { target: process.env.DAYTONA_TARGET.trim() } : {}),
    requestTimeoutMs: 15 * 60 * 1_000,
  });
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function searchWeb(query: string, numResults: number) {
  if (!process.env.EXA_API_KEY) throw new Error("EXA_API_KEY is not configured in Convex.");
  const response = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "x-api-key": process.env.EXA_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      type: "auto",
      numResults: clampSearchResultCount(numResults),
      contents: { text: { maxCharacters: 1500 } },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error("Exa rejected the configured EXA_API_KEY. Update the key in Convex and retry.");
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Web search failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : "."}`);
  }
  const results = parseExaSearchResponse(await response.json());
  return { query, results, count: results.length, source: "exa" };
}

/** Exa's general Search endpoint accepts one query per request. A batch tool
 * call fans those requests out concurrently so the model pays one round-trip
 * instead of serially deciding and waiting for every search. */
async function batchSearchWeb(queries: string[], numResults: number) {
  const searches = await Promise.all(queries.map(async (query) => {
    try {
      return { ok: true as const, ...(await searchWeb(query, numResults)) };
    } catch (error) {
      return {
        ok: false as const,
        query,
        results: [],
        count: 0,
        source: "exa",
        error: error instanceof Error ? error.message : "Web search failed.",
      };
    }
  }));
  return {
    searches,
    queryCount: searches.length,
    resultCount: searches.reduce((count, search) => count + search.count, 0),
    source: "exa",
  };
}

const MAX_FETCH_REDIRECTS = 5;

// Browser-like headers: bot-protection layers (Cloudflare et al.) block custom
// user agents coming from datacenter IPs, which is where Convex actions run.
const FETCH_URL_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 OpenWorkflowAgent/1.0",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
} as const;

async function fetchPublicUrl(url: string, maxChars: number) {
  // Redirects are followed manually so every hop is re-validated against
  // private/local hosts (SSRF guard) instead of blindly trusting Location.
  let current = assertPublicHttpsUrl(url);
  let response: Response;
  let hops = 0;
  for (;;) {
    try {
      response = await fetch(current, {
        redirect: "manual",
        headers: FETCH_URL_HEADERS,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      const reason = error instanceof Error && error.name === "TimeoutError" ? "timed out after 30s" : "network error";
      throw new Error(`Fetch failed (${reason}) for ${current.toString()}`);
    }
    if (response.status < 300 || response.status >= 400) break;
    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => {});
    if (!location) {
      throw new Error(`Fetch failed (${response.status} redirect without a Location header) for ${current.toString()}`);
    }
    if (++hops > MAX_FETCH_REDIRECTS) {
      throw new Error(`Fetch failed (more than ${MAX_FETCH_REDIRECTS} redirects) for ${url}`);
    }
    current = assertPublicHttpsUrl(new URL(location, current).toString());
  }
  if (!response.ok) throw new Error(`Fetch failed (${response.status}) for ${current.toString()}`);
  const contentType = response.headers.get("content-type") ?? "";
  const raw = await response.text();
  const text = contentType.includes("html") ? htmlToText(raw) : raw;
  return { url: current.toString(), contentType, text: text.slice(0, maxChars) };
}

async function openRouterChat(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  tools: ReturnType<typeof openAiToolsForCompute> | undefined,
  timeoutMs: number,
  toolChoice: "auto" | "required" | "none" = "auto",
): Promise<{ message: OpenRouterMessage; finishReason?: string; usage?: unknown }> {
  let response: Response;
  try {
    response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(process.env.OPENROUTER_SITE_URL ? { "HTTP-Referer": process.env.OPENROUTER_SITE_URL } : {}),
        "X-OpenRouter-Title": process.env.OPENROUTER_APP_NAME ?? "OpenWorkflow",
      },
      body: JSON.stringify({
        model,
        messages,
        ...(tools?.length
          ? {
              tools,
              tool_choice: toolChoice === "none" ? "none" : toolChoice,
              // Only route to providers that honor tools/tool_choice — otherwise
              // the model leaks tool calls as plain text.
              provider: { require_parameters: true },
            }
          : {}),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (isAgentTimeoutError(error)) {
      throw new Error(`OpenRouter model round timed out after ${Math.ceil(timeoutMs / 1000)} seconds.`);
    }
    throw error;
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(payload.error?.message ?? `OpenRouter request failed (${response.status}).`);
  }
  const payload = (await response.json()) as {
    choices?: Array<{ message?: OpenRouterMessage; finish_reason?: string }>;
    usage?: unknown;
  };
  const choice = payload.choices?.[0];
  const message = choice?.message;
  if (!message) throw new Error("OpenRouter returned an empty response.");
  return { message, finishReason: choice?.finish_reason, usage: payload.usage };
}

async function ensureSandbox(
  daytona: Daytona,
  existing: Sandbox | undefined,
  boundaryId: string,
  serializedInput: string,
): Promise<Sandbox> {
  if (existing) return existing;
  const sandbox = await daytona.create(
    {
      language: "python",
      ttlMinutes: 60,
      ephemeral: true,
      public: false,
      networkBlockAll: true,
      labels: { openworkflow_agent: boundaryId },
    },
    { timeout: 90 },
  );
  await sandbox.fs.createFolder("workspace", "755");
  await sandbox.fs.uploadFile(Buffer.from(serializedInput), "/tmp/openworkflow-input.json");
  await sandbox.fs.uploadFile(Buffer.from(serializedInput), "workspace/input.json");
  return sandbox;
}

async function runSandboxCode(
  sandbox: Sandbox,
  language: "python" | "javascript" | "typescript",
  code: string,
  serializedInput: string,
  timeout: number,
) {
  const path =
    language === "python"
      ? "workspace/.agent_run.py"
      : language === "typescript"
        ? "workspace/.agent_run.ts"
        : "workspace/.agent_run.js";
  const command =
    language === "python"
      ? `python3 ${path}`
      : language === "typescript"
        ? `node --experimental-strip-types ${path}`
        : `node ${path}`;

  await sandbox.fs.uploadFile(Buffer.from(code), path);
  await sandbox.fs.uploadFile(Buffer.from(serializedInput), "/tmp/openworkflow-input.json");
  const sessionId = `agent-${crypto.randomUUID()}`;
  await sandbox.process.createSession(sessionId);
  try {
    const started = await sandbox.process.executeSessionCommand(
      sessionId,
      { command, runAsync: true, suppressInputEcho: true },
      timeout,
    );
    let stdout = "";
    let stderr = "";
    await sandbox.process.getSessionCommandLogs(
      sessionId,
      started.cmdId,
      (chunk) => {
        stdout += chunk;
      },
      (chunk) => {
        stderr += chunk;
      },
    );
    const completed = await sandbox.process.getSessionCommand(sessionId, started.cmdId);
    return structuredProcessOutput(stdout, stderr, completed.exitCode ?? 1);
  } finally {
    await sandbox.process.deleteSession(sessionId).catch(() => undefined);
  }
}

async function runAllowlistedShell(sandbox: Sandbox, command: string, cwd: string, timeout: number) {
  await sandbox.fs.createFolder(cwd, "755");
  const sessionId = `agent-shell-${crypto.randomUUID()}`;
  await sandbox.process.createSession(sessionId);
  try {
    const started = await sandbox.process.executeSessionCommand(
      sessionId,
      { command: `cd ${cwd} && ${command}`, runAsync: true, suppressInputEcho: true },
      timeout,
    );
    let stdout = "";
    let stderr = "";
    await sandbox.process.getSessionCommandLogs(
      sessionId,
      started.cmdId,
      (chunk) => {
        stdout += chunk;
      },
      (chunk) => {
        stderr += chunk;
      },
    );
    const completed = await sandbox.process.getSessionCommand(sessionId, started.cmdId);
    return structuredProcessOutput(stdout, stderr, completed.exitCode ?? 1);
  } finally {
    await sandbox.process.deleteSession(sessionId).catch(() => undefined);
  }
}

async function readSandboxFile(sandbox: Sandbox, path: string): Promise<string> {
  const buffer = await sandbox.fs.downloadFile(path);
  return Buffer.from(buffer).toString("utf8");
}

async function patchPartial(
  ctx: ActionCtx,
  stepRunId: import("./_generated/dataModel").Id<"stepRuns">,
  content: string,
  toolTrace: AgentToolTraceEntry[],
) {
  // The structured trace streams alongside the text so the transcript can render
  // live activity rows instead of a "Tools so far" text dump.
  await ctx.runMutation(internal.executor.updateStepPartialOutput, {
    stepRunId,
    partialOutput: content.trim().slice(-100_000),
    toolTrace: toolTrace.slice(-200),
  });
}

/**
 * Shared model/tool round loop used by the main agent and its subagents.
 * Handles refusal nudges, leaked-tool-call detection, the final no-tools round,
 * and message bookkeeping; tool execution is delegated to `dispatch`.
 */
async function runToolLoop(options: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  tools: ReturnType<typeof openAiToolsForCompute>;
  allowedTools: readonly AgentToolName[];
  maxRounds: number;
  deadline: number;
  toolTrace: AgentToolTraceEntry[];
  dispatch: (name: AgentToolName, args: Record<string, unknown>) => Promise<unknown>;
  onProgress?: (content: string) => Promise<void>;
  fallbackContent?: () => string;
}): Promise<{ content: string; usage?: unknown }> {
  const {
    apiKey,
    model,
    messages,
    tools,
    allowedTools,
    maxRounds,
    deadline,
    toolTrace,
    dispatch,
    onProgress,
    fallbackContent,
  } = options;
  let usage: unknown;
  let content = "";
  let refusalNudges = 0;
  let synthesizeNextRound = false;

  const checkpoint = () => fallbackContent?.().trim() || content.trim();

  for (let round = 0; round <= maxRounds; round += 1) {
    if (Date.now() > deadline) {
      const fallback = checkpoint();
      if (fallback) return { content: fallback, usage };
      throw new Error("Agent timed out before finishing.");
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 6_000) {
      const fallback = checkpoint();
      if (fallback) return { content: fallback, usage };
      throw new Error("Agent timed out before finishing.");
    }
    const finalRound = synthesizeNextRound || round >= maxRounds || remainingMs <= FINAL_SYNTHESIS_RESERVE_MS;
    const roundTimeoutMs = Math.max(
      1_000,
      Math.min(MODEL_ROUND_TIMEOUT_MS, remainingMs - (finalRound ? 5_000 : 0)),
    );
    const forceTools = refusalNudges > 0 && toolTrace.length === 0;
    await onProgress?.(
      [content.trim(), `Waiting for model response (round ${round + 1})…`].filter(Boolean).join("\n\n"),
    );
    let completion: Awaited<ReturnType<typeof openRouterChat>>;
    try {
      completion = await openRouterChat(
        apiKey,
        model,
        messages,
        finalRound ? undefined : tools,
        roundTimeoutMs,
        finalRound ? "none" : forceTools ? "required" : "auto",
      );
    } catch (error) {
      const fallback = finalRound || isAgentTimeoutError(error) ? checkpoint() : "";
      if (fallback) return { content: fallback, usage };
      throw error;
    }
    usage = completion.usage ?? usage;
    const message = completion.message;
    const toolCalls = extractToolCalls(message);
    const assistantText = typeof message.content === "string" ? message.content : "";
    if (assistantText) content = assistantText;

    // Model refused tools in prose, or leaked a tool call as plain text
    // (provider dropped the tools parameter) — nudge and retry with
    // tool_choice forced on the next round.
    if (
      !finalRound &&
      !toolCalls.length &&
      (looksLikeToolRefusal(assistantText) || looksLikeLeakedToolCall(assistantText)) &&
      refusalNudges < 2
    ) {
      refusalNudges += 1;
      messages.push({ role: "assistant", content: assistantText || null });
      messages.push({
        role: "user",
        content: looksLikeLeakedToolCall(assistantText)
          ? "You wrote the tool invocation as plain text instead of calling the function. Invoke the tool through the structured function-calling interface now — do not write the call as text."
          : "Those tools are available via function calling in this request. Call the appropriate tool now (for example run_code). Do not say a tool is unavailable.",
      });
      await onProgress?.(content);
      continue;
    }

    messages.push({
      role: "assistant",
      content: assistantText || null,
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    });

    if (!toolCalls.length) {
      await onProgress?.(content);
      break;
    }

    if (finalRound) break;

    for (const call of toolCalls) {
      if (Date.now() > deadline) {
        const fallback = checkpoint();
        if (fallback) return { content: fallback, usage };
        throw new Error("Agent timed out while running tools.");
      }
      const name = call.function?.name ?? "";
      let toolResult: unknown;
      let ok = true;
      let validatedArgs: Record<string, unknown> = {};
      try {
        const validated = validateToolCall(name, call.function?.arguments ?? "{}", allowedTools);
        validatedArgs = validated.args;
        toolResult = await dispatch(validated.name, validated.args);
      } catch (error) {
        ok = false;
        toolResult = { error: error instanceof Error ? error.message : "Tool failed." };
      }

      const summary = toolTraceSummary((name as AgentToolName) || "run_code", validatedArgs, ok);
      const planMarker =
        name === "mark_plan_step" && ok
          ? {
              stepIndex: Math.trunc(Number(validatedArgs.stepIndex)),
              stepStatus: String(validatedArgs.status) as "active" | "done" | "skipped",
            }
          : {};
      toolTrace.push({ tool: (name as AgentToolName) || "run_code", summary, ok, ...planMarker });
      if (name === "spawn_subagents" && ok) synthesizeNextRound = true;
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(toolResult).slice(0, MAX_TOOL_RESULT_CHARS),
      });
      await onProgress?.(content || summary);
    }
  }

  return { content, usage };
}

const SUBAGENT_MAX_ROUNDS = 4;
const SUBAGENT_TIMEOUT_MS = 90_000;

/** One parallel research child: web search + fetch only, no sandbox, no recursion. */
async function runSubagentTask(
  ctx: ActionCtx,
  apiKey: string,
  model: string,
  task: SubagentTask,
  agentTaskId: import("./_generated/dataModel").Id<"agentTasks">,
  parentDeadline: number,
): Promise<SubagentResult> {
  const citations: Array<{ title: string; url: string }> = [];
  const toolTrace: AgentToolTraceEntry[] = [];
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        "You are a focused research subagent working on one task for a lead agent.",
        "Use batch_web_search when you know several independent queries; use web_search for a single follow-up and fetch_url only for the strongest sources.",
        "Investigate the objective, then reply with a concise, well-organized summary of what you found.",
        "Never invent URLs; cite only sources you retrieved. Lead with the findings that matter most.",
      ].join(" "),
    },
    { role: "user", content: `Task: ${task.name}\n\nObjective: ${task.objective}` },
  ];
  const deadline = Math.min(parentDeadline, Date.now() + SUBAGENT_TIMEOUT_MS);

  try {
    await ctx.runMutation(internal.executor.updateAgentTask, {
      agentTaskId,
      status: "running",
      partialOutput: "Starting research…",
      toolTrace: [],
    });
    const { content } = await runToolLoop({
      apiKey,
      model,
      messages,
      tools: openAiToolsForSubagent(),
      allowedTools: SUBAGENT_TOOLS,
      maxRounds: SUBAGENT_MAX_ROUNDS,
      deadline,
      toolTrace,
      dispatch: async (name, toolArgs) => {
        if (name === "web_search") {
          const result = await searchWeb(String(toolArgs.query), Number(toolArgs.numResults));
          for (const item of result.results as Array<{ title: string; url: string }>) {
            if (item.url && !citations.some((citation) => citation.url === item.url)) {
              citations.push({ title: item.title, url: item.url });
            }
          }
          return result;
        }
        if (name === "batch_web_search") {
          const result = await batchSearchWeb(
            toolArgs.queries as string[],
            Number(toolArgs.numResults),
          );
          for (const search of result.searches) {
            for (const item of search.results as Array<{ title: string; url: string }>) {
              if (item.url && !citations.some((citation) => citation.url === item.url)) {
                citations.push({ title: item.title, url: item.url });
              }
            }
          }
          return result;
        }
        const url = String(toolArgs.url);
        const result = await fetchPublicUrl(url, Number(toolArgs.maxChars));
        if (!citations.some((citation) => citation.url === url)) {
          citations.push({ title: url, url });
        }
        return result;
      },
      onProgress: async (progressContent) => {
        await ctx.runMutation(internal.executor.updateAgentTask, {
          agentTaskId,
          status: "running",
          partialOutput: progressContent,
          toolTrace,
        });
      },
    });
    const result = {
      name: task.name,
      objective: task.objective,
      content: content.trim() || "The subagent finished without a summary.",
      citations,
      toolTrace,
      ok: true,
    };
    await ctx.runMutation(internal.executor.updateAgentTask, {
      agentTaskId,
      status: "completed",
      partialOutput: result.content,
      toolTrace,
      content: result.content,
      citations,
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "The subagent failed.";
    const result = {
      name: task.name,
      objective: task.objective,
      content: message,
      citations,
      toolTrace,
      ok: false,
    };
    await ctx.runMutation(internal.executor.updateAgentTask, {
      agentTaskId,
      status: "failed",
      partialOutput: message,
      toolTrace,
      content: message,
      citations,
      error: message,
    }).catch(() => undefined);
    return result;
  }
}

/**
 * One Luna call that produces the research plan for a plan-first agent step.
 * The executor records the plan on the step run and pauses for user review.
 */
export const generatePlan = internalAction({
  args: {
    model: v.string(),
    systemPrompt: v.string(),
    userPrompt: v.string(),
    stepRunId: v.id("stepRuns"),
  },
  handler: async (ctx, args): Promise<string[]> => {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured in Convex.");
    const planTools = [proposePlanTool()];
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: [
          args.systemPrompt || defaultComputeSystemPrompt(),
          "Before doing any work, write a short research plan by calling the propose_plan function.",
          "Each step is one concrete action (search, fetch, analyze, write). Do not execute anything yet.",
        ].join("\n"),
      },
      { role: "user", content: args.userPrompt },
    ];

    let lastError = "The model did not produce a plan.";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const completion = await openRouterChat(apiKey, args.model, messages, planTools, 60_000, "required");
      const call = extractToolCalls(completion.message).find(
        (candidate) => candidate.function.name === "propose_plan",
      );
      if (call) {
        try {
          return parsePlanSteps(parseToolArguments(call.function.arguments).steps);
        } catch (error) {
          lastError = error instanceof Error ? error.message : lastError;
        }
      }
      messages.push({
        role: "assistant",
        content: typeof completion.message.content === "string" ? completion.message.content : null,
      });
      messages.push({
        role: "user",
        content: "Call the propose_plan function now with 2-8 concrete, ordered steps.",
      });
    }
    throw new Error(`${lastError} Retry the run.`);
  },
});

export const runAgent = internalAction({
  args: {
    model: v.string(),
    systemPrompt: v.string(),
    userPrompt: v.string(),
    input: v.any(),
    maxToolRounds: v.number(),
    timeoutSeconds: v.number(),
    stepRunId: v.id("stepRuns"),
    plan: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured in Convex.");

    const plan = (args.plan ?? []).flatMap((title) => {
      const trimmed = title.trim();
      return trimmed ? [trimmed] : [];
    });
    const hasPlan = plan.length > 0;
    const tools = openAiToolsForCompute({ plan: hasPlan, subagents: true });
    const allowedTools: readonly AgentToolName[] = hasPlan
      ? [...COMPUTE_TOOLS, "spawn_subagents", "mark_plan_step"]
      : [...COMPUTE_TOOLS, "spawn_subagents"];
    const systemPrompt = [
      args.systemPrompt || defaultComputeSystemPrompt(),
      "When you already know multiple independent search queries, call batch_web_search once instead of issuing serial web_search calls.",
      "For broad research you can delegate independent sub-tasks to parallel subagents with spawn_subagents; each returns a cited summary.",
      ...(hasPlan ? [planPromptSection(plan)] : []),
    ].join("\n\n");
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: args.userPrompt },
    ];

    const serializedInput = JSON.stringify(args.input) ?? "null";
    const toolTrace: AgentToolTraceEntry[] = [];
    const artifacts: AgentArtifact[] = [];
    const artifactKeys = new Set<string>();
    const citations: Array<{ title: string; url: string }> = [];
    const subagents: SubagentResult[] = [];
    let sandbox: Sandbox | undefined;
    let daytona: Daytona | undefined;
    const deadline = Date.now() + Math.min(MAX_AGENT_ACTION_SECONDS, Math.max(30, args.timeoutSeconds)) * 1000;
    const maxRounds = Math.min(20, Math.max(1, Math.trunc(args.maxToolRounds)));

    const publishFromPath = async (path: string, type: AgentArtifact["type"], mediaType: string) => {
      if (!sandbox) throw new Error("Sandbox is not available for artifacts.");
      const fileContent = capArtifactContent(await readSandboxFile(sandbox, path));
      const key = `${type}:${path}`;
      if (artifactKeys.has(key)) return { published: true, path, type };
      artifactKeys.add(key);
      artifacts.push({ type, path, mediaType, content: fileContent });
      return { published: true, path, type, bytes: fileContent.length };
    };

    const dispatch = async (name: AgentToolName, toolArgs: Record<string, unknown>): Promise<unknown> => {
      if (isSandboxTool(name) || name === "publish_artifact") {
        daytona ??= daytonaClient();
        sandbox = await ensureSandbox(daytona, sandbox, args.stepRunId, serializedInput);
        await ctx.runMutation(internal.executor.attachSandbox, {
          stepRunId: args.stepRunId,
          sandboxId: sandbox.id,
        });
      }

      switch (name) {
        case "web_search": {
          const result = await searchWeb(String(toolArgs.query), Number(toolArgs.numResults));
          for (const item of result.results as Array<{ title: string; url: string }>) {
            if (item.url && !citations.some((citation) => citation.url === item.url)) {
              citations.push({ title: item.title, url: item.url });
            }
          }
          return result;
        }
        case "batch_web_search": {
          const result = await batchSearchWeb(
            toolArgs.queries as string[],
            Number(toolArgs.numResults),
          );
          for (const search of result.searches) {
            for (const item of search.results as Array<{ title: string; url: string }>) {
              if (item.url && !citations.some((citation) => citation.url === item.url)) {
                citations.push({ title: item.title, url: item.url });
              }
            }
          }
          return result;
        }
        case "fetch_url": {
          const url = String(toolArgs.url);
          const result = await fetchPublicUrl(url, Number(toolArgs.maxChars));
          if (!citations.some((citation) => citation.url === url)) {
            citations.push({ title: url, url });
          }
          return result;
        }
        case "run_code":
          return runSandboxCode(
            sandbox!,
            toolArgs.language as "python" | "javascript" | "typescript",
            String(toolArgs.code),
            serializedInput,
            Math.min(120, Math.max(5, Math.floor((deadline - Date.now()) / 1000))),
          );
        case "write_file": {
          const path = safeSandboxPath(toolArgs.path, "workspace/file.txt");
          const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "workspace";
          await sandbox!.fs.createFolder(parent, "755");
          await sandbox!.fs.uploadFile(Buffer.from(String(toolArgs.content)), path);
          return { written: true, path };
        }
        case "read_file": {
          const path = safeSandboxPath(toolArgs.path, "workspace/file.txt");
          const fileContent = await readSandboxFile(sandbox!, path);
          return { path, content: capArtifactContent(fileContent) };
        }
        case "run_shell":
          return runAllowlistedShell(
            sandbox!,
            String(toolArgs.command),
            safeSandboxPath(toolArgs.workingDirectory, "workspace"),
            Math.min(60, Math.max(5, Math.floor((deadline - Date.now()) / 1000))),
          );
        case "clone_repo": {
          const repositoryUrl = publicGitUrl(toolArgs.repositoryUrl);
          const directory = safeSandboxPath(toolArgs.directory, "workspace/repository");
          const branch = String(toolArgs.branch ?? "").trim() || undefined;
          await sandbox!.git.clone(repositoryUrl, directory, branch, undefined, undefined, undefined, false, 1);
          return { repositoryUrl, directory, branch: branch ?? null };
        }
        case "publish_artifact":
          return publishFromPath(
            safeSandboxPath(toolArgs.path, "workspace/artifact.txt"),
            toolArgs.type as AgentArtifact["type"],
            String(toolArgs.mediaType),
          );
        case "mark_plan_step": {
          const stepIndex = Number(toolArgs.stepIndex);
          const status = String(toolArgs.status) as AgentPlanStepStatus;
          await ctx.runMutation(internal.executor.updateStepPlanProgress, {
            stepRunId: args.stepRunId,
            stepIndex,
            status,
          });
          return { updated: true, stepIndex, status };
        }
        case "spawn_subagents": {
          const tasks = toolArgs.tasks as SubagentTask[];
          const registrations = await ctx.runMutation(internal.executor.registerAgentTasks, {
            stepRunId: args.stepRunId,
            tasks,
          });
          const results = await Promise.all(tasks.map((task, index) => {
            const registration = registrations[index];
            if (!registration) throw new Error("Subagent registration failed.");
            if (registration.cached && registration.result) {
              return registration.result as SubagentResult;
            }
            return runSubagentTask(ctx, apiKey, args.model, task, registration.id, deadline);
          }));
          for (const result of results) {
            subagents.push(result);
            for (const citation of result.citations) {
              if (!citations.some((existing) => existing.url === citation.url)) {
                citations.push(citation);
              }
            }
            for (const entry of result.toolTrace) {
              toolTrace.push({ tool: entry.tool, summary: `[${result.name}] ${entry.summary}`, ok: entry.ok });
            }
          }
          // Condensed view for the model; full results ship in the step output.
          return results.map((result) => ({
            name: result.name,
            ok: result.ok,
            citations: result.citations,
            findings: result.content.slice(0, 8_000),
          }));
        }
        default:
          throw new Error(`Unsupported tool: ${name}`);
      }
    };

    try {
      const loop = await runToolLoop({
        apiKey,
        model: args.model,
        messages,
        tools,
        allowedTools,
        maxRounds,
        deadline,
        toolTrace,
        dispatch,
        onProgress: (progressContent) => patchPartial(ctx, args.stepRunId, progressContent, toolTrace),
        fallbackContent: () => {
          const findings = subagents.map(
            (result) => `\n### ${result.name}\n${result.content.slice(0, 6_000)}`,
          );
          const sources = citations.slice(0, 20).map((citation) => `- [${citation.title}](${citation.url})`);
          if (!findings.length && !sources.length && !toolTrace.length) return "";
          return [
            "## Research checkpoint",
            "The agent reached its execution budget and preserved the work completed so far.",
            ...findings,
            ...(sources.length ? ["\n### Retrieved sources", ...sources] : []),
          ].join("\n");
        },
      });
      let content = loop.content;
      const usage = loop.usage;

      if (!toolTrace.length && looksLikeLeakedToolCall(content)) {
        throw new Error(
          "The model wrote tool calls as plain text instead of invoking them, so no compute ran. Retry the run; if it persists, the selected model or provider does not support function calling.",
        );
      }

      if (sandbox) {
        const activeSandbox = sandbox;
        const harvested = await Promise.all(knownArtifactPaths().map(async (path) => {
          const type = inferArtifactType(path);
          const key = `${type}:${path}`;
          if (artifactKeys.has(key)) return undefined;
          try {
            const fileContent = await readSandboxFile(activeSandbox, path);
            if (!fileContent.trim()) return undefined;
            return {
              type,
              path,
              mediaType: inferMediaType(path),
              content: capArtifactContent(fileContent),
            } satisfies AgentArtifact;
          } catch {
            // Optional harvest — missing paths are fine.
            return undefined;
          }
        }));
        for (const artifact of harvested) {
          if (!artifact) continue;
          const key = `${artifact.type}:${artifact.path}`;
          if (artifactKeys.has(key)) continue;
          artifactKeys.add(key);
          artifacts.push(artifact);
        }
      }

      if (!content.trim() && artifacts.length) {
        content = `Finished with ${artifacts.length} artifact${artifacts.length === 1 ? "" : "s"}.`;
      }
      if (!content.trim()) {
        content = "The agent finished without a final answer. Try refining the instructions.";
      }

      await patchPartial(ctx, args.stepRunId, content, toolTrace);
      return {
        content,
        citations,
        artifacts,
        toolTrace,
        usage,
        useCompute: true,
        model: args.model,
        ...(subagents.length ? { subagents } : {}),
        ...(hasPlan ? { plan } : {}),
      };
    } finally {
      if (sandbox && daytona) {
        await daytona.delete(sandbox, 60, true).catch(() => undefined);
      }
      if (daytona) {
        await daytona[Symbol.asyncDispose]().catch(() => undefined);
      }
    }
  },
});
