import {
  Check,
  ChevronRight,
  CircleAlert,
  Clipboard,
  ExternalLink,
  MessageSquare,
  Play,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LatestRunResult, PendingApproval, RunStepSummary, WorkflowNodeType } from "../types";
import { Markdown } from "./Markdown";
import { NodeMark } from "./icons";

interface RunTranscriptProps {
  result?: LatestRunResult;
  pendingApproval?: PendingApproval;
  approvalBusy: boolean;
  onApproval: (approved: boolean, note?: string) => void;
  onRun: () => void;
  running: boolean;
}

interface Citation {
  title: string;
  url: string;
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

function formatDuration(startedAt: number, completedAt?: number): string {
  if (!completedAt) return "";
  const ms = completedAt - startedAt;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function citationsOf(output: unknown): Citation[] {
  const raw = record(output).citations;
  if (!Array.isArray(raw)) return [];
  const unique = new Map<string, Citation>();
  raw.forEach((item, index) => {
    const nested = record(record(item).url_citation ?? item);
    const url = typeof nested.url === "string" ? nested.url : "";
    if (!url || unique.has(url)) return;
    unique.set(url, {
      title: typeof nested.title === "string" ? nested.title : `Source ${index + 1}`,
      url,
    });
  });
  return [...unique.values()];
}

/* A one-line result for steps that collapse. Falls back to nothing rather than dumping JSON. */
function stepSummary(step: RunStepSummary): string {
  const out = record(step.output);
  switch (step.nodeType) {
    case "gmailTrigger": {
      const count = Array.isArray(out.messages) ? out.messages.length : Number(out.count ?? 0);
      return count === 1 ? "1 message" : `${count} messages`;
    }
    case "googleDoc":
      return typeof out.documentTitle === "string" ? out.documentTitle : "Document created";
    case "slack": {
      const delivery = record(out.delivery);
      const channel = typeof delivery.channel === "string" ? delivery.channel : "channel";
      return delivery.status === "sent" ? `Posted to ${channel}` : `Preview for ${channel}`;
    }
    case "condition":
      return out.passed ? "Matched" : "Did not match";
    case "http":
      return `HTTP ${String(out.status ?? "")}`.trim();
    case "transform":
      return "Reshaped";
    case "approval":
      return step.status === "completed" ? "Decision recorded" : "";
    default:
      return "";
  }
}

function StatusMark({ status }: { status: RunStepSummary["status"] }) {
  if (status === "failed") return <span className="dot dot-failed" />;
  if (status === "running") return <span className="dot dot-running" />;
  if (status === "waiting") return <span className="dot dot-waiting" />;
  if (status === "completed") return <span className="dot dot-done" />;
  return <span className="dot" />;
}

/* Connector and utility steps: one line, expandable to the raw payload. */
function ToolCallRow({ step }: { step: RunStepSummary }) {
  const [open, setOpen] = useState(false);
  const out = record(step.output);
  const documentUrl = typeof out.documentUrl === "string" ? out.documentUrl : undefined;
  const isDemoDoc = out.documentMode === "demo";
  const delivery = record(out.delivery);
  const summary = stepSummary(step);
  const duration = formatDuration(step.startedAt, step.completedAt);

  return (
    <div className={`tx-tool ${step.status === "failed" ? "is-failed" : ""}`}>
      <button className="tx-tool-row" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <ChevronRight className={`tx-caret ${open ? "is-open" : ""}`} size={13} />
        <span className="tx-tool-mark">
          <NodeMark type={step.nodeType as WorkflowNodeType} size={14} />
        </span>
        <span className="tx-tool-label">{step.nodeLabel}</span>
        {step.status === "running" ? (
          <span className="tx-tool-summary shimmer">Working…</span>
        ) : (
          summary && <span className="tx-tool-summary">{summary}</span>
        )}
        <StatusMark status={step.status} />
        {duration && <span className="t-mono tx-tool-time">{duration}</span>}
      </button>

      {documentUrl &&
        (isDemoDoc ? (
          <div className="tx-artifact">
            <span className="tx-artifact-mark">
              <NodeMark type="googleDoc" size={15} />
            </span>
            <span>
              <strong>{String(out.documentTitle ?? "Generated document")}</strong>
              <small>Demo artifact — no Google Doc was created</small>
            </span>
          </div>
        ) : (
          <a className="tx-artifact is-link" href={documentUrl} target="_blank" rel="noreferrer noopener">
            <span className="tx-artifact-mark">
              <NodeMark type="googleDoc" size={15} />
            </span>
            <span>
              <strong>{String(out.documentTitle ?? "Generated document")}</strong>
              <small>Open in Google Docs</small>
            </span>
            <ExternalLink size={13} />
          </a>
        ))}

      {delivery.provider === "slack" && (
        <div className="tx-artifact">
          <span className="tx-artifact-mark">
            <MessageSquare size={15} />
          </span>
          <span>
            <strong>{delivery.status === "sent" ? "Shared in Slack" : "Slack preview"}</strong>
            <small>
              {String(delivery.channel ?? "channel")} ·{" "}
              {delivery.status === "sent" ? "Sent" : "Not actually posted"}
            </small>
          </span>
        </div>
      )}

      {step.error && (
        <p className="tx-step-error">
          <CircleAlert size={14} /> {step.error}
        </p>
      )}

      {open && (
        <pre className="tx-raw">{JSON.stringify(step.output ?? null, null, 2)}</pre>
      )}
    </div>
  );
}

/* The model step is the content the run exists to produce, so it renders open. */
function ModelBlock({ step }: { step: RunStepSummary }) {
  const [copied, setCopied] = useState(false);
  const out = record(step.output);
  const content = typeof out.content === "string" ? out.content : step.partialOutput ?? "";
  const citations = useMemo(() => citationsOf(step.output), [step.output]);
  const duration = formatDuration(step.startedAt, step.completedAt);

  const copy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="tx-model">
      <div className="tx-model-head">
        <span className="tx-tool-mark">
          <NodeMark type="ai" size={14} />
        </span>
        <span className="tx-tool-label">{step.nodeLabel}</span>
        <StatusMark status={step.status} />
        {duration && <span className="t-mono tx-tool-time">{duration}</span>}
        {content && (
          <button className="icon-btn tx-copy" onClick={() => void copy()} title="Copy" aria-label="Copy output">
            {copied ? <Check size={14} /> : <Clipboard size={14} />}
          </button>
        )}
      </div>

      {step.status === "running" && !content && (
        <p className="tx-thinking shimmer">Writing the brief…</p>
      )}
      {content && <Markdown>{content}</Markdown>}
      {step.error && (
        <p className="tx-step-error">
          <CircleAlert size={14} /> {step.error}
        </p>
      )}

      {citations.length > 0 && (
        <div className="tx-sources">
          <span className="t-eyebrow">Sources</span>
          {citations.map((citation, index) => (
            <a href={citation.url} target="_blank" rel="noreferrer noopener" key={citation.url}>
              <span className="t-mono">{index + 1}</span>
              <strong>{citation.title}</strong>
              <ExternalLink size={12} />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function ApprovalCard({
  approval,
  busy,
  onApproval,
}: {
  approval: PendingApproval;
  busy: boolean;
  onApproval: (approved: boolean, note?: string) => void;
}) {
  const [note, setNote] = useState("");
  return (
    <div className="tx-approval">
      <div className="tx-approval-head">
        <strong>{approval.title}</strong>
        <span className="badge">Waiting for you</span>
      </div>
      <p>{approval.prompt}</p>
      <label className="t-eyebrow" htmlFor={`approval-note-${approval.nodeId}`}>Note</label>
      <textarea
        id={`approval-note-${approval.nodeId}`}
        className="input"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Add a note (optional)"
        rows={2}
      />
      <div className="tx-approval-actions">
        <button className="btn btn-danger" disabled={busy} onClick={() => onApproval(false, note)}>
          Reject
        </button>
        <button className="btn btn-primary" disabled={busy} onClick={() => onApproval(true, note)}>
          Approve
        </button>
      </div>
    </div>
  );
}

export function RunTranscript({
  result,
  pendingApproval,
  approvalBusy,
  onApproval,
  onRun,
  running,
}: RunTranscriptProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const steps = result?.steps ?? [];

  // Follow the run as steps land, which is what makes it read as a conversation.
  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [steps, pendingApproval?.nodeId]);

  if (!result) {
    return (
      <div className="tx-empty">
        <p className="t-heading">No run yet</p>
        <p className="t-small t-muted">
          Run the workflow and each step will appear here with its result.
        </p>
        <button className="btn btn-primary" onClick={onRun} disabled={running}>
          <Play size={14} fill="currentColor" /> Run workflow
        </button>
      </div>
    );
  }

  const total = steps.length;
  const done = steps.filter((step) => step.status === "completed").length;
  const elapsed = steps.reduce(
    (sum, step) => sum + ((step.completedAt ?? step.startedAt) - step.startedAt),
    0,
  );

  return (
    <div className="tx" ref={scrollRef}>
      <div className="tx-summary">
        <span className="t-mono">{result.id ? `run_${result.id.slice(-6)}` : "queued"}</span>
        <span className="t-mono">
          {done}/{total || "—"} steps
        </span>
        {elapsed > 0 && <span className="t-mono">{(elapsed / 1000).toFixed(1)}s</span>}
      </div>

      {steps.length === 0 && (
        <p className="tx-thinking shimmer">Starting the workflow…</p>
      )}

      {steps.map((step) => {
        const isPendingApproval =
          step.nodeType === "approval" &&
          step.status === "waiting" &&
          pendingApproval?.nodeId === step.nodeId;

        if (isPendingApproval) {
          return (
            <ApprovalCard
              key={step.id}
              approval={pendingApproval}
              busy={approvalBusy}
              onApproval={onApproval}
            />
          );
        }
        if (step.nodeType === "ai") return <ModelBlock key={step.id} step={step} />;
        return <ToolCallRow key={step.id} step={step} />;
      })}

      {result.status === "failed" && (
        <div className="tx-failed">
          <CircleAlert size={15} />
          <span>
            <strong>The run stopped</strong>
            <small>{result.error ?? "The workflow failed."}</small>
            <small>
              Nothing after the failed step ran, so no message was shared. Fix the step above and run
              again.
            </small>
          </span>
        </div>
      )}

      {result.status === "completed" && (
        <div className="tx-done">
          <Check size={14} /> Finished and recorded
        </div>
      )}
    </div>
  );
}
