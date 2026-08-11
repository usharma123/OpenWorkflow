import { WorkflowManager } from "@convex-dev/workflow";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import {
  agentUsesCompute,
  defaultComputeSystemPrompt,
  defaultMaxToolRounds,
  parsePlanSteps,
} from "../shared/agentTools";
import {
  inputPacketsForNode,
  inputValueForPackets,
  mergeExecutionValues,
  packetForNodeOutput,
  nodeIdsForRunScope,
  terminalOutput,
  topologicalNodes,
  type ExecutionPacket,
} from "../shared/executionGraph";
import { stepRetryPolicy } from "../shared/reliability";
import { clampSearchResultCount } from "../shared/webSearch";
import { applyOpenRouterEvent, takeSseEvents, type OpenRouterStreamState } from "./openrouterStream";
import { applyApprovalDecision } from "./policies";
import { renderTemplate, valueAtPath } from "./template";

export const workflow = new WorkflowManager(components.workflow);

type NodeConfig = Record<string, unknown>;
type WorkflowNode = {
  id: string;
  parentId?: string;
  data: { label: string; nodeType: string; config: NodeConfig };
};
type WorkflowEdge = { source: string; target: string; sourceHandle?: string | null };

const connectorProviders: Record<string, string> = {
  gmailTrigger: "gmail",
  gmailSend: "gmail",
  googleDoc: "google-docs",
  calendarEvent: "google-calendar",
  sheetsAppend: "google-sheets",
  driveUpload: "google-drive",
  slack: "slack",
};

const connectorNodeTypes = new Set([
  "gmailTrigger", "googleDoc", "gmailSend", "calendarEvent", "sheetsAppend", "driveUpload", "slack",
]);

/* Live writes to external systems are never retried automatically: a retry could send twice. */
const nonIdempotentWriteNodeTypes = new Set([
  "googleDoc", "slack", "gmailSend", "calendarEvent", "sheetsAppend", "driveUpload",
]);

const daytonaNodeTypes = new Set(["code", "shell", "git"]);

function runRecordValue(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.messages)) return value;
  return {
    ...record,
    messages: record.messages.map((message) => {
      if (!message || typeof message !== "object") return message;
      const { snippet: _snippet, body: _body, ...metadata } = message as Record<string, unknown>;
      return metadata;
    }),
    contentRedacted: true,
  };
}

function executionErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Workflow execution failed.";
  const message = error.message;
  if (message.includes("OPENROUTER_API_KEY is not configured")) {
    return "AI execution is not configured. Ask an administrator to add OPENROUTER_API_KEY in Convex, then retry the run.";
  }
  if (message.includes("DAYTONA_API_KEY is not configured")) {
    return "Daytona execution is not configured. Ask an administrator to add DAYTONA_API_KEY in Convex, then retry the run.";
  }
  return message.match(/Uncaught Error:\s*([^\n]+)/)?.[1] ?? message;
}

function isPrivateHost(hostname: string) {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.endsWith(".local") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

export const loadRun = internalQuery({
  args: { runId: v.id("workflowRuns") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run) throw new Error("Run not found.");
    const workflowDefinition = await ctx.db.get(run.workflowId);
    if (!workflowDefinition) throw new Error("Workflow not found.");
    const version = run.workflowVersionId ? await ctx.db.get(run.workflowVersionId) : null;
    const definition = version ?? workflowDefinition;
    if (!run.ownerKey || !run.ownerUserId || run.ownerKey !== definition.ownerKey) {
      throw new Error("Run ownership is invalid.");
    }
    return { run, definition };
  },
});

