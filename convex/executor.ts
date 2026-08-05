import { WorkflowManager } from "@convex-dev/workflow";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";

export const workflow = new WorkflowManager(components.workflow);

type NodeConfig = Record<string, unknown>;
type WorkflowNode = {
  id: string;
  data: { label: string; nodeType: string; config: NodeConfig };
};
type WorkflowEdge = { source: string; target: string; sourceHandle?: string | null };

function topologicalSort(nodes: WorkflowNode[], edges: WorkflowEdge[]) {
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
        const next = nodes.find((candidate) => candidate.id === target);
        if (next) queue.push(next);
      }
    }
  }
  if (ordered.length !== nodes.length) throw new Error("Workflow graphs cannot contain cycles.");
  return ordered;
}

function valueAtPath(value: unknown, path: string): unknown {
  if (!path) return value;
  return path.split(".").reduce<unknown>((current, key) => {
    if (current && typeof current === "object") return (current as Record<string, unknown>)[key];
    return undefined;
  }, value);
}

function renderTemplate(template: string, input: unknown): string {
  return template.replace(/\{\{\s*input(?:\.([\w.]+))?\s*\}\}/g, (_, path?: string) => {
    const value = valueAtPath(input, path ?? "");
    return typeof value === "string" ? value : JSON.stringify(value ?? "");
  });
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
    return { run, definition };
  },
});

export const startStep = internalMutation({
  args: {
    runId: v.id("workflowRuns"),
    nodeId: v.string(),
    nodeLabel: v.string(),
    nodeType: v.string(),
    input: v.any(),
    waiting: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.runId, { status: args.waiting ? "waiting" : "running" });
    return ctx.db.insert("stepRuns", {
      runId: args.runId,
      nodeId: args.nodeId,
      nodeLabel: args.nodeLabel,
      nodeType: args.nodeType,
      input: args.input,
      status: args.waiting ? "waiting" : "running",
      startedAt: Date.now(),
    });
  },
});

export const finishStep = internalMutation({
  args: { stepRunId: v.id("stepRuns"), output: v.any() },
  handler: async (ctx, { stepRunId, output }) =>
    ctx.db.patch(stepRunId, { status: "completed", output, completedAt: Date.now() }),
});

export const failStep = internalMutation({
  args: { stepRunId: v.id("stepRuns"), error: v.string() },
  handler: async (ctx, { stepRunId, error }) =>
    ctx.db.patch(stepRunId, { status: "failed", error, completedAt: Date.now() }),
});

export const skipStep = internalMutation({
  args: { runId: v.id("workflowRuns"), node: v.any() },
  handler: async (ctx, { runId, node }) =>
    ctx.db.insert("stepRuns", {
      runId,
      nodeId: String(node.id),
      nodeLabel: String(node.data.label),
      nodeType: String(node.data.nodeType),
      status: "skipped",
      startedAt: Date.now(),
      completedAt: Date.now(),
    }),
});

export const completeRun = internalMutation({
  args: { runId: v.id("workflowRuns"), output: v.any() },
  handler: async (ctx, { runId, output }) =>
    ctx.db.patch(runId, { status: "completed", output, completedAt: Date.now() }),
});

export const failRun = internalMutation({
  args: { runId: v.id("workflowRuns"), error: v.string() },
  handler: async (ctx, { runId, error }) =>
    ctx.db.patch(runId, { status: "failed", error, completedAt: Date.now() }),
});

export const executeNode = internalAction({
  args: { node: v.any(), input: v.any() },
  handler: async (_ctx, { node, input }): Promise<unknown> => {
    const typedNode = node as WorkflowNode;
    const { nodeType, config } = typedNode.data;

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
      const responseText = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${responseText.slice(0, 500)}`);
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
        }),
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
        choices?: Array<{ message?: { content?: string; annotations?: unknown[] } }>;
        usage?: unknown;
      };
      if (!response.ok) throw new Error(payload.error?.message ?? `OpenRouter request failed (${response.status}).`);
      const message = payload.choices?.[0]?.message;
      return { content: message?.content ?? "", citations: message?.annotations ?? [], usage: payload.usage };
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
      const nodes = definition.nodes as WorkflowNode[];
      const edges = definition.edges as WorkflowEdge[];
      const ordered = topologicalSort(nodes, edges);
      const decisions = new Map<string, boolean>();
      let value: unknown = run.input;

      for (const node of ordered) {
        const incoming = edges.filter((edge) => edge.target === node.id);
        const blocked = incoming.some((edge) => {
          const decision = decisions.get(edge.source);
          return decision !== undefined && edge.sourceHandle && edge.sourceHandle !== String(decision);
        });
        if (blocked) {
          await step.runMutation(internal.executor.skipStep, { runId, node });
          continue;
        }

        const isApproval = node.data.nodeType === "approval";
        const stepRunId = await step.runMutation(internal.executor.startStep, {
          runId,
          nodeId: node.id,
          nodeLabel: node.data.label,
          nodeType: node.data.nodeType,
          input: value,
          waiting: isApproval,
        });
        activeStepRunId = stepRunId;

        if (node.data.nodeType === "delay") {
          const milliseconds = Math.max(1, Number(node.data.config.seconds ?? 60)) * 1000;
          await step.sleep(milliseconds, { name: `Delay: ${node.data.label}` });
        } else if (isApproval) {
          const approval = await step.awaitEvent({
            name: `approval:${node.id}`,
            validator: v.object({ approved: v.boolean(), note: v.optional(v.string()) }),
          });
          if (!approval.approved) throw new Error(approval.note || "Workflow was rejected.");
          value = approval;
        } else {
          value = await step.runAction(
            internal.executor.executeNode,
            { node, input: value },
            { retry: { maxAttempts: 3, initialBackoffMs: 250, base: 2 } },
          );
        }

        if (node.data.nodeType === "condition") {
          decisions.set(node.id, Boolean((value as { passed?: boolean })?.passed));
        }
        await step.runMutation(internal.executor.finishStep, { stepRunId, output: value });
        activeStepRunId = undefined;
      }

      await step.runMutation(internal.executor.completeRun, { runId, output: value });
      return value;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Workflow execution failed.";
      if (activeStepRunId) {
        await step.runMutation(internal.executor.failStep, { stepRunId: activeStepRunId, error: message });
      }
      await step.runMutation(internal.executor.failRun, { runId, error: message });
      return { error: message };
    }
  });
