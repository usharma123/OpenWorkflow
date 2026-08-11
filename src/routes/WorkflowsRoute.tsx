import { useMutation, useQuery } from "convex/react";
import { Check, Copy, Pencil, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Id } from "../../convex/_generated/dataModel";
import { STARTER_WORKFLOW } from "../catalog";
import { WorkflowMark } from "../components/WorkflowMark";
import { bindDefaultConnections } from "../lib/connectionBinding";
import { useConnections } from "../lib/connections";
import {
  duplicateWorkflowRef,
  listWorkflowsRef,
  removeWorkflowRef,
  renameWorkflowRef,
  upsertWorkflowRef,
} from "../lib/convexClient";

function formatWhen(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function WorkflowsRoute() {
  const navigate = useNavigate();
  const { connections, setNotice } = useConnections();
  const workflows = useQuery(listWorkflowsRef, {});
  const upsertWorkflow = useMutation(upsertWorkflowRef);
  const renameWorkflow = useMutation(renameWorkflowRef);
  const duplicateWorkflow = useMutation(duplicateWorkflowRef);
  const removeWorkflow = useMutation(removeWorkflowRef);
  const [busyId, setBusyId] = useState<string>();
  const [renamingId, setRenamingId] = useState<string>();
  const [draftName, setDraftName] = useState("");

  const createWorkflow = async () => {
    const externalId = `workflow-${crypto.randomUUID()}`;
    setBusyId("new");
    try {
      await upsertWorkflow({
        externalId,
        name: "Untitled workflow",
        description: STARTER_WORKFLOW.description,
        enabled: false,
        maxConcurrentRuns: 3,
        nodes: bindDefaultConnections(structuredClone(STARTER_WORKFLOW.nodes), connections),
        edges: structuredClone(STARTER_WORKFLOW.edges),
        updatedAt: Date.now(),
      });
      navigate(`/workflow/${encodeURIComponent(externalId)}`);
    } catch (error) {
      setNotice({
        message: error instanceof Error ? error.message : "Could not create workflow",
        tone: "error",
      });
    } finally {
      setBusyId(undefined);
    }
  };

  const saveRename = async (workflowId: Id<"workflows">) => {
    const name = draftName.trim();
    if (!name) return;
    setBusyId(workflowId);
    try {
      await renameWorkflow({ workflowId, name });
      setRenamingId(undefined);
    } catch (error) {
      setNotice({
        message: error instanceof Error ? error.message : "Could not rename workflow",
        tone: "error",
      });
    } finally {
      setBusyId(undefined);
    }
  };

  const duplicate = async (workflowId: Id<"workflows">, name: string) => {
    const externalId = `workflow-${crypto.randomUUID()}`;
    setBusyId(workflowId);
    try {
      await duplicateWorkflow({
        workflowId,
        externalId,
        name: `${name} copy`,
      });
      setNotice({ message: "Workflow duplicated as a draft", tone: "info" });
      navigate(`/workflow/${encodeURIComponent(externalId)}`);
    } catch (error) {
      setNotice({
        message: error instanceof Error ? error.message : "Could not duplicate workflow",
        tone: "error",
      });
    } finally {
      setBusyId(undefined);
    }
  };

  const remove = async (workflowId: Id<"workflows">, name: string) => {
    if (!window.confirm(`Delete “${name}” and all of its run history?`)) return;
    setBusyId(workflowId);
    try {
      await removeWorkflow({ workflowId });
      setNotice({ message: "Workflow and its run history deleted", tone: "info" });
    } catch (error) {
      setNotice({
        message: error instanceof Error ? error.message : "Could not delete workflow",
        tone: "error",
      });
    } finally {
      setBusyId(undefined);
    }
  };

  return (
    <div className="page">
      <div className="page-head page-head-row">
        <div>
          <h1>Workflows</h1>
          <p>Every workflow in this account.</p>
        </div>
        <button className="btn btn-primary" disabled={busyId === "new"} onClick={() => void createWorkflow()}>
          <Plus size={14} /> {busyId === "new" ? "Creating…" : "New workflow"}
        </button>
      </div>

      {workflows === undefined && <p className="t-small t-muted">Loading…</p>}

      <div className="stack">
        {workflows?.map((workflow) => {
          const isRenaming = renamingId === workflow._id;
          const isBusy = busyId === workflow._id;
          return (
            <div className="row workflow-row" key={workflow._id}>
              {isRenaming ? (
                <div className="workflow-row-main">
                  <span className="row-mark"><WorkflowMark size={16} /></span>
                  <input
                    className="input workflow-name-input"
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void saveRename(workflow._id);
                      if (event.key === "Escape") setRenamingId(undefined);
                    }}
                    autoFocus
                    aria-label="Workflow name"
                  />
                </div>
              ) : (
                <Link className="workflow-row-main" to={`/workflow/${encodeURIComponent(workflow.externalId)}`}>
                  <span className="row-mark"><WorkflowMark size={16} /></span>
                  <span className="row-copy">
                    <strong>{workflow.name}</strong>
                    <small>{workflow.nodes.length} steps · edited {formatWhen(workflow.updatedAt)}</small>
                  </span>
                </Link>
              )}

              <span className="row-actions workflow-actions">
                <span className="badge">{workflow.enabled ? "Active" : "Draft"}</span>
                {isRenaming ? (
                  <>
                    <button className="icon-btn" disabled={isBusy || !draftName.trim()} onClick={() => void saveRename(workflow._id)} title="Save name" aria-label="Save name"><Check size={14} /></button>
                    <button className="icon-btn" disabled={isBusy} onClick={() => setRenamingId(undefined)} title="Cancel rename" aria-label="Cancel rename"><X size={14} /></button>
                  </>
                ) : (
                  <>
                    <button className="icon-btn" disabled={isBusy} onClick={() => { setRenamingId(workflow._id); setDraftName(workflow.name); }} title="Rename" aria-label={`Rename ${workflow.name}`}><Pencil size={14} /></button>
                    <button className="icon-btn" disabled={isBusy} onClick={() => void duplicate(workflow._id, workflow.name)} title="Duplicate" aria-label={`Duplicate ${workflow.name}`}><Copy size={14} /></button>
                    <button className="icon-btn danger-icon" disabled={isBusy} onClick={() => void remove(workflow._id, workflow.name)} title="Delete" aria-label={`Delete ${workflow.name}`}><Trash2 size={14} /></button>
                  </>
                )}
              </span>
            </div>
          );
        })}
      </div>

      {workflows?.length === 0 && (
        <div className="empty-state">
          <strong>No workflows yet</strong>
          New workflows open on a starter canvas.
        </div>
      )}
    </div>
  );
}