export const startStep = internalMutation({
  args: {
    runId: v.id("workflowRuns"),
    nodeId: v.string(),
    nodeLabel: v.string(),
    nodeType: v.string(),
    connectionRef: v.optional(v.string()),
    sandboxBoundaryId: v.optional(v.string()),
    input: v.any(),
    waiting: v.boolean(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run?.ownerKey) throw new Error("Run ownership is invalid.");
    await ctx.db.patch(args.runId, { status: args.waiting ? "waiting" : "running" });
    const stepRunId = await ctx.db.insert("stepRuns", {
      ownerKey: run.ownerKey,
      runId: args.runId,
      nodeId: args.nodeId,
      nodeLabel: args.nodeLabel,
      nodeType: args.nodeType,
      connectionRef: args.connectionRef,
      sandboxBoundaryId: args.sandboxBoundaryId,
      input: runRecordValue(args.input),
      status: args.waiting ? "waiting" : "running",
      startedAt: Date.now(),
    });
    const provider = connectorProviders[args.nodeType];
    if (provider) {
      await ctx.db.insert("auditLogs", { ownerKey: run.ownerKey, actorUserId: run.ownerUserId, runId: args.runId, stepRunId, event: "connector.use", provider, connectionRef: args.connectionRef, outcome: "started", actor: "workflow-engine", createdAt: Date.now() });
      if (args.connectionRef) {
        const connection = await ctx.db.query("connections").withIndex("by_owner_external_id", (q) => q.eq("ownerKey", run.ownerKey!).eq("externalId", args.connectionRef!)).unique();
        if (connection) await ctx.db.patch(connection._id, { lastUsedAt: Date.now() });
      }
    }
    return stepRunId;
  },
});

export const attachSandbox = internalMutation({
  args: { stepRunId: v.id("stepRuns"), sandboxId: v.string() },
  handler: async (ctx, { stepRunId, sandboxId }) => {
    const stepRun = await ctx.db.get(stepRunId);
    if (!stepRun) throw new Error("Workflow step not found.");
    await ctx.db.patch(stepRunId, { sandboxId });
  },
});

export const finishStep = internalMutation({
  args: { stepRunId: v.id("stepRuns"), output: v.any() },
  handler: async (ctx, { stepRunId, output }) => {
    const stepRun = await ctx.db.get(stepRunId);
    await ctx.db.patch(stepRunId, { status: "completed", output: runRecordValue(output), completedAt: Date.now() });
    if (stepRun && connectorProviders[stepRun.nodeType]) await ctx.db.insert("auditLogs", { ownerKey: stepRun.ownerKey, runId: stepRun.runId, stepRunId, event: "connector.use", provider: connectorProviders[stepRun.nodeType], connectionRef: stepRun.connectionRef, outcome: "succeeded", actor: "workflow-engine", createdAt: Date.now() });
  },
});

const planStepStatusValidator = v.union(
  v.literal("pending"),
  v.literal("active"),
  v.literal("done"),
  v.literal("skipped"),
);

/** Record the proposed plan and pause the step (and run) for user review. */
export const proposeStepPlan = internalMutation({
  args: { stepRunId: v.id("stepRuns"), steps: v.array(v.string()) },
  handler: async (ctx, { stepRunId, steps }) => {
    const stepRun = await ctx.db.get(stepRunId);
    if (!stepRun) throw new Error("Workflow step not found.");
    await ctx.db.patch(stepRunId, {
      status: "waiting",
      plan: {
        steps: steps.map((title) => ({ title, status: "pending" as const })),
        status: "proposed" as const,
      },
    });
    await ctx.db.patch(stepRun.runId, { status: "waiting" });
  },
});

/** Apply the user's plan decision: resume with (possibly edited) steps, or record the rejection. */
export const applyPlanDecision = internalMutation({
  args: {
    stepRunId: v.id("stepRuns"),
    approved: v.boolean(),
    steps: v.optional(v.array(v.string())),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { stepRunId, approved, steps, note }) => {
    const stepRun = await ctx.db.get(stepRunId);
    if (!stepRun) throw new Error("Workflow step not found.");
    if (!approved) {
      await ctx.db.patch(stepRunId, {
        plan: {
          steps: stepRun.plan?.steps ?? [],
          status: "rejected" as const,
          ...(note ? { note } : {}),
        },
      });
      return;
    }
    const edited = (steps ?? []).flatMap((title) => {
      const trimmed = title.trim();
      return trimmed ? [trimmed] : [];
    });
    const finalTitles = edited.length
      ? parsePlanSteps(edited)
      : (stepRun.plan?.steps ?? []).map((planStep) => planStep.title);
    await ctx.db.patch(stepRunId, {
      status: "running",
      plan: {
        steps: finalTitles.map((title) => ({ title, status: "pending" as const })),
        status: "approved" as const,
        ...(note ? { note } : {}),
      },
    });
    await ctx.db.patch(stepRun.runId, { status: "running" });
  },
});

