export type AgentToolName =
  | "web_search"
  | "fetch_url"
  | "run_code"
  | "read_file"
  | "write_file"
  | "run_shell"
  | "clone_repo"
  | "publish_artifact"
  | "mark_plan_step"
  | "spawn_subagents";

export type AgentPlanStepStatus = "pending" | "active" | "done" | "skipped";

export interface AgentPlanStep {
  title: string;
  status: AgentPlanStepStatus;
}

export interface SubagentTask {
  name: string;
  objective: string;
}

export interface SubagentResult {
  name: string;
  objective: string;
  content: string;
  citations: Array<{ title: string; url: string }>;
  toolTrace: AgentToolTraceEntry[];
  ok: boolean;
}

export interface AgentArtifact {
  type: "report" | "table" | "dashboard" | "json" | "other";
  path: string;
  mediaType: string;
  content: string;
}

export interface AgentToolTraceEntry {
  tool: AgentToolName;
  summary: string;
  ok: boolean;
}

/** Full tool belt when Use compute is on — the model decides what to call. */
export const COMPUTE_TOOLS: readonly AgentToolName[] = [
  "web_search",
  "fetch_url",
  "run_code",
  "read_file",
  "write_file",
  "run_shell",
  "clone_repo",
  "publish_artifact",
] as const;

/** Restricted belt for spawned subagents: research only, no sandbox, no recursion. */
export const SUBAGENT_TOOLS: readonly AgentToolName[] = ["web_search", "fetch_url"] as const;

const ALL_TOOL_NAMES: readonly AgentToolName[] = [
  ...COMPUTE_TOOLS,
  "mark_plan_step",
  "spawn_subagents",
] as const;

export const MAX_SUBAGENT_TASKS = 3;
export const MAX_PLAN_STEPS = 8;
export const MAX_FETCH_CHARS = 20_000;

const SANDBOX_TOOLS = new Set<AgentToolName>([
  "run_code",
  "read_file",
  "write_file",
  "run_shell",
  "clone_repo",
]);

const ARTIFACT_PATHS = [
  "workspace/report.md",
  "workspace/summary.json",
  "workspace/table.csv",
  "workspace/dashboard.html",
] as const;

const CODE_LANGUAGES = new Set(["python", "javascript", "typescript"]);
const SHELL_ALLOW = /^(ls|pwd|wc|head|tail|cat|python3?|node)(\s|$)/;
const MAX_FILE_BYTES = 200_000;
const MAX_ARTIFACT_CHARS = 80_000;

/**
 * Compute is on when explicitly enabled, or when an older `mode` field is present
 * (compat with graphs saved before the toggle redesign).
 */
export function agentUsesCompute(config: Record<string, unknown>): boolean {
  if (config.useCompute === true) return true;
  if (config.useCompute === false) return false;
  const mode = String(config.mode ?? "").trim();
  return mode === "research" || mode === "spreadsheet" || mode === "general";
}

export function defaultMaxToolRounds(): number {
  return 12;
}

export function defaultComputeSystemPrompt(): string {
  return [
    "You are a capable workflow agent with web research and a secure sandbox.",
    "Decide for yourself when to search, fetch pages, run code, write files, or publish artifacts.",
    "Workflow input is available at /tmp/openworkflow-input.json (and workspace/input.json).",
    "Call tools only through the provided function-calling interface — never invent that a tool is unavailable.",
    "When producing deliverables, prefer workspace/report.md, workspace/summary.json, workspace/table.csv, and workspace/dashboard.html,",
    "and call publish_artifact for each. Keep the final answer concise and actionable for the next workflow step.",
    "Never invent URLs; cite only sources you retrieved.",
  ].join(" ");
}

export function knownArtifactPaths(): readonly string[] {
  return ARTIFACT_PATHS;
}

export function isSandboxTool(name: string): boolean {
  return SANDBOX_TOOLS.has(name as AgentToolName);
}

type OpenAiFunctionTool = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

