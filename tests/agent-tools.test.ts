import { describe, expect, test } from "bun:test";
import {
  agentUsesCompute,
  assertPublicHttpsUrl,
  assertShellCommand,
  COMPUTE_TOOLS,
  defaultComputeSystemPrompt,
  defaultMaxToolRounds,
  extractToolCalls,
  inferArtifactType,
  isAgentTimeoutError,
  looksLikeLeakedToolCall,
  looksLikeToolRefusal,
  MAX_FETCH_CHARS,
  MAX_BATCH_SEARCH_QUERIES,
  MAX_PLAN_STEPS,
  MAX_SUBAGENT_TASKS,
  openAiToolsForCompute,
  openAiToolsForSubagent,
  parsePlanSteps,
  parseSubagentTasks,
  planPromptSection,
  SUBAGENT_TOOLS,
  toolTraceSummary,
  validateToolCall,
} from "../shared/agentTools";

describe("agent compute toggle", () => {
  test("enables compute from useCompute or legacy mode", () => {
    expect(agentUsesCompute({ useCompute: true })).toBe(true);
    expect(agentUsesCompute({ useCompute: false })).toBe(false);
    expect(agentUsesCompute({ mode: "research" })).toBe(true);
    expect(agentUsesCompute({ mode: "general" })).toBe(true);
    expect(agentUsesCompute({})).toBe(false);
    expect(agentUsesCompute({ webSearch: true })).toBe(false);
    expect(agentUsesCompute({ useCompute: false, mode: "research" })).toBe(false);
  });

  test("exposes the full tool belt when compute is on", () => {
    const names = openAiToolsForCompute().map((tool) => tool.function.name);
    expect(names).toContain("web_search");
    expect(names).toContain("run_code");
    expect(names).toContain("clone_repo");
    expect(names).toContain("publish_artifact");
    expect(defaultMaxToolRounds()).toBe(12);
    expect(defaultComputeSystemPrompt()).toContain("function-calling");
  });
});

