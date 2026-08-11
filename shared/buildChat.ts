export interface BuildProposalNode {
  id: string;
  type: string;
  label?: string;
  description?: string;
  config?: Record<string, unknown>;
}

export interface BuildProposalEdge {
  source: string;
  target: string;
  sourceHandle?: string;
}

export interface BuildProposal {
  name?: string;
  description?: string;
  nodes: BuildProposalNode[];
  edges: BuildProposalEdge[];
}

export interface BuildQuestionOption {
  id: string;
  label: string;
}

export interface BuildQuestion {
  id: string;
  prompt: string;
  options: BuildQuestionOption[];
  allowMultiple?: boolean;
}

export const MAX_BUILD_QUESTIONS = 3;

/** Node types the build chat may place on the canvas, with their key config fields. */
const BUILD_NODE_SPECS: ReadonlyArray<{ type: string; purpose: string; config: string }> = [
  { type: "manualTrigger", purpose: "Run on demand from a button", config: "none" },
  { type: "webhookTrigger", purpose: "Start when another system posts data", config: "slug (url name)" },
  { type: "scheduleTrigger", purpose: "Run on a cron schedule", config: "cron, timezone" },
  { type: "gmailTrigger", purpose: "Collect recent Gmail messages for a digest", config: "search (Gmail query), maxMessages (1-25)" },
  { type: "gmailEventTrigger", purpose: "Start when a matching email arrives", config: "query (Gmail search)" },
  { type: "calendarTrigger", purpose: "Start when a calendar event is created or updated", config: "calendarId" },
  { type: "driveTrigger", purpose: "Start when a Drive file changes", config: "folderId (optional)" },
  { type: "sheetsTrigger", purpose: "Start when a Sheet row is appended", config: "spreadsheetId, range" },
  { type: "ai", purpose: "LLM agent that can research, analyze, or build; with useCompute it can search the web, fetch pages, run code in a sandbox, and delegate independent research tasks to parallel subagents", config: "systemPrompt (optional role), prompt (instructions; interpolate earlier results with {{input}} or {{input.field}}), useCompute (boolean), planFirst (boolean — the agent writes a research plan and pauses for user approval before executing; recommended for research workflows), webSearch (boolean, only when useCompute is false)" },
  { type: "webSearch", purpose: "Search the public web through Exa", config: "query (supports {{input.field}}), numResults (1-10), includeText (boolean)" },
  { type: "condition", purpose: "Route down a true or false branch based on a value", config: "path (dotted path into input), operator (equals | contains | exists | greaterThan), value" },
  { type: "transform", purpose: "Reshape data with a safe template", config: "template (supports {{input.field}})" },
  { type: "forEach", purpose: "Apply a template to every item in a list", config: "path (dotted path to the array), template" },
  { type: "merge", purpose: "Combine results from multiple branches", config: "mode (append | combine | first)" },
  { type: "delay", purpose: "Pause durably before continuing", config: "seconds" },
  { type: "approval", purpose: "Pause until a person approves", config: "prompt (question for reviewer), approver" },
  { type: "googleDoc", purpose: "Create a Google Doc from the input content", config: "title, folder" },
  { type: "gmailSend", purpose: "Send an email from the connected Gmail account", config: "to, subject, body" },
  { type: "calendarEvent", purpose: "Create a Google Calendar event", config: "calendarId, title, description, startIso, durationMinutes" },
  { type: "sheetsAppend", purpose: "Append a row to a Google Sheet", config: "spreadsheetId, range, values (comma-separated or JSON array)" },
  { type: "driveUpload", purpose: "Save a text file to Google Drive", config: "fileName, content, folder (optional)" },
  { type: "slack", purpose: "Post a message to a Slack channel", config: "channel, message" },
  { type: "http", purpose: "Call a public HTTPS API", config: "method, url, headers (JSON), body" },
  { type: "output", purpose: "Mark the workflow result", config: "outputName" },
];

export const BUILDABLE_NODE_TYPES: ReadonlySet<string> = new Set(
  BUILD_NODE_SPECS.map((spec) => spec.type),
);