/** Structured tool used only during the planning call — never in the execution loop. */
export function proposePlanTool(): OpenAiFunctionTool {
  return {
    type: "function",
    function: {
      name: "propose_plan",
      description:
        "Propose a short, concrete research plan for the task. Each step is one clear action the agent will take.",
      parameters: {
        type: "object",
        properties: {
          steps: {
            type: "array",
            items: { type: "string" },
            minItems: 2,
            maxItems: MAX_PLAN_STEPS,
            description: "Ordered plan steps, each a single imperative sentence.",
          },
        },
        required: ["steps"],
      },
    },
  };
}

/** Validate and normalize a raw propose_plan steps payload. Throws when unusable. */
export function parsePlanSteps(raw: unknown): string[] {
  const items = Array.isArray(raw) ? raw : [];
  const steps: string[] = [];
  for (const item of items) {
    const title = String(item ?? "").trim().slice(0, 300);
    if (title) steps.push(title);
    if (steps.length >= MAX_PLAN_STEPS) break;
  }
  if (!steps.length) throw new Error("The plan must contain at least one step.");
  return steps;
}

/** System-prompt section injected when executing an approved plan. */
export function planPromptSection(steps: string[]): string {
  const numbered = steps.map((step, index) => `${index + 1}. ${step}`).join("\n");
  return [
    "The user approved this plan. Execute it in order:",
    numbered,
    "Before you start a step, call mark_plan_step with its index (0-based) and status \"active\".",
    "When a step is finished call mark_plan_step with status \"done\", or \"skipped\" when it turned out unnecessary.",
    "Stay within the plan; only deviate when a step is impossible, and say so in the final answer.",
  ].join("\n");
}

function markPlanStepTool(): OpenAiFunctionTool {
  return {
    type: "function",
    function: {
      name: "mark_plan_step",
      description: "Report progress on the approved plan so the user can follow along.",
      parameters: {
        type: "object",
        properties: {
          stepIndex: { type: "integer", minimum: 0, maximum: MAX_PLAN_STEPS - 1 },
          status: { type: "string", enum: ["active", "done", "skipped"] },
        },
        required: ["stepIndex", "status"],
      },
    },
  };
}

function spawnSubagentsTool(): OpenAiFunctionTool {
  return {
    type: "function",
    function: {
      name: "spawn_subagents",
      description:
        "Delegate independent research tasks to parallel subagents. Each subagent can search the web and fetch pages, then returns a cited summary. Use for breadth (comparing sources, scanning competitors) — not for tasks that depend on each other.",
      parameters: {
        type: "object",
        properties: {
          tasks: {
            type: "array",
            minItems: 1,
            maxItems: MAX_SUBAGENT_TASKS,
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "Short label, e.g. 'pricing scan'" },
                objective: { type: "string", description: "What the subagent should find out" },
              },
              required: ["name", "objective"],
            },
          },
        },
        required: ["tasks"],
      },
    },
  };
}

/** Validate and normalize a raw spawn_subagents tasks payload. Throws when unusable. */
export function parseSubagentTasks(raw: unknown): SubagentTask[] {
  const items = Array.isArray(raw) ? raw : [];
  const tasks: SubagentTask[] = [];
  for (const item of items) {
    const entry =
      item && typeof item === "object" && !Array.isArray(item)
        ? (item as Record<string, unknown>)
        : {};
    const objective = String(entry.objective ?? "").trim().slice(0, 2_000);
    if (!objective) continue;
    const name = String(entry.name ?? "").trim().slice(0, 60) || `task ${tasks.length + 1}`;
    tasks.push({ name, objective });
    if (tasks.length >= MAX_SUBAGENT_TASKS) break;
  }
  if (!tasks.length) throw new Error("spawn_subagents requires at least one task with an objective.");
  return tasks;
}

export function openAiToolsForSubagent(): OpenAiFunctionTool[] {
  return openAiToolsForCompute().filter((tool) =>
    (SUBAGENT_TOOLS as readonly string[]).includes(tool.function.name),
  );
}