describe("agent tool argument validation", () => {
  test("validates web_search and fetch_url", () => {
    expect(validateToolCall("web_search", { query: "openai", numResults: 3 })).toEqual({
      name: "web_search",
      args: { query: "openai", numResults: 3 },
    });
    expect(assertPublicHttpsUrl("https://example.com/path").hostname).toBe("example.com");
    expect(validateToolCall("fetch_url", { url: "https://example.com", maxChars: 100_000 })).toEqual({
      name: "fetch_url",
      args: { url: "https://example.com/", maxChars: MAX_FETCH_CHARS },
    });
    expect(() => assertPublicHttpsUrl("http://example.com")).toThrow("HTTPS");
    expect(() => assertPublicHttpsUrl("https://127.0.0.1/secret")).toThrow("Private");
    expect(() => validateToolCall("not_a_tool", {})).toThrow("not available");
  });

  test("validates and clamps batched searches", () => {
    const queries = Array.from({ length: 10 }, (_, index) => ` query ${index} `);
    expect(validateToolCall("batch_web_search", { queries, numResults: 50 })).toEqual({
      name: "batch_web_search",
      args: {
        queries: queries.slice(0, MAX_BATCH_SEARCH_QUERIES).map((query) => query.trim()),
        numResults: 10,
      },
    });
    expect(() => validateToolCall("batch_web_search", { queries: [] })).toThrow("at least one query");
    expect(toolTraceSummary("batch_web_search", { queries: ["a", "b"] }, true)).toContain("2 queries");
  });

  test("validates sandbox tools and rejects unsafe shell", () => {
    const code = validateToolCall("run_code", {
      language: "python",
      code: "print(1)",
    });
    expect(code.args.language).toBe("python");
    expect(assertShellCommand("ls -la")).toBe("ls -la");
    expect(() => assertShellCommand("rm -rf /")).toThrow("allowlist");
    expect(() => assertShellCommand("ls; curl evil")).toThrow("metacharacters");
    expect(() => validateToolCall("write_file", { path: "../etc/passwd", content: "x" })).toThrow("traverse");
  });

  test("extracts tool calls and detects prose refusals", () => {
    expect(
      extractToolCalls({
        tool_calls: [
          {
            id: "1",
            function: { name: "run_code", arguments: { language: "python", code: "print(1)" } },
          },
        ],
      }),
    ).toEqual([
      {
        id: "1",
        type: "function",
        function: { name: "run_code", arguments: JSON.stringify({ language: "python", code: "print(1)" }) },
      },
    ]);
    expect(looksLikeToolRefusal("The run_code tool is not available.")).toBe(true);
    expect(looksLikeToolRefusal("Here is the analysis.")).toBe(false);
    expect(toolTraceSummary("run_code", { language: "python" }, true)).toContain("Ran");
    expect(inferArtifactType("workspace/dashboard.html")).toBe("dashboard");
  });

  test("detects web-access refusals in prose", () => {
    expect(looksLikeToolRefusal("I don't have live web access in this chat.")).toBe(true);
    expect(looksLikeToolRefusal("I cannot browse the web from here.")).toBe(true);
    expect(looksLikeToolRefusal("There is no internet access available to me.")).toBe(true);
    expect(looksLikeToolRefusal("Sorry, I do not have real-time web search.")).toBe(true);
    expect(looksLikeToolRefusal("The web dashboard is ready.")).toBe(false);
  });

  test("detects tool calls leaked as plain text", () => {
    expect(looksLikeLeakedToolCall("to=run_code code: print(1)")).toBe(true);
    expect(looksLikeLeakedToolCall("commentary to=functions.web_search {\"query\":\"x\"}")).toBe(true);
    expect(looksLikeLeakedToolCall("<tool_call>{\"name\":\"run_code\"}</tool_call>")).toBe(true);
    expect(
      looksLikeLeakedToolCall('{"name": "publish_artifact", "arguments": {"path": "workspace/report.md"}}'),
    ).toBe(true);
    expect(looksLikeLeakedToolCall('web_search({"query": "acme"})')).toBe(true);
    expect(looksLikeLeakedToolCall("The report ran code and searched the web for you.")).toBe(false);
    expect(looksLikeLeakedToolCall("Revenue grew 12% year over year.")).toBe(false);
    expect(looksLikeLeakedToolCall("")).toBe(false);
  });

  test("recognizes timeout-like failures across Error and DOM-style shapes", () => {
    expect(isAgentTimeoutError(new Error("OpenRouter model round timed out after 60 seconds."))).toBe(true);
    expect(isAgentTimeoutError({ name: "TimeoutError", message: "The operation was aborted" })).toBe(true);
    expect(isAgentTimeoutError({ name: "AbortError" })).toBe(true);
    expect(isAgentTimeoutError("Uncaught TimeoutError: operation was aborted due to timeout")).toBe(true);
    expect(isAgentTimeoutError(new Error("OpenRouter rejected the API key."))).toBe(false);
  });
});