/** Live checklist updates from the executing agent's mark_plan_step tool. */
export const updateStepPlanProgress = internalMutation({
  args: {
    stepRunId: v.id("stepRuns"),
    stepIndex: v.number(),
    status: planStepStatusValidator,
  },
  handler: async (ctx, { stepRunId, stepIndex, status }) => {
    const stepRun = await ctx.db.get(stepRunId);
    if (!stepRun?.plan || stepRun.status !== "running") return;
    const steps = [...stepRun.plan.steps];
    if (stepIndex < 0 || stepIndex >= steps.length) return;
    steps[stepIndex] = { ...steps[stepIndex], status };
    await ctx.db.patch(stepRunId, { plan: { ...stepRun.plan, steps } });
  },
});

export const updateStepPartialOutput = internalMutation({
  args: { stepRunId: v.id("stepRuns"), partialOutput: v.string() },
  handler: async (ctx, { stepRunId, partialOutput }) => {
    const stepRun = await ctx.db.get(stepRunId);
    if (!stepRun || stepRun.status !== "running") return;
    await ctx.db.patch(stepRunId, { partialOutput });
  },
});

export const failStep = internalMutation({
  args: { stepRunId: v.id("stepRuns"), error: v.string() },
  handler: async (ctx, { stepRunId, error }) => {
    const stepRun = await ctx.db.get(stepRunId);
    await ctx.db.patch(stepRunId, { status: "failed", error, completedAt: Date.now() });
    if (stepRun && connectorProviders[stepRun.nodeType]) await ctx.db.insert("auditLogs", { ownerKey: stepRun.ownerKey, runId: stepRun.runId, stepRunId, event: "connector.use", provider: connectorProviders[stepRun.nodeType], connectionRef: stepRun.connectionRef, outcome: "failed", actor: "workflow-engine", detail: error.slice(0, 300), createdAt: Date.now() });
  },
});

export const skipStep = internalMutation({
  args: { runId: v.id("workflowRuns"), node: v.any() },
  handler: async (ctx, { runId, node }) => {
    const run = await ctx.db.get(runId);
    if (!run?.ownerKey) throw new Error("Run ownership is invalid.");
    return ctx.db.insert("stepRuns", {
      ownerKey: run.ownerKey,
      runId,
      nodeId: String(node.id),
      nodeLabel: String(node.data.label),
      nodeType: String(node.data.nodeType),
      status: "skipped",
      startedAt: Date.now(),
      completedAt: Date.now(),
    });
  },
});

export const completeRun = internalMutation({
  args: { runId: v.id("workflowRuns"), output: v.any() },
  handler: async (ctx, { runId, output }) =>
    ctx.db.patch(runId, { status: "completed", output: runRecordValue(output), completedAt: Date.now() }),
});

export const failRun = internalMutation({
  args: { runId: v.id("workflowRuns"), error: v.string() },
  handler: async (ctx, { runId, error }) =>
    ctx.db.patch(runId, { status: "failed", error, completedAt: Date.now() }),
});

