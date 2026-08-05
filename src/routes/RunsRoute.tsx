import { useQuery } from "convex/react";
import { ChevronRight, History } from "lucide-react";
import { useState } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import { RunTranscript } from "../components/RunTranscript";
import { listRunsRef, listWorkflowsRef } from "../lib/convexClient";
import type { LatestRunResult, RunStepSummary } from "../types";

const STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  running: "Running",
  waiting: "Waiting",
  completed: "Completed",
  failed: "Failed",
};

function formatWhen(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function RunsRoute() {
  const workflows = useQuery(listWorkflowsRef, {});
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<Id<"workflows">>();
  const workflowId = selectedWorkflowId ?? workflows?.[0]?._id;
  const runs = useQuery(listRunsRef, workflowId ? { workflowId } : "skip");
  const [openRunId, setOpenRunId] = useState<string>();

  return (
    <div className="page">
      <div className="page-head">
        <h1>Runs</h1>
        <p>Every execution, with the steps and output exactly as they happened.</p>
      </div>

      {workflows && workflows.length > 0 && (
        <label className="page-filter">
          <span className="t-eyebrow">Workflow</span>
          <select
            className="input"
            value={workflowId}
            onChange={(event) => {
              setSelectedWorkflowId(event.target.value as Id<"workflows">);
              setOpenRunId(undefined);
            }}
          >
            {workflows.map((workflow) => (
              <option value={workflow._id} key={workflow._id}>{workflow.name}</option>
            ))}
          </select>
        </label>
      )}

      {runs === undefined && workflowId && <p className="t-small t-muted">Loading…</p>}

      {(runs?.length === 0 || (!workflowId && workflows !== undefined)) && (
        <div className="empty-state">
          <strong>No runs yet</strong>
          Run your workflow and its history will collect here.
        </div>
      )}

      <div className="stack">
        {runs?.map((run) => {
          const steps: RunStepSummary[] = run.steps.map((step) => ({
            id: step._id,
            nodeId: step.nodeId,
            nodeLabel: step.nodeLabel,
            nodeType: step.nodeType,
            status: step.status,
            startedAt: step.startedAt,
            completedAt: step.completedAt,
            partialOutput: step.partialOutput,
            output: step.output,
            error: step.error,
          }));
          const result: LatestRunResult = {
            id: run._id,
            status: run.status,
            output: run.output,
            error: run.error,
            steps,
          };
          const isOpen = openRunId === run._id;

          return (
            <div key={run._id}>
              <button
                className="row"
                onClick={() => setOpenRunId(isOpen ? undefined : run._id)}
                aria-expanded={isOpen}
              >
                <span className="row-mark">
                  <History size={16} />
                </span>
                <span className="row-copy">
                  <strong>{formatWhen(run.startedAt)}</strong>
                  <small>
                    {run.trigger} · {steps.length} {steps.length === 1 ? "step" : "steps"}
                  </small>
                </span>
                <span className="row-actions">
                  <span className={`badge ${run.status === "failed" ? "badge-danger" : ""}`}>
                    {STATUS_LABEL[run.status] ?? run.status}
                  </span>
                  <ChevronRight
                    size={15}
                    style={{ transform: isOpen ? "rotate(90deg)" : undefined, color: "var(--ink-6)" }}
                  />
                </span>
              </button>

              {isOpen && (
                <div className="run-detail">
                  <RunTranscript
                    result={result}
                    approvalBusy={false}
                    onApproval={() => undefined}
                    onRun={() => undefined}
                    running={false}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
