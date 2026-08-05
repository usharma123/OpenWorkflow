import type { RunLog, WorkflowDefinition, WorkflowNode, WorkflowRun } from "../types";

const wait = (milliseconds: number) =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds));

function orderedNodes(workflow: WorkflowDefinition): WorkflowNode[] {
  const incoming = new Map(workflow.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, string[]>();

  for (const edge of workflow.edges) {
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  }

  const queue = workflow.nodes.filter((node) => incoming.get(node.id) === 0);
  const ordered: WorkflowNode[] = [];
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node) break;
    ordered.push(node);
    for (const target of outgoing.get(node.id) ?? []) {
      const next = (incoming.get(target) ?? 1) - 1;
      incoming.set(target, next);
      if (next === 0) {
        const targetNode = workflow.nodes.find((candidate) => candidate.id === target);
        if (targetNode) queue.push(targetNode);
      }
    }
  }

  if (ordered.length !== workflow.nodes.length) {
    throw new Error("Workflow contains a cycle. Remove the loop before running it.");
  }
  return ordered;
}

export async function runDemo(
  workflow: WorkflowDefinition,
  onLog: (log: RunLog) => void,
  onNodeStatus: (nodeId: string, status: "running" | "success" | "error") => void,
): Promise<WorkflowRun> {
  const run: WorkflowRun = {
    id: crypto.randomUUID(),
    status: "running",
    startedAt: Date.now(),
    logs: [],
  };

  const log = (entry: Omit<RunLog, "id" | "timestamp">) => {
    const complete = { ...entry, id: crypto.randomUUID(), timestamp: Date.now() };
    run.logs.push(complete);
    onLog(complete);
  };

  log({ level: "info", message: "Demo run started in the browser." });

  try {
    const nodes = orderedNodes(workflow);
    for (const node of nodes) {
      onNodeStatus(node.id, "running");
      log({ level: "info", nodeId: node.id, message: `Running ${node.data.label}` });
      await wait(420);

      if (node.data.nodeType === "ai") {
        log({
          level: "success",
          nodeId: node.id,
          message: "Luna step validated (connect Convex to make the live OpenRouter call).",
          output: { model: node.data.config.model, webSearch: node.data.config.webSearch },
        });
      } else {
        log({ level: "success", nodeId: node.id, message: `${node.data.label} completed` });
      }
      onNodeStatus(node.id, "success");
    }

    run.status = "completed";
    run.completedAt = Date.now();
    run.output = {
      content: "Demo mode validated the workflow graph. Connect Convex and configure OPENROUTER_API_KEY for a live Luna response.",
      citations: [],
    };
    log({ level: "success", message: "Workflow completed successfully." });
    return run;
  } catch (error) {
    run.status = "failed";
    run.completedAt = Date.now();
    log({ level: "error", message: error instanceof Error ? error.message : "Workflow failed" });
    throw error;
  }
}