export function buildChatSystemPrompt(): string {
  const catalog = BUILD_NODE_SPECS
    .map((spec) => `- ${spec.type}: ${spec.purpose}. Config: ${spec.config}.`)
    .join("\n");
  return [
    "You are the OpenWorkflow build assistant. You help users design automation workflows as a graph of steps.",
    "When the user describes a workflow they want (or asks you to change the current one), call the propose_workflow tool with the complete graph — always include every node and edge the final workflow should have, not a diff.",
    "When the user is only asking a question, answer in plain language without calling any tool.",
    "",
    "Clarifying questions:",
    "- When key details are missing — the destination (email, Slack, Doc, Sheet), the schedule or trigger, whether a human approval is wanted, or how deep research should go — call the ask_user tool with up to 3 multiple-choice questions instead of guessing.",
    "- Ask at most one round of questions: if the previous assistant message already asked, use the user's answers and propose the workflow.",
    "- Skip questions entirely when the request already answers them.",
    "",
    "Available step types:",
    catalog,
    "",
    "Rules:",
    "- Start with exactly one trigger step (a type ending in Trigger, or manualTrigger).",
    "- Give every node a short unique id (like gmail-1), a human label, and a one-line description.",
    "- Wire steps left to right with edges; every non-trigger node needs at least one incoming edge.",
    "- condition nodes branch: edges leaving them should set sourceHandle to \"true\" or \"false\".",
    "- Reference earlier results in config strings with {{input}} or {{input.field}} template expressions.",
    "- Include an approval step before anything is shared externally when the user's intent involves review.",
    "- Connector steps always act through the user's connected account. Do not add executionMode or simulated connector behavior; the editor binds a compatible active account automatically and fails clearly when none is available.",
    "- When a user asks to save a report, brief, analysis, or other readable document to Google or Google Drive, use googleDoc so the result is a native, formatted Google Doc. Use driveUpload only when the user explicitly asks for a raw text file or another file upload.",
    "- For research workflows, prefer an ai step with useCompute: true and planFirst: true so the user can review the plan before it runs.",
    "- Keep the graph acyclic and minimal — no steps the user did not ask for or clearly need.",
    "- Along with the tool call, write one short sentence in your reply describing the proposed workflow (or the questions you are asking).",
  ].join("\n");
}

export function proposeWorkflowTool(): {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
} {
  return {
    type: "function",
    function: {
      name: "propose_workflow",
      description: "Propose the complete workflow graph the user asked for.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short workflow name" },
          description: { type: "string", description: "One-line workflow description" },
          nodes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                type: { type: "string" },
                label: { type: "string" },
                description: { type: "string" },
                config: { type: "object" },
              },
              required: ["id", "type", "label"],
            },
          },
          edges: {
            type: "array",
            items: {
              type: "object",
              properties: {
                source: { type: "string" },
                target: { type: "string" },
                sourceHandle: { type: "string", enum: ["true", "false", "error"] },
              },
              required: ["source", "target"],
            },
          },
        },
        required: ["nodes", "edges"],
      },
    },
  };
}

