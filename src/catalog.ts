import type { NodeCatalogItem, WorkflowDefinition, WorkflowNodeType } from "./types";

export const NODE_CATALOG: NodeCatalogItem[] = [
  {
    type: "manualTrigger",
    label: "Manual trigger",
    description: "Start a run from the editor",
    category: "Triggers",
    accent: "#8b5cf6",
    defaultConfig: {},
  },
  {
    type: "webhookTrigger",
    label: "Webhook",
    description: "Start from an authenticated HTTP request",
    category: "Triggers",
    accent: "#8b5cf6",
    defaultConfig: { slug: "incoming-request", secretRequired: true },
  },
  {
    type: "scheduleTrigger",
    label: "Schedule",
    description: "Run on a cron schedule",
    category: "Triggers",
    accent: "#8b5cf6",
    defaultConfig: { cron: "0 9 * * 1-5", timezone: "America/New_York" },
  },
  {
    type: "ai",
    label: "AI agent",
    description: "Prompt Luna, optionally with web search",
    category: "AI",
    accent: "#10b981",
    defaultConfig: {
      model: "openai/gpt-5.6-luna",
      systemPrompt: "You are a concise research assistant. Return accurate, actionable results.",
      prompt: "Research {{input.topic}} and summarize the most important findings.",
      webSearch: true,
      maxSearchResults: 5,
    },
  },
  {
    type: "condition",
    label: "Condition",
    description: "Route based on a value",
    category: "Logic",
    accent: "#f59e0b",
    defaultConfig: { path: "content", operator: "contains", value: "" },
  },
  {
    type: "transform",
    label: "Transform",
    description: "Map data with safe templates",
    category: "Logic",
    accent: "#f59e0b",
    defaultConfig: { template: "{{input}}" },
  },
  {
    type: "delay",
    label: "Delay",
    description: "Pause durably, then continue",
    category: "Logic",
    accent: "#f59e0b",
    defaultConfig: { seconds: 60 },
  },
  {
    type: "approval",
    label: "Human approval",
    description: "Wait for a person to approve",
    category: "Logic",
    accent: "#f59e0b",
    defaultConfig: { prompt: "Approve this workflow run?" },
  },
  {
    type: "http",
    label: "HTTP request",
    description: "Call an approved external API",
    category: "Actions",
    accent: "#38bdf8",
    defaultConfig: { method: "GET", url: "https://api.example.com", headers: "{}", body: "" },
  },
  {
    type: "output",
    label: "Return output",
    description: "Expose the final workflow result",
    category: "Actions",
    accent: "#38bdf8",
    defaultConfig: { outputName: "result" },
  },
];

export const catalogByType = Object.fromEntries(
  NODE_CATALOG.map((item) => [item.type, item]),
) as Record<WorkflowNodeType, NodeCatalogItem>;

export const STARTER_WORKFLOW: WorkflowDefinition = {
  id: "starter-research-flow",
  name: "Research assistant",
  description: "Research a topic with Luna and return a concise brief.",
  enabled: false,
  updatedAt: Date.now(),
  nodes: [
    {
      id: "trigger-1",
      type: "workflow",
      position: { x: 80, y: 210 },
      data: {
        label: "Start research",
        description: "Manual trigger",
        nodeType: "manualTrigger",
        config: {},
      },
    },
    {
      id: "ai-1",
      type: "workflow",
      position: { x: 390, y: 210 },
      data: {
        label: "Research with Luna",
        description: "GPT-5.6 Luna + web search",
        nodeType: "ai",
        config: { ...catalogByType.ai.defaultConfig },
      },
    },
    {
      id: "output-1",
      type: "workflow",
      position: { x: 710, y: 210 },
      data: {
        label: "Return brief",
        description: "Workflow output",
        nodeType: "output",
        config: { outputName: "researchBrief" },
      },
    },
  ],
  edges: [
    { id: "e-trigger-ai", source: "trigger-1", target: "ai-1", animated: true },
    { id: "e-ai-output", source: "ai-1", target: "output-1", animated: true },
  ],
};