export function openAiToolsForCompute(options?: {
  plan?: boolean;
  subagents?: boolean;
}): OpenAiFunctionTool[] {
  const extra: OpenAiFunctionTool[] = [];
  if (options?.plan) extra.push(markPlanStepTool());
  if (options?.subagents) extra.push(spawnSubagentsTool());
  return [
    ...extra,
    {
      type: "function",
      function: {
        name: "web_search",
        description: "Search the public web for current information.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            numResults: { type: "integer", minimum: 1, maximum: 10 },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "fetch_url",
        description: "Fetch a public HTTPS page and return text content.",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string" },
            maxChars: { type: "integer", minimum: 500, maximum: MAX_FETCH_CHARS },
          },
          required: ["url"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "run_code",
        description:
          "Run Python, JavaScript, or TypeScript in the isolated sandbox. Read input from /tmp/openworkflow-input.json. Print JSON to stdout for structured results.",
        parameters: {
          type: "object",
          properties: {
            language: { type: "string", enum: ["python", "javascript", "typescript"] },
            code: { type: "string" },
          },
          required: ["language", "code"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "write_file",
        description: "Write a text file under the sandbox workspace.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Relative path like workspace/report.md" },
            content: { type: "string" },
          },
          required: ["path", "content"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "read_file",
        description: "Read a text file from the sandbox workspace.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string" },
          },
          required: ["path"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "run_shell",
        description: "Run a narrow allowlisted shell command in the sandbox.",
        parameters: {
          type: "object",
          properties: {
            command: { type: "string" },
            workingDirectory: { type: "string" },
          },
          required: ["command"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "clone_repo",
        description: "Clone a public HTTPS Git repository into the sandbox.",
        parameters: {
          type: "object",
          properties: {
            repositoryUrl: { type: "string" },
            directory: { type: "string" },
            branch: { type: "string" },
          },
          required: ["repositoryUrl"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "publish_artifact",
        description: "Register a sandbox file as a workflow artifact for later steps.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string" },
            type: { type: "string", enum: ["report", "table", "dashboard", "json", "other"] },
            mediaType: { type: "string" },
          },
          required: ["path", "type"],
        },
      },
    },
  ];
}

export function isPrivateHost(hostname: string): boolean {
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

export function assertPublicHttpsUrl(value: unknown): URL {
  const url = new URL(String(value ?? ""));
  if (url.protocol !== "https:") throw new Error("Only public HTTPS URLs are allowed.");
  if (url.username || url.password) throw new Error("URLs must not include credentials.");
  if (isPrivateHost(url.hostname)) throw new Error("Private or local hosts are blocked.");
  return url;
}

export function assertSandboxRelPath(value: unknown): string {
  const path = String(value ?? "").trim().replace(/^\.\//, "");
  if (!path || path.startsWith("/") || path.split("/").some((part) => part === "..")) {
    throw new Error("Sandbox paths must be relative and cannot traverse parent directories.");
  }
  if (!/^[a-zA-Z0-9._/-]+$/.test(path)) {
    throw new Error("Sandbox paths may only contain letters, numbers, dots, underscores, dashes, and slashes.");
  }
  return path;
}

export function assertCodeLanguage(value: unknown): "python" | "javascript" | "typescript" {
  const language = String(value ?? "").trim().toLowerCase();
  if (!CODE_LANGUAGES.has(language)) throw new Error("Unsupported sandbox language.");
  return language as "python" | "javascript" | "typescript";
}

export function assertShellCommand(value: unknown): string {
  const command = String(value ?? "").trim();
  if (!command) throw new Error("Shell command cannot be empty.");
  if (command.length > 4_000) throw new Error("Shell command is too long.");
  if (/[;&|`$()<>]/.test(command) || command.includes("\n")) {
    throw new Error("Shell command contains blocked metacharacters.");
  }
  if (!SHELL_ALLOW.test(command)) {
    throw new Error("Shell command is not on the allowlist (ls, pwd, wc, head, tail, cat, python, node).");
  }
  return command;
}

export function parseToolArguments(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    throw new Error("Tool arguments must be valid JSON.");
  }
  throw new Error("Tool arguments must be a JSON object.");
}

export function validateToolCall(
  name: string,
  rawArgs: unknown,
  allowed: readonly AgentToolName[] = COMPUTE_TOOLS,
): { name: AgentToolName; args: Record<string, unknown> } {
  if (!allowed.includes(name as AgentToolName)) {
    throw new Error(`Tool ${name} is not available.`);
  }
  const args = parseToolArguments(rawArgs);
  switch (name as AgentToolName) {
    case "web_search": {
      const query = String(args.query ?? "").trim();
      if (!query) throw new Error("web_search requires a query.");
      return {
        name: "web_search",
        args: {
          query: query.slice(0, 500),
          numResults: Math.min(10, Math.max(1, Math.trunc(Number(args.numResults ?? 5)))),
        },
      };
    }
    case "fetch_url": {
      const url = assertPublicHttpsUrl(args.url);
      return {
        name: "fetch_url",
        args: {
          url: url.toString(),
          maxChars: Math.min(MAX_FETCH_CHARS, Math.max(500, Math.trunc(Number(args.maxChars ?? 12_000)))),
        },
      };
    }
    case "run_code": {
      const code = String(args.code ?? "");
      if (!code.trim()) throw new Error("run_code requires code.");
      if (code.length > 200_000) throw new Error("Code is limited to 200,000 characters.");
      return { name: "run_code", args: { language: assertCodeLanguage(args.language), code } };
    }
    case "write_file": {
      const content = String(args.content ?? "");
      if (content.length > MAX_FILE_BYTES) throw new Error("File content is too large.");
      return { name: "write_file", args: { path: assertSandboxRelPath(args.path), content } };
    }
    case "read_file":
      return { name: "read_file", args: { path: assertSandboxRelPath(args.path) } };
    case "run_shell":
      return {
        name: "run_shell",
        args: {
          command: assertShellCommand(args.command),
          workingDirectory: assertSandboxRelPath(args.workingDirectory ?? "workspace"),
        },
      };
    case "clone_repo":
      return {
        name: "clone_repo",
        args: {
          repositoryUrl: String(args.repositoryUrl ?? ""),
          directory: assertSandboxRelPath(args.directory ?? "workspace/repository"),
          branch: String(args.branch ?? "").trim(),
        },
      };
    case "publish_artifact": {
      const type = String(args.type ?? "other");
      if (!["report", "table", "dashboard", "json", "other"].includes(type)) {
        throw new Error("Unsupported artifact type.");
      }
      const path = assertSandboxRelPath(args.path);
      const mediaType =
        String(args.mediaType ?? "").trim() ||
        (type === "dashboard"
          ? "text/html"
          : type === "table"
            ? "text/csv"
            : type === "json"
              ? "application/json"
              : "text/markdown");
      return { name: "publish_artifact", args: { path, type, mediaType } };
    }
    case "mark_plan_step": {
      const stepIndex = Math.trunc(Number(args.stepIndex));
      if (!Number.isFinite(stepIndex) || stepIndex < 0 || stepIndex >= MAX_PLAN_STEPS) {
        throw new Error("mark_plan_step requires a valid stepIndex.");
      }
      const status = String(args.status ?? "");
      if (!["active", "done", "skipped"].includes(status)) {
        throw new Error("mark_plan_step status must be active, done, or skipped.");
      }
      return { name: "mark_plan_step", args: { stepIndex, status } };
    }
    case "spawn_subagents":
      return { name: "spawn_subagents", args: { tasks: parseSubagentTasks(args.tasks) } };
    default:
      throw new Error(`Unsupported tool: ${name}`);
  }
}

/** Normalize OpenAI / OpenRouter tool_calls into a stable shape. */
export function extractToolCalls(message: unknown): Array<{
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}> {
  if (!message || typeof message !== "object") return [];
  const record = message as Record<string, unknown>;
  const raw = record.tool_calls;
  if (!Array.isArray(raw)) return [];
  const calls: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> = [];
  for (const [index, item] of raw.entries()) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const fn =
      entry.function && typeof entry.function === "object"
        ? (entry.function as Record<string, unknown>)
        : entry;
    const name = typeof fn.name === "string" ? fn.name : "";
    if (!name) continue;
    const argsRaw = fn.arguments ?? entry.arguments ?? "{}";
    const args =
      typeof argsRaw === "string"
        ? argsRaw
        : JSON.stringify(argsRaw && typeof argsRaw === "object" ? argsRaw : {});
    calls.push({
      id: typeof entry.id === "string" && entry.id ? entry.id : `call_${index}`,
      type: "function",
      function: { name, arguments: args },
    });
  }
  return calls;
}

/** True when the model refused tools in prose despite tools being offered. */
export function looksLikeToolRefusal(content: string): boolean {
  const text = content.toLowerCase();
  if (!text.trim()) return false;
  return (
    /not available|don't have (access to )?tools|cannot use (the )?tool|can't use (the )?tool|no access to run_code|tool is not available|function calling is not/.test(
      text,
    ) ||
    /(don't|do not|can't|cannot) (have |currently have )?(live |real[- ]?time )?(web|internet|browsing) (access|search)/.test(
      text,
    ) ||
    /(can't|cannot|unable to) (browse|search) the (web|internet)/.test(text) ||
    /no (live |real[- ]?time )?(web|internet) access/.test(text) ||
    /as an ai language model.*(cannot|can't).*code/.test(text)
  );
}

/**
 * True when the model wrote a tool invocation as plain text instead of a
 * structured tool call — e.g. Harmony-style `to=run_code code: ...` leakage,
 * `<tool_call>` tags, or a fenced JSON body shaped like a function call.
 * Happens when a provider silently drops the `tools` parameter.
 */
export function looksLikeLeakedToolCall(content: string): boolean {
  const text = content.trim();
  if (!text) return false;
  const toolNames = ALL_TOOL_NAMES.join("|");
  if (new RegExp(`\\bto=(functions\\.)?(${toolNames})\\b`).test(text)) return true;
  if (/commentary to=/.test(text)) return true;
  if (/<\/?tool_call>|<\/?function_call>/i.test(text)) return true;
  if (
    new RegExp(`"name"\\s*:\\s*"(${toolNames})"`).test(text) &&
    /"(arguments|parameters|args)"\s*:/.test(text)
  ) {
    return true;
  }
  if (new RegExp(`^(${toolNames})\\s*\\(`, "m").test(text)) return true;
  return false;
}

export function toolTraceSummary(
  name: AgentToolName,
  args: Record<string, unknown>,
  ok: boolean,
): string {
  if (!ok) return `Failed: ${name}`;
  switch (name) {
    case "web_search":
      return `Searched “${String(args.query ?? "").slice(0, 80)}”`;
    case "fetch_url":
      return `Fetched ${String(args.url ?? "").slice(0, 100)}`;
    case "run_code":
      return `Ran ${String(args.language ?? "code")}`;
    case "write_file":
      return `Wrote ${String(args.path ?? "file")}`;
    case "read_file":
      return `Read ${String(args.path ?? "file")}`;
    case "run_shell":
      return `Shell: ${String(args.command ?? "").slice(0, 60)}`;
    case "clone_repo":
      return `Cloned repo`;
    case "publish_artifact":
      return `Published ${String(args.type ?? "artifact")}`;
    case "mark_plan_step": {
      const index = Number(args.stepIndex);
      const status = String(args.status ?? "active");
      return status === "active"
        ? `Started plan step ${index + 1}`
        : status === "skipped"
          ? `Skipped plan step ${index + 1}`
          : `Finished plan step ${index + 1}`;
    }
    case "spawn_subagents": {
      const tasks = Array.isArray(args.tasks) ? args.tasks : [];
      return `Spawned ${tasks.length} subagent${tasks.length === 1 ? "" : "s"}`;
    }
  }
}

export function inferArtifactType(path: string): AgentArtifact["type"] {
  if (path.endsWith(".html")) return "dashboard";
  if (path.endsWith(".csv")) return "table";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".md")) return "report";
  return "other";
}

export function inferMediaType(path: string): string {
  if (path.endsWith(".html")) return "text/html";
  if (path.endsWith(".csv")) return "text/csv";
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".md")) return "text/markdown";
  return "text/plain";
}

export function capArtifactContent(content: string): string {
  if (content.length <= MAX_ARTIFACT_CHARS) return content;
  return `${content.slice(0, MAX_ARTIFACT_CHARS)}\n…[truncated]`;
}
