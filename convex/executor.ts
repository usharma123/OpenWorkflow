import { WorkflowManager } from "@convex-dev/workflow";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { applyOpenRouterEvent, takeSseEvents, type OpenRouterStreamState } from "./openrouterStream";
import { applyApprovalDecision } from "./policies";
import { renderTemplate, valueAtPath } from "./template";

export const workflow = new WorkflowManager(components.workflow);

type NodeConfig = Record<string, unknown>;
type WorkflowNode = {
  id: string;
  data: { label: string; nodeType: string; config: NodeConfig };
};
type WorkflowEdge = { source: string; target: string; sourceHandle?: string | null };

const connectorProviders: Record<string, string> = {
  gmailTrigger: "gmail",
  googleDoc: "google-docs",
  slack: "slack",
};

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
  return message.match(/Uncaught Error:\s*([^\n]+)/)?.[1] ?? message;
}

function topologicalSort(nodes: WorkflowNode[], edges: WorkflowEdge[]) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  }
  const queue = nodes.filter((node) => indegree.get(node.id) === 0);
  const ordered: WorkflowNode[] = [];
  while (queue.length) {
    const node = queue.shift()!;
    ordered.push(node);
    for (const target of outgoing.get(node.id) ?? []) {
      const count = (indegree.get(target) ?? 1) - 1;
      indegree.set(target, count);
      if (count === 0) {
        const next = nodesById.get(target);
        if (next) queue.push(next);
      }
    }
  }
  if (ordered.length !== nodes.length) throw new Error("Workflow graphs cannot contain cycles.");
  return ordered;
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
    const definition = await ctx.db.get(run.workflowId);
    if (!definition) throw new Error("Workflow not found.");
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