export function askUserTool(): {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
} {
  return {
    type: "function",
    function: {
      name: "ask_user",
      description:
        "Ask the user up to 3 multiple-choice questions to pin down missing workflow details before proposing.",
      parameters: {
        type: "object",
        properties: {
          questions: {
            type: "array",
            minItems: 1,
            maxItems: MAX_BUILD_QUESTIONS,
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "Short stable id, e.g. destination" },
                prompt: { type: "string", description: "The question to show the user" },
                allowMultiple: { type: "boolean", description: "Allow selecting several options" },
                options: {
                  type: "array",
                  minItems: 2,
                  maxItems: 5,
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      label: { type: "string", description: "Short answer chip text" },
                    },
                    required: ["id", "label"],
                  },
                },
              },
              required: ["id", "prompt", "options"],
            },
          },
        },
        required: ["questions"],
      },
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Validate and normalize a raw ask_user payload. Throws when unusable. */
export function parseBuildQuestions(raw: unknown): BuildQuestion[] {
  const record = asRecord(raw);
  const rawQuestions = Array.isArray(record.questions) ? record.questions : [];
  const questions: BuildQuestion[] = [];
  const seenIds = new Set<string>();
  for (const item of rawQuestions) {
    const entry = asRecord(item);
    const prompt = String(entry.prompt ?? "").trim().slice(0, 300);
    if (!prompt) continue;
    let id = String(entry.id ?? "").trim().slice(0, 60) || `question-${questions.length + 1}`;
    if (seenIds.has(id)) id = `${id}-${questions.length + 1}`;
    const rawOptions = Array.isArray(entry.options) ? entry.options : [];
    const options: BuildQuestionOption[] = [];
    const seenOptionIds = new Set<string>();
    for (const optionItem of rawOptions) {
      const option = asRecord(optionItem);
      const label = String(option.label ?? "").trim().slice(0, 120);
      if (!label) continue;
      let optionId = String(option.id ?? "").trim().slice(0, 60) || `option-${options.length + 1}`;
      if (seenOptionIds.has(optionId)) optionId = `${optionId}-${options.length + 1}`;
      seenOptionIds.add(optionId);
      options.push({ id: optionId, label });
      if (options.length >= 5) break;
    }
    if (options.length < 2) continue;
    seenIds.add(id);
    questions.push({
      id,
      prompt,
      options,
      ...(entry.allowMultiple === true ? { allowMultiple: true } : {}),
    });
    if (questions.length >= MAX_BUILD_QUESTIONS) break;
  }
  if (!questions.length) throw new Error("ask_user did not contain any usable questions.");
  return questions;
}

/** Validate and normalize a raw propose_workflow payload. Throws when unusable. */
export function parseBuildProposal(raw: unknown): BuildProposal {
  const record = asRecord(raw);
  const rawNodes = Array.isArray(record.nodes) ? record.nodes : [];
  const nodes: BuildProposalNode[] = [];
  const seenIds = new Set<string>();
  for (const item of rawNodes) {
    const entry = asRecord(item);
    const id = String(entry.id ?? "").trim();
    const type = String(entry.type ?? "").trim();
    if (!id || seenIds.has(id)) continue;
    if (!BUILDABLE_NODE_TYPES.has(type)) continue;
    seenIds.add(id);
    nodes.push({
      id,
      type,
      label: String(entry.label ?? "").trim() || undefined,
      description: String(entry.description ?? "").trim() || undefined,
      config: asRecord(entry.config),
    });
  }
  if (!nodes.length) throw new Error("The proposal did not contain any usable steps.");

  const rawEdges = Array.isArray(record.edges) ? record.edges : [];
  const edges: BuildProposalEdge[] = [];
  const seenEdges = new Set<string>();
  for (const item of rawEdges) {
    const entry = asRecord(item);
    const source = String(entry.source ?? "").trim();
    const target = String(entry.target ?? "").trim();
    const sourceHandle = ["true", "false", "error"].includes(String(entry.sourceHandle ?? ""))
      ? String(entry.sourceHandle)
      : undefined;
    if (!seenIds.has(source) || !seenIds.has(target) || source === target) continue;
    const key = `${source}:${target}:${sourceHandle ?? ""}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    edges.push({ source, target, ...(sourceHandle ? { sourceHandle } : {}) });
  }

  // Reject cyclic graphs — the executor refuses loops.
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    const targets = outgoing.get(edge.source);
    if (targets) targets.push(edge.target);
    else outgoing.set(edge.source, [edge.target]);
  }
  const queue: string[] = [];
  for (const node of nodes) {
    if ((indegree.get(node.id) ?? 0) === 0) queue.push(node.id);
  }
  let visited = 0;
  while (queue.length) {
    const id = queue.shift()!;
    visited += 1;
    for (const next of outgoing.get(id) ?? []) {
      const remaining = (indegree.get(next) ?? 1) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }
  if (visited !== nodes.length) throw new Error("The proposed workflow contains a loop.");

  return {
    name: String(record.name ?? "").trim() || undefined,
    description: String(record.description ?? "").trim() || undefined,
    nodes,
    edges,
  };
}
