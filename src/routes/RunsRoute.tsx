import { useQuery } from "convex/react";
import { ChevronRight, History } from "lucide-react";
import { useEffect, useState } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import { RunTranscript } from "../components/RunTranscript";
import { convexClient, getRunRef, listRunsRef, listWorkflowsRef, type StoredRun } from "../lib/convexClient";
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
  const [details, setDetails] = useState<Record<string, StoredRun>>({});
  const [detailError, setDetailError] = useState<string>();

  useEffect(() => {
    if (!openRunId || details[openRunId] || !convexClient) return;
    let disposed = false;
    setDetailError(undefined);
    void convexClient.query(getRunRef, { runId: openRunId as Id<"workflowRuns"> }).then((run) => {
      if (disposed) return;
      if (run) setDetails((current) => ({ ...current, [openRunId]: run }));
      else setDetailError("Run details are no longer available.");
    }).catch((error) => {
      if (!disposed) setDetailError(error instanceof Error ? error.message : "Could not load run details.");
    });
    return () => { disposed = true; };
  }, [details, openRunId]);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Runs</h1>
        <p>Past executions and their output.</p>
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
          const detail = details[run._id];
          const steps: RunStepSummary[] = (detail?.steps ?? []).map((step) => ({
            id: step._id,
            nodeId: step.nodeId,
            nodeLabel: step.nodeLabel,
            nodeType: step.nodeType,
            status: step.status,
            startedAt: step.startedAt,
            completedAt: step.completedAt,
            partialOutput: step.partialOutput,
            partialToolTrace: step.partialToolTrace,
            output: step.output,
            error: step.error,
            plan: step.plan,
            agents: step.agents,
          }));
          const result: LatestRunResult = {
            id: run._id,
            status: run.status,
            output: detail?.output,
            error: run.error ?? detail?.error,
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
                    {run.trigger}{detail ? ` · ${steps.length} ${steps.length === 1 ? "step" : "steps"}` : ""}
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
                  {!detail && !detailError && <p className="t-small t-muted">Loading run details…</p>}
                  {detailError && <p className="t-small">{detailError}</p>}
                  {detail && <RunTranscript
                      result={result}
                      approvalBusy={false}
                      onApproval={() => undefined}
                      planBusy={false}
                      onPlanDecision={() => undefined}
                      onRun={() => undefined}
                      running={false}
                    />}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
