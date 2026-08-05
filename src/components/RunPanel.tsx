import { CheckCircle2, CircleAlert, Clock3, ExternalLink, ShieldCheck, Terminal, X } from "lucide-react";
import { useState } from "react";
import type { PendingApproval, RunLog } from "../types";

interface RunPanelProps {
  logs: RunLog[];
  running: boolean;
  pendingApproval?: PendingApproval;
  approvalBusy?: boolean;
  onApproval: (approved: boolean, note?: string) => void;
  onClose: () => void;
}

function artifact(input: unknown) {
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  return typeof record.documentUrl === "string" ? { url: record.documentUrl, demo: record.documentMode === "demo" } : undefined;
}

export function RunPanel({ logs, running, pendingApproval, approvalBusy, onApproval, onClose }: RunPanelProps) {
  const [note, setNote] = useState("");
  const document = artifact(pendingApproval?.input);
  return (
    <section className={`run-panel ${pendingApproval ? "has-approval" : ""}`}>
      <div className="run-panel-head">
        <div><Terminal size={15} /><strong>Run activity</strong><span className={pendingApproval ? "run-waiting" : running ? "run-live" : "run-done"}>{pendingApproval ? "Needs review" : running ? "In progress" : "Finished"}</span></div>
        <button className="icon-button" onClick={onClose} aria-label="Close run activity"><X size={16} /></button>
      </div>
      {pendingApproval && (
        <div className="approval-card">
          <div className="approval-title"><span><ShieldCheck size={17} /></span><div><strong>{pendingApproval.title}</strong><p>{pendingApproval.prompt}</p></div></div>
          {document && (document.demo ? <span className="demo-artifact-label">Demo document preview · no file was created</span> : <a href={document.url} target="_blank" rel="noreferrer">Open document for review <ExternalLink size={13} /></a>)}
          <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional note for the audit log" rows={2} />
          <div className="approval-actions"><button disabled={approvalBusy} onClick={() => onApproval(false, note)} className="reject-button">Reject</button><button disabled={approvalBusy} onClick={() => onApproval(true, note)} className="approve-button">{approvalBusy ? "Saving…" : "Approve and continue"}</button></div>
        </div>
      )}
      <div className="run-logs">
        {logs.length === 0 && <p>Each step will explain what it is doing here.</p>}
        {logs.map((log) => <div className={`run-log ${log.level}`} key={log.id}>{log.level === "success" ? <CheckCircle2 size={14} /> : log.level === "error" ? <CircleAlert size={14} /> : <Clock3 size={14} />}<time>{new Date(log.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time><span><strong>{log.message}</strong>{log.explanation && <small>{log.explanation}</small>}</span></div>)}
      </div>
    </section>
  );
}
