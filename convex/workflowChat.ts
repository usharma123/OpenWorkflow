import { v } from "convex/values";
import {
  askUserTool,
  buildChatSystemPrompt,
  parseBuildProposal,
  parseBuildQuestions,
  proposeWorkflowTool,
  type BuildQuestion,
} from "../shared/buildChat";
import { extractToolCalls } from "../shared/agentTools";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requirePrincipal } from "./auth";

const proposalValidator = v.object({
  name: v.optional(v.string()),
  description: v.optional(v.string()),
  nodes: v.array(v.any()),
  edges: v.array(v.any()),
});

const questionsValidator = v.array(
  v.object({
    id: v.string(),
    prompt: v.string(),
    allowMultiple: v.optional(v.boolean()),
    options: v.array(v.object({ id: v.string(), label: v.string() })),
  }),
);

const messageValidator = v.object({
  _id: v.id("buildChatMessages"),
  role: v.union(v.literal("user"), v.literal("assistant")),
  content: v.string(),
  status: v.union(v.literal("pending"), v.literal("completed"), v.literal("failed")),
  proposal: v.optional(proposalValidator),
  questions: v.optional(questionsValidator),
  appliedAt: v.optional(v.number()),
  createdAt: v.number(),
});

export const listMessages = query({
  args: { workflowExternalId: v.string() },
  returns: v.array(messageValidator),
  handler: async (ctx, { workflowExternalId }) => {
    const principal = await requirePrincipal(ctx);
    const messages = await ctx.db
      .query("buildChatMessages")
      .withIndex("by_owner_workflow", (q) =>
        q.eq("ownerKey", principal.ownerKey).eq("workflowExternalId", workflowExternalId),
      )
      .order("desc")
      .take(100);
    return messages.reverse().map((message) => ({
      _id: message._id,
      role: message.role,
      content: message.content,
      status: message.status,
      proposal: message.proposal,
      questions: message.questions,
      appliedAt: message.appliedAt,
      createdAt: message.createdAt,
    }));
  },
});

export const send = mutation({
  args: {
    workflowExternalId: v.string(),
    content: v.string(),
    graph: v.object({
      name: v.string(),
      description: v.string(),
      nodes: v.array(v.any()),
      edges: v.array(v.any()),
    }),
  },
  returns: v.id("buildChatMessages"),
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx);
    const content = args.content.trim().slice(0, 4_000);
    if (!content) throw new Error("Describe the workflow you want to build.");
    await ctx.db.insert("buildChatMessages", {
      ownerKey: principal.ownerKey,
      workflowExternalId: args.workflowExternalId,
      role: "user",
      content,
      status: "completed",
      createdAt: Date.now(),
    });
    const assistantMessageId = await ctx.db.insert("buildChatMessages", {
      ownerKey: principal.ownerKey,
      workflowExternalId: args.workflowExternalId,
      role: "assistant",
      content: "",
      status: "pending",
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.workflowChat.generate, {
      ownerKey: principal.ownerKey,
      workflowExternalId: args.workflowExternalId,
      assistantMessageId,
      graph: args.graph,
    });
    return assistantMessageId;
  },
});

export const markApplied = mutation({
  args: { messageId: v.id("buildChatMessages") },
  returns: v.null(),
  handler: async (ctx, { messageId }) => {
    const principal = await requirePrincipal(ctx);
    const message = await ctx.db.get(messageId);
    if (!message || message.ownerKey !== principal.ownerKey) {
      throw new Error("Chat message not found.");
    }
    if (!message.proposal) throw new Error("That message has no workflow proposal.");
    await ctx.db.patch(messageId, { appliedAt: Date.now() });
    return null;
  },
});

export const historyForGenerate = internalQuery({
  args: {
    ownerKey: v.string(),
    workflowExternalId: v.string(),
    assistantMessageId: v.id("buildChatMessages"),
  },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query("buildChatMessages")
      .withIndex("by_owner_workflow", (q) =>
        q.eq("ownerKey", args.ownerKey).eq("workflowExternalId", args.workflowExternalId),
      )
      .order("desc")
      .take(21);
    return messages
      .reverse()
      .filter((message) => message._id !== args.assistantMessageId && message.status !== "failed")
      .map((message) => ({
        role: message.role,
        content: message.proposal
          ? `${message.content}\n\n(Proposed workflow "${message.proposal.name ?? "Untitled"}" with ${message.proposal.nodes.length} steps.)`
          : message.questions?.length
            ? `${message.content}\n\n(Asked the user: ${message.questions.map((question) => question.prompt).join(" | ")})`
            : message.content,
      }));
  },
});