export const executeNode = internalAction({
  args: {
    node: v.any(),
    input: v.any(),
    stepOutputs: v.any(),
    ownerKey: v.string(),
    ownerUserId: v.string(),
    stepRunId: v.optional(v.id("stepRuns")),
  },
  handler: async (ctx, { node, input, stepOutputs, ownerKey, ownerUserId, stepRunId }): Promise<unknown> => {
    const typedNode = node as WorkflowNode;
    const { nodeType, config } = typedNode.data;

    if (connectorNodeTypes.has(nodeType)) {
      return ctx.runAction(internal.connectorExecution.executeLiveConnector, {
        node,
        input,
        stepOutputs,
        ownerKey,
        ownerUserId,
      });
    }

    if (nodeType.endsWith("Trigger") || nodeType === "output") return input;

    if (nodeType === "transform") {
      return { value: renderTemplate(String(config.template ?? "{{input}}"), input, stepOutputs) };
    }

    if (nodeType === "forEach") {
      const path = String(config.path ?? "items");
      const selected = path ? valueAtPath(input, path) : input;
      if (!Array.isArray(selected)) throw new Error(`For each item expected an array at ${path || "the input"}.`);
      const items = selected.map((item) => renderTemplate(String(config.template ?? "{{input}}"), item, stepOutputs));
      return { items, count: items.length };
    }

    if (nodeType === "merge") {
      const mode = String(config.mode ?? "append");
      if (!["append", "combine", "first"].includes(mode)) throw new Error("Merge mode is invalid.");
      return mergeExecutionValues(input, mode as "append" | "combine" | "first");
    }

    if (nodeType === "condition") {
      const actual = valueAtPath(input, String(config.path ?? ""));
      const expected = config.value;
      const operator = String(config.operator ?? "equals");
      const passed =
        operator === "exists"
          ? actual !== undefined && actual !== null
          : operator === "contains"
            ? String(actual ?? "").includes(String(expected ?? ""))
            : operator === "greaterThan"
              ? Number(actual) > Number(expected)
              : String(actual ?? "") === String(expected ?? "");
      return { passed, value: actual };
    }

    if (nodeType === "webSearch") {
      const query = renderTemplate(String(config.query ?? ""), input, stepOutputs).trim();
      if (!query) throw new Error("Add a search query before running this step.");
      return ctx.runAction(internal.searchExecution.search, {
        query,
        numResults: clampSearchResultCount(config.numResults),
        includeText: config.includeText !== false,
      });
    }

    if (nodeType === "http") {
      const url = new URL(renderTemplate(String(config.url ?? ""), input, stepOutputs));
      if (url.protocol !== "https:" || isPrivateHost(url.hostname)) {
        throw new Error("HTTP blocks only allow public HTTPS destinations.");
      }
      const method = String(config.method ?? "GET").toUpperCase();
      const headerText = renderTemplate(String(config.headers ?? "{}"), input, stepOutputs);
      const headers = JSON.parse(headerText) as Record<string, string>;
      const bodyText = renderTemplate(String(config.body ?? ""), input, stepOutputs);
      const response = await fetch(url, {
        method,
        headers,
        body: method === "GET" || method === "HEAD" ? undefined : bodyText || undefined,
        redirect: "error",
        signal: AbortSignal.timeout(Math.min(900, Math.max(1, Number(config.timeoutSeconds ?? 30))) * 1000),
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText.slice(0, 500)}`);
      }
      const responseText = await response.text();
      const contentType = response.headers.get("content-type") ?? "";
      return {
        status: response.status,
        data: contentType.includes("application/json") ? JSON.parse(responseText) : responseText,
      };
    }

    if (nodeType === "ai") {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured in Convex.");
      const userPrompt = renderTemplate(String(config.prompt ?? "{{input}}"), input, stepOutputs);

      if (agentUsesCompute(config)) {
        if (!stepRunId) throw new Error("Agent steps require a step run id.");
        const result = await ctx.runAction(internal.agentExecution.runAgent, {
          model: String(config.model ?? "openai/gpt-5.6-luna"),
          systemPrompt: String(config.systemPrompt ?? "").trim() || defaultComputeSystemPrompt(),
          userPrompt,
          input,
          maxToolRounds: Math.min(
            20,
            Math.max(1, Math.trunc(Number(config.maxToolRounds ?? defaultMaxToolRounds()))),
          ),
          timeoutSeconds: Math.min(900, Math.max(30, Math.trunc(Number(config.timeoutSeconds ?? 300)))),
          stepRunId,
        });
        return {
          ...(input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {}),
          ...result,
        };
      }

      // Lightweight completion without sandbox compute (optional OpenRouter web search).
      const tools = config.webSearch
        ? [{
            type: "openrouter:web_search",
            parameters: {
              max_results: Math.min(10, Math.max(1, Number(config.maxSearchResults ?? 5))),
              max_total_results: 15,
              search_context_size: "medium",
            },
          }]
        : undefined;
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(process.env.OPENROUTER_SITE_URL ? { "HTTP-Referer": process.env.OPENROUTER_SITE_URL } : {}),
          "X-OpenRouter-Title": process.env.OPENROUTER_APP_NAME ?? "OpenWorkflow",
        },
        body: JSON.stringify({
          model: String(config.model ?? "openai/gpt-5.6-luna"),
          messages: [
            { role: "system", content: String(config.systemPrompt ?? "You are a helpful assistant.") },
            { role: "user", content: userPrompt },
          ],
          tools,
          stream: true,
          stream_options: { include_usage: true },
        }),
        signal: AbortSignal.timeout(Math.min(900, Math.max(1, Number(config.timeoutSeconds ?? 120))) * 1000),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(payload.error?.message ?? `OpenRouter request failed (${response.status}).`);
      }
      if (!response.body) throw new Error("OpenRouter returned an empty streaming response.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamState: OpenRouterStreamState = { content: "", annotations: [] };
      let lastPatchAt = 0;
      let lastPatchedContent = "";

      const patchPartialOutput = async (force = false) => {
        if (!stepRunId || !streamState.content || streamState.content === lastPatchedContent) return;
        const now = Date.now();
        if (!force && now - lastPatchAt < 200) return;
        await ctx.runMutation(internal.executor.updateStepPartialOutput, {
          stepRunId,
          partialOutput: streamState.content,
        });
        lastPatchAt = Date.now();
        lastPatchedContent = streamState.content;
      };

      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const parsed = takeSseEvents(buffer);
        buffer = parsed.rest;
        for (const event of parsed.events) streamState = applyOpenRouterEvent(streamState, event);
        await patchPartialOutput();
        if (done) break;
      }
      if (buffer.trim()) streamState = applyOpenRouterEvent(streamState, buffer);
      await patchPartialOutput(true);

      return {
        ...(input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {}),
        content: streamState.content,
        citations: streamState.annotations,
        usage: streamState.usage,
      };
    }

    throw new Error(`Unsupported workflow block: ${nodeType}`);
  },
});

export const executeWorkflow = workflow
  .define({ args: { runId: v.id("workflowRuns") }, returns: v.any() })
  .handler(async (step, { runId }): Promise<unknown> => {
    let activeStepRunId: import("./_generated/dataModel").Id<"stepRuns"> | undefined;
    const sandboxIdsByBoundary = new Map<string, string>();
    try {
      const { run, definition } = await step.runQuery(internal.executor.loadRun, { runId });
      if (!run.ownerKey || !run.ownerUserId) throw new Error("Run ownership is invalid.");
      const allNodes = definition.nodes as WorkflowNode[];
      const nodes = allNodes.filter((node) => node.data.nodeType !== "daytonaSandbox");
      const edges = definition.edges as WorkflowEdge[];
      const activeNodeIds = nodeIdsForRunScope(nodes, edges, run.runMode ?? "full", run.scopeNodeId);
      const ordered = topologicalNodes(nodes, edges).filter((node) => activeNodeIds.has(node.id));
      const nodesById = new Map(nodes.map((node) => [node.id, node]));
      const outputs = new Map<string, ExecutionPacket>();

      if (run.seedOutputs && typeof run.seedOutputs === "object" && !Array.isArray(run.seedOutputs)) {
        for (const [nodeId, output] of Object.entries(run.seedOutputs as Record<string, unknown>)) {
          const node = nodesById.get(nodeId);
          if (node && !activeNodeIds.has(nodeId)) outputs.set(nodeId, packetForNodeOutput(node, output));
        }
      }

      if ((run.runMode ?? "full") !== "full") {
        for (const node of nodes) {
          if (activeNodeIds.has(node.id)) continue;
          if (!outputs.has(node.id) && Object.prototype.hasOwnProperty.call(node.data.config, "pinnedOutput")) {
            outputs.set(node.id, packetForNodeOutput(node, node.data.config.pinnedOutput));
          }
        }
      }

      for (const node of ordered) {
        const { label, nodeType, config } = node.data;
        const incoming = inputPacketsForNode(node.id, edges, outputs);
        if (incoming.hasIncomingEdges && incoming.packets.length === 0) {
          if (run.runMode === "single") {
            throw new Error(`Pin output on an upstream step before testing ${label} by itself.`);
          }
          await step.runMutation(internal.executor.skipStep, { runId, node });
          continue;
        }
        const value = inputValueForPackets(incoming.packets, run.input);

        const isApproval = nodeType === "approval";
        const stepRunId = await step.runMutation(internal.executor.startStep, {
          runId,
          nodeId: node.id,
          nodeLabel: label,
          nodeType,
          connectionRef: typeof config.connectionRef === "string" ? config.connectionRef : undefined,
          sandboxBoundaryId: node.parentId,
          input: value,
          waiting: isApproval,
        });
        activeStepRunId = stepRunId;

        try {
          if (nodeType === "delay") {
            const milliseconds = Math.max(1, Number(config.seconds ?? 60)) * 1000;
            await step.sleep(milliseconds, { name: `Delay: ${label}` });
          } else if (isApproval) {
            const approval = await step.awaitEvent({
              name: `approval:${node.id}`,
              validator: v.object({ approved: v.boolean(), note: v.optional(v.string()) }),
            });
            const output = applyApprovalDecision(value, approval, Date.now());
            outputs.set(node.id, packetForNodeOutput(node, output));
          } else if (daytonaNodeTypes.has(nodeType)) {
            if (!node.parentId) throw new Error(`${label} must be inside a Daytona sandbox boundary.`);
            const boundary = allNodes.find((candidate) =>
              candidate.id === node.parentId && candidate.data.nodeType === "daytonaSandbox");
            if (!boundary) throw new Error(`The Daytona sandbox boundary for ${label} is missing.`);
            const result = await step.runAction(internal.daytonaExecution.execute, {
              node,
              input: value,
              boundaryId: boundary.id,
              boundaryConfig: boundary.data.config,
              existingSandboxId: sandboxIdsByBoundary.get(boundary.id),
              stepRunId,
            });
            sandboxIdsByBoundary.set(boundary.id, result.sandboxId);
            outputs.set(node.id, packetForNodeOutput(node, result.output));
          } else if (nodeType === "ai" && agentUsesCompute(config) && config.planFirst === true) {
            // Plan-first agent: Luna proposes a plan, the run pauses for review,
            // then the approved (possibly edited) plan is executed.
            const stepOutputs = Object.fromEntries(
              [...outputs.entries()].map(([nodeId, packet]) => [nodeId, packet.value]),
            );
            const model = String(config.model ?? "openai/gpt-5.6-luna");
            const systemPrompt = String(config.systemPrompt ?? "").trim() || defaultComputeSystemPrompt();
            const userPrompt = renderTemplate(String(config.prompt ?? "{{input}}"), value, stepOutputs);
            const proposedSteps: string[] = await step.runAction(internal.agentExecution.generatePlan, {
              model,
              systemPrompt,
              userPrompt,
              stepRunId,
            });
            await step.runMutation(internal.executor.proposeStepPlan, { stepRunId, steps: proposedSteps });
            const decision = await step.awaitEvent({
              name: `plan:${node.id}`,
              validator: v.object({
                approved: v.boolean(),
                steps: v.optional(v.array(v.string())),
                note: v.optional(v.string()),
              }),
            });
            await step.runMutation(internal.executor.applyPlanDecision, {
              stepRunId,
              approved: decision.approved,
              ...(decision.steps ? { steps: decision.steps } : {}),
              ...(decision.note ? { note: decision.note } : {}),
            });
            if (!decision.approved) {
              throw new Error(decision.note?.trim() || "The research plan was rejected.");
            }
            const edited = (decision.steps ?? []).flatMap((title) => {
              const trimmed = title.trim();
              return trimmed ? [trimmed] : [];
            });
            const approvedSteps = edited.length ? parsePlanSteps(edited) : proposedSteps;
            const result = await step.runAction(internal.agentExecution.runAgent, {
              model,
              systemPrompt,
              userPrompt,
              input: value,
              maxToolRounds: Math.min(
                20,
                Math.max(1, Math.trunc(Number(config.maxToolRounds ?? defaultMaxToolRounds()))),
              ),
              timeoutSeconds: Math.min(900, Math.max(30, Math.trunc(Number(config.timeoutSeconds ?? 300)))),
              stepRunId,
              plan: approvedSteps,
            });
            const output = {
              ...(value && typeof value === "object" && !Array.isArray(value)
                ? (value as Record<string, unknown>)
                : {}),
              ...(result as Record<string, unknown>),
            };
            outputs.set(node.id, packetForNodeOutput(node, output));
          } else {
            const stepOutputs = Object.fromEntries(
              [...outputs.entries()].map(([nodeId, packet]) => [nodeId, packet.value]),
            );
            const isNonIdempotentLiveWrite = nonIdempotentWriteNodeTypes.has(nodeType);
            const { retryAttempts, retryBackoffMs } = stepRetryPolicy(config);
            const output = await step.runAction(
              internal.executor.executeNode,
              { node, input: value, stepOutputs, ownerKey: run.ownerKey, ownerUserId: run.ownerUserId, stepRunId },
              isNonIdempotentLiveWrite || retryAttempts === 0
                ? undefined
                : { retry: { maxAttempts: retryAttempts + 1, initialBackoffMs: retryBackoffMs, base: 2 } },
            );
            outputs.set(node.id, packetForNodeOutput(node, output));
          }

          if (nodeType === "delay") outputs.set(node.id, packetForNodeOutput(node, value));
          const packet = outputs.get(node.id);
          if (!packet) throw new Error(`${label} did not produce an output.`);
          await step.runMutation(internal.executor.finishStep, { stepRunId, output: packet.value });
          activeStepRunId = undefined;
        } catch (error) {
          const message = executionErrorMessage(error);
          const hasErrorBranch = edges.some((edge) => edge.source === node.id && edge.sourceHandle === "error");
          if (!hasErrorBranch || config.errorOutput !== true) throw error;
          await step.runMutation(internal.executor.failStep, { stepRunId, error: message });
          outputs.set(node.id, packetForNodeOutput(node, {
            error: message,
            failedNodeId: node.id,
            failedNodeLabel: label,
          }, "error"));
          activeStepRunId = undefined;
        }
      }

      const scopedNodes = nodes.filter((node) => activeNodeIds.has(node.id));
      const scopedEdges = edges.filter((edge) => activeNodeIds.has(edge.source) && activeNodeIds.has(edge.target));
      const output = terminalOutput(scopedNodes, scopedEdges, outputs);
      if (sandboxIdsByBoundary.size) {
        try {
          await step.runAction(internal.daytonaExecution.cleanup, {
            sandboxIds: [...sandboxIdsByBoundary.values()],
          });
        } catch {
          // Every sandbox is also ephemeral and TTL-bound; cleanup is best effort.
        }
      }
      await step.runMutation(internal.executor.completeRun, { runId, output });
      return output;
    } catch (error) {
      const message = executionErrorMessage(error);
      if (activeStepRunId) {
        await step.runMutation(internal.executor.failStep, { stepRunId: activeStepRunId, error: message });
      }
      if (sandboxIdsByBoundary.size) {
        try {
          await step.runAction(internal.daytonaExecution.cleanup, {
            sandboxIds: [...sandboxIdsByBoundary.values()],
          });
        } catch {
          // TTL-bound ephemeral sandboxes remain the final cleanup guard.
        }
      }
      await step.runMutation(internal.executor.failRun, { runId, error: message });
      return { error: message };
    }
  });