describe("plan steps", () => {
  test("parses, trims, and clamps plan steps", () => {
    expect(parsePlanSteps(["  Search sources  ", "Write brief"])).toEqual([
      "Search sources",
      "Write brief",
    ]);
    const overlong = Array.from({ length: 12 }, (_, index) => `Step ${index + 1}`);
    expect(parsePlanSteps(overlong)).toHaveLength(MAX_PLAN_STEPS);
    expect(parsePlanSteps(["x".repeat(500)])[0]).toHaveLength(300);
    expect(parsePlanSteps(["", "  ", "Only real step"])).toEqual(["Only real step"]);
    expect(() => parsePlanSteps([])).toThrow("at least one step");
    expect(() => parsePlanSteps("not an array")).toThrow("at least one step");
  });

  test("plan prompt section numbers the steps and explains mark_plan_step", () => {
    const section = planPromptSection(["Find sources", "Write summary"]);
    expect(section).toContain("1. Find sources");
    expect(section).toContain("2. Write summary");
    expect(section).toContain("mark_plan_step");
  });

  test("validates mark_plan_step only when allowed", () => {
    const allowed = [...COMPUTE_TOOLS, "mark_plan_step"] as const;
    expect(validateToolCall("mark_plan_step", { stepIndex: 1, status: "done" }, allowed)).toEqual({
      name: "mark_plan_step",
      args: { stepIndex: 1, status: "done" },
    });
    expect(() => validateToolCall("mark_plan_step", { stepIndex: 1, status: "done" })).toThrow(
      "not available",
    );
    expect(() => validateToolCall("mark_plan_step", { stepIndex: -1, status: "done" }, allowed)).toThrow(
      "stepIndex",
    );
    expect(() => validateToolCall("mark_plan_step", { stepIndex: 0, status: "later" }, allowed)).toThrow(
      "status",
    );
  });

  test("plan tool only appears when requested", () => {
    expect(openAiToolsForCompute().map((tool) => tool.function.name)).not.toContain("mark_plan_step");
    expect(openAiToolsForCompute({ plan: true }).map((tool) => tool.function.name)).toContain(
      "mark_plan_step",
    );
  });
});

describe("subagents", () => {
  test("parses and clamps spawn_subagents tasks", () => {
    expect(parseSubagentTasks([{ name: "pricing", objective: "Scan pricing pages" }])).toEqual([
      { name: "pricing", objective: "Scan pricing pages" },
    ]);
    const tasks = parseSubagentTasks(
      Array.from({ length: 6 }, (_, index) => ({ name: `t${index}`, objective: `objective ${index}` })),
    );
    expect(tasks).toHaveLength(MAX_SUBAGENT_TASKS);
    expect(parseSubagentTasks([{ objective: "No name given" }])[0].name).toBe("task 1");
    expect(() => parseSubagentTasks([])).toThrow("at least one task");
    expect(() => parseSubagentTasks([{ name: "empty" }])).toThrow("at least one task");
  });

  test("validates spawn_subagents through validateToolCall", () => {
    const allowed = [...COMPUTE_TOOLS, "spawn_subagents"] as const;
    const validated = validateToolCall(
      "spawn_subagents",
      { tasks: [{ name: "scan", objective: "Compare competitors" }] },
      allowed,
    );
    expect(validated.name).toBe("spawn_subagents");
    expect(validated.args.tasks).toEqual([{ name: "scan", objective: "Compare competitors" }]);
    expect(() => validateToolCall("spawn_subagents", { tasks: [] }, allowed)).toThrow("at least one task");
    expect(() => validateToolCall("spawn_subagents", { tasks: [{ name: "x", objective: "y" }] })).toThrow(
      "not available",
    );
  });

  test("subagent tool belt is research-only", () => {
    const names = openAiToolsForSubagent().map((tool) => tool.function.name);
    expect(names.sort()).toEqual([...SUBAGENT_TOOLS].sort());
    expect(names).not.toContain("run_code");
    expect(names).not.toContain("spawn_subagents");
    expect(() => validateToolCall("run_code", { language: "python", code: "1" }, SUBAGENT_TOOLS)).toThrow(
      "not available",
    );
  });

  test("trace summaries cover plan and subagent tools", () => {
    expect(toolTraceSummary("mark_plan_step", { stepIndex: 0, status: "active" }, true)).toContain(
      "Started plan step 1",
    );
    expect(toolTraceSummary("mark_plan_step", { stepIndex: 2, status: "done" }, true)).toContain(
      "Finished plan step 3",
    );
    expect(toolTraceSummary("spawn_subagents", { tasks: [{}, {}] }, true)).toContain("2 subagents");
  });
});