export const finishStep = internalMutation({
  args: { stepRunId: v.id("stepRuns"), output: v.any() },
  handler: async (ctx, { stepRunId, output }) => {
    const stepRun = await ctx.db.get(stepRunId);
    await ctx.db.patch(stepRunId, { status: "completed", output: runRecordValue(output), completedAt: Date.now() });
    if (stepRun && connectorProviders[stepRun.nodeType]) await ctx.db.insert("auditLogs", { ownerKey: stepRun.ownerKey, runId: stepRun.runId, stepRunId, event: "connector.use", provider: connectorProviders[stepRun.nodeType], connectionRef: stepRun.connectionRef, outcome: "succeeded", actor: "workflow-engine", createdAt: Date.now() });
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
    ownerKey: v.string(),
    ownerUserId: v.string(),
    stepRunId: v.optional(v.id("stepRuns")),
  },
  handler: async (ctx, { node, input, ownerKey, ownerUserId, stepRunId }): Promise<unknown> => {
    const typedNode = node as WorkflowNode;
    const { nodeType, config } = typedNode.data;

    const executionMode = String(config.executionMode ?? "demo");
    const connectionRef = String(config.connectionRef ?? "");

    if (executionMode === "live" && ["gmailTrigger", "googleDoc", "slack"].includes(nodeType)) {
      return ctx.runAction(internal.connectorExecution.executeLiveConnector, {
        node,
        input,
        ownerKey,
        ownerUserId,
      });
    }

    if (nodeType === "gmailTrigger") {
      if (executionMode === "demo") {
        return {
          messages: [
            { from: "Maya Chen · Finance", subject: "Q3 forecast needs sign-off", snippet: "Please approve the revised hiring assumptions before Thursday." },
            { from: "Jordan Lee · Product", subject: "Launch readiness update", snippet: "The beta is on track; legal review is the only remaining dependency." },
            { from: "Sam Rivera · Customer Success", subject: "Acme renewal risk", snippet: "Acme asked for an executive sponsor before next week's renewal call." },
          ],
          count: 3,
          date: new Date().toLocaleDateString("en-US"),
          source: "sample",
        };
      }
      throw new Error("Connected Gmail must use a user-owned Google connection.");
    }

    if (nodeType.endsWith("Trigger") || nodeType === "output") return input;

    if (nodeType === "transform") {
      return { value: renderTemplate(String(config.template ?? "{{input}}"), input) };
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

    if (nodeType === "http") {
      const url = new URL(renderTemplate(String(config.url ?? ""), input));
      if (url.protocol !== "https:" || isPrivateHost(url.hostname)) {
        throw new Error("HTTP blocks only allow public HTTPS destinations.");
      }
      const method = String(config.method ?? "GET").toUpperCase();
      const headerText = renderTemplate(String(config.headers ?? "{}"), input);
      const headers = JSON.parse(headerText) as Record<string, string>;
      const bodyText = renderTemplate(String(config.body ?? ""), input);
      const response = await fetch(url, {
        method,
        headers,
        body: method === "GET" || method === "HEAD" ? undefined : bodyText || undefined,
        redirect: "error",
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
            { role: "user", content: renderTemplate(String(config.prompt ?? "{{input}}"), input) },
          ],
          tools,
          stream: true,
          stream_options: { include_usage: true },
        }),
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

    if (nodeType === "googleDoc") {
      const content = typeof input === "object" && input && typeof (input as Record<string, unknown>).content === "string" ? String((input as Record<string, unknown>).content) : JSON.stringify(input, null, 2);
      const title = renderTemplate(String(config.title ?? "OpenWorkflow brief"), input);
      if (executionMode === "demo") return { ...(input && typeof input === "object" ? input as Record<string, unknown> : {}), documentTitle: title, documentUrl: "https://docs.google.com/document/d/demo-openworkflow-inbox-brief/edit", documentMode: "demo" };
      throw new Error("Connected Google Docs must use a user-owned Google connection.");
    }

    if (nodeType === "slack") {
      const configuredChannel = String(config.channel ?? "#leadership-updates");
      const channel = configuredChannel;
      const message = renderTemplate(String(config.message ?? "{{input.documentUrl}}"), input);
      if (executionMode === "demo") return { ...(input && typeof input === "object" ? input as Record<string, unknown> : {}), delivery: { provider: "slack", channel, message, status: "simulated" } };
      throw new Error("Connected Slack must use a user-owned workspace connection.");
    }

    throw new Error(`Unsupported workflow block: ${nodeType}`);
  },
});

export const executeWorkflow = workflow
  .define({ args: { runId: v.id("workflowRuns") }, returns: v.any() })
  .handler(async (step, { runId }): Promise<unknown> => {
    let activeStepRunId: import("./_generated/dataModel").Id<"stepRuns"> | undefined;
    try {
      const { run, definition } = await step.runQuery(internal.executor.loadRun, { runId });
      if (!run.ownerKey || !run.ownerUserId) throw new Error("Run ownership is invalid.");
      const nodes = definition.nodes as WorkflowNode[];
      const edges = definition.edges as WorkflowEdge[];
      const ordered = topologicalSort(nodes, edges);
      const incomingByTarget = new Map<string, WorkflowEdge[]>();
      for (const edge of edges) {
        const incoming = incomingByTarget.get(edge.target);
        if (incoming) incoming.push(edge);
        else incomingByTarget.set(edge.target, [edge]);
      }
      const decisions = new Map<string, boolean>();
      let value: unknown = run.input;

      for (const node of ordered) {
        const { label, nodeType, config } = node.data;
        const incoming = incomingByTarget.get(node.id) ?? [];
        const blocked = incoming.some((edge) => {
          const decision = decisions.get(edge.source);
          return decision !== undefined && edge.sourceHandle && edge.sourceHandle !== String(decision);
        });
        if (blocked) {
          await step.runMutation(internal.executor.skipStep, { runId, node });
          continue;
        }

        const isApproval = nodeType === "approval";
        const stepRunId = await step.runMutation(internal.executor.startStep, {
          runId,
          nodeId: node.id,
          nodeLabel: label,
          nodeType,
          connectionRef: typeof config.connectionRef === "string" ? config.connectionRef : undefined,
          input: value,
          waiting: isApproval,
        });
        activeStepRunId = stepRunId;

        if (nodeType === "delay") {
          const milliseconds = Math.max(1, Number(config.seconds ?? 60)) * 1000;
          await step.sleep(milliseconds, { name: `Delay: ${label}` });
        } else if (isApproval) {
          const approval = await step.awaitEvent({
            name: `approval:${node.id}`,
            validator: v.object({ approved: v.boolean(), note: v.optional(v.string()) }),
          });
          value = applyApprovalDecision(value, approval, Date.now());
        } else {
          const isNonIdempotentLiveWrite =
            String(config.executionMode ?? "demo") === "live" &&
            (nodeType === "googleDoc" || nodeType === "slack");
          value = await step.runAction(
            internal.executor.executeNode,
            { node, input: value, ownerKey: run.ownerKey, ownerUserId: run.ownerUserId, stepRunId },
            isNonIdempotentLiveWrite
              ? undefined
              : { retry: { maxAttempts: 3, initialBackoffMs: 250, base: 2 } },
          );
        }

        if (nodeType === "condition") {
          decisions.set(node.id, Boolean((value as { passed?: boolean })?.passed));
        }
        await step.runMutation(internal.executor.finishStep, { stepRunId, output: value });
        activeStepRunId = undefined;
      }

      await step.runMutation(internal.executor.completeRun, { runId, output: value });
      return value;
    } catch (error) {
      const message = executionErrorMessage(error);
      if (activeStepRunId) {
        await step.runMutation(internal.executor.failStep, { stepRunId: activeStepRunId, error: message });
      }
      await step.runMutation(internal.executor.failRun, { runId, error: message });
      return { error: message };
    }
  });