export const finishAssistantMessage = internalMutation({
  args: {
    messageId: v.id("buildChatMessages"),
    content: v.string(),
    status: v.union(v.literal("completed"), v.literal("failed")),
    proposal: v.optional(proposalValidator),
    questions: v.optional(questionsValidator),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message) return;
    await ctx.db.patch(args.messageId, {
      content: args.content,
      status: args.status,
      ...(args.proposal ? { proposal: args.proposal } : {}),
      ...(args.questions ? { questions: args.questions } : {}),
    });
  },
});

export const generate = internalAction({
  args: {
    ownerKey: v.string(),
    workflowExternalId: v.string(),
    assistantMessageId: v.id("buildChatMessages"),
    graph: v.object({
      name: v.string(),
      description: v.string(),
      nodes: v.array(v.any()),
      edges: v.array(v.any()),
    }),
  },
  handler: async (ctx, args) => {
    const finish = (
      content: string,
      status: "completed" | "failed",
      proposal?: {
        name?: string;
        description?: string;
        nodes: unknown[];
        edges: unknown[];
      },
      questions?: BuildQuestion[],
    ) =>
      ctx.runMutation(internal.workflowChat.finishAssistantMessage, {
        messageId: args.assistantMessageId as Id<"buildChatMessages">,
        content,
        status,
        ...(proposal ? { proposal } : {}),
        ...(questions ? { questions } : {}),
      });

    try {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured in Convex.");

      const history = await ctx.runQuery(internal.workflowChat.historyForGenerate, {
        ownerKey: args.ownerKey,
        workflowExternalId: args.workflowExternalId,
        assistantMessageId: args.assistantMessageId,
      });

      const canvasSummary = JSON.stringify({
        name: args.graph.name,
        description: args.graph.description,
        nodes: (args.graph.nodes as Array<Record<string, unknown>>).map((node) => {
          const data = (node.data ?? {}) as Record<string, unknown>;
          return {
            id: node.id,
            type: data.nodeType,
            label: data.label,
            config: data.config,
          };
        }),
        edges: (args.graph.edges as Array<Record<string, unknown>>).map((edge) => ({
          source: edge.source,
          target: edge.target,
          ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
        })),
      }).slice(0, 30_000);

      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(process.env.OPENROUTER_SITE_URL ? { "HTTP-Referer": process.env.OPENROUTER_SITE_URL } : {}),
          "X-OpenRouter-Title": process.env.OPENROUTER_APP_NAME ?? "OpenWorkflow",
        },
        body: JSON.stringify({
          model: process.env.BUILD_CHAT_MODEL?.trim() || "openai/gpt-5.6-luna",
          messages: [
            { role: "system", content: buildChatSystemPrompt() },
            {
              role: "system",
              content: `Current canvas (JSON): ${canvasSummary}`,
            },
            ...history,
          ],
          tools: [proposeWorkflowTool(), askUserTool()],
          tool_choice: "auto",
          provider: { require_parameters: true },
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(payload.error?.message ?? `OpenRouter request failed (${response.status}).`);
      }
      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string | null; tool_calls?: unknown } }>;
      };
      const message = payload.choices?.[0]?.message;
      if (!message) throw new Error("OpenRouter returned an empty response.");

      const toolCalls = extractToolCalls(message);
      const proposalCall = toolCalls.find((call) => call.function.name === "propose_workflow");
      const questionCall = toolCalls.find((call) => call.function.name === "ask_user");
      const reply = typeof message.content === "string" ? message.content.trim() : "";

      if (!proposalCall && questionCall) {
        const questions = parseBuildQuestions(JSON.parse(questionCall.function.arguments || "{}"));
        await finish(
          reply || "A few quick questions so the workflow fits what you need:",
          "completed",
          undefined,
          questions,
        );
        return;
      }

      if (!proposalCall) {
        await finish(reply || "I could not produce a proposal for that. Try describing the workflow you want.", "completed");
        return;
      }

      const proposal = parseBuildProposal(JSON.parse(proposalCall.function.arguments || "{}"));
      await finish(
        reply || `Proposed “${proposal.name ?? "a workflow"}” with ${proposal.nodes.length} steps. Review it below and apply it to the canvas.`,
        "completed",
        proposal,
      );
    } catch (error) {
      await finish(
        error instanceof Error ? error.message : "The build assistant hit an unexpected error.",
        "failed",
      );
    }
  },
});
