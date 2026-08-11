import {
  Check,
  ChevronRight,
  CircleAlert,
  Clipboard,
  ExternalLink,
  MessageSquare,
  Play,
  RotateCcw,
} from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type {
  LatestRunResult,
  PendingApproval,
  PendingPlanReview,
  RunStepPlan,
  RunStepSummary,
  WorkflowNodeType,
} from "../types";
import { NodeMark } from "./icons";

const Markdown = lazy(() =>
  import("./Markdown").then((module) => ({ default: module.Markdown })),
);

interface RunTranscriptProps {
  result?: LatestRunResult;
  pendingApproval?: PendingApproval;
  approvalBusy: boolean;
  onApproval: (approved: boolean, note?: string) => void;
  pendingPlanReview?: PendingPlanReview;
  planBusy: boolean;
  onPlanDecision: (approved: boolean, steps?: string[], note?: string) => void;
  onRun: () => void;
  onRetry?: () => void;
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
    case "webSearch": {
      const count = Number(out.count ?? 0);
      return count === 1 ? "1 result" : `${count} results`;
    }
    case "gmailSend": {
      const delivery = record(out.delivery);
      const to = typeof delivery.to === "string" ? delivery.to : "recipient";
      return delivery.status === "sent" ? `Sent to ${to}` : `Preview for ${to}`;
    }
    case "calendarEvent": {
      const event = record(out.event);
      return typeof event.title === "string" ? event.title : "Event created";
    }
    case "sheetsAppend":
      return record(out.sheetAppend).status === "appended" ? "Row appended" : "Row preview";
    case "driveUpload": {
      const file = record(out.file);
      return typeof file.name === "string" ? file.name : "File uploaded";
    }
    case "slack": {
      const delivery = record(out.delivery);
      const channel = typeof delivery.channel === "string" ? delivery.channel : "channel";
      return delivery.status === "sent" ? `Posted to ${channel}` : `Preview for ${channel}`;
    }
    case "ai": {
      const tools = Array.isArray(out.toolTrace) ? out.toolTrace.length : 0;
      const arts = Array.isArray(out.artifacts) ? out.artifacts.length : 0;
      if (out.useCompute || tools || arts) {
        if (arts) return `Compute · ${arts} artifact${arts === 1 ? "" : "s"}`;
        if (tools) return `Compute · ${tools} tool${tools === 1 ? "" : "s"}`;
        return "Compute";
      }
      return "";
    }
    case "condition":
      return out.passed ? "Matched" : "Did not match";
    case "http":
      return `HTTP ${String(out.status ?? "")}`.trim();
    case "transform":
      return "Reshaped";
    case "forEach":
      return `${Number(out.count ?? 0)} items`;
    case "merge":
      return Array.isArray(out.items) ? `${out.items.length} merged items` : "Branches merged";
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

      {documentUrl && (
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
      )}

      {delivery.provider === "slack" && (
        <div className="tx-artifact">
          <span className="tx-artifact-mark">
            <MessageSquare size={15} />
          </span>
          <span>
            <strong>Shared in Slack</strong>
            <small>
              {String(delivery.channel ?? "channel")} · Sent
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

/* Live checklist for an approved plan while the agent executes it. */
function PlanChecklist({ plan }: { plan: RunStepPlan }) {
  return (
    <div className="tx-plan">
      <span className="t-eyebrow">Plan</span>
      <ol className="tx-plan-list">
        {plan.steps.map((planStep) => (
          <li key={planStep.title} className={`is-${planStep.status}`}>
            <span className="tx-plan-mark">
              {planStep.status === "done" ? (
                <Check size={12} />
              ) : planStep.status === "active" ? (
                <span className="dot dot-running" />
              ) : planStep.status === "skipped" ? (
                <span aria-hidden="true">—</span>
              ) : (
                <span className="dot" />
              )}
            </span>
            <span className="tx-plan-title">{planStep.title}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* One collapsible summary per spawned subagent. */
function SubagentBlock({
  subagent,
}: {
  subagent: { name: string; ok: boolean; content: string; citations: Citation[] };
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`tx-subagent ${subagent.ok ? "" : "is-failed"}`}>
      <button className="tx-tool-row" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <ChevronRight className={`tx-caret ${open ? "is-open" : ""}`} size={13} />
        <span className="tx-tool-label">Subagent · {subagent.name}</span>
        {!subagent.ok && <span className="tx-tool-summary">failed</span>}
        <span className={`dot ${subagent.ok ? "dot-done" : "dot-failed"}`} />
      </button>
      {open && (
        <div className="tx-subagent-body">
          <Suspense fallback={<p className="tx-thinking">Formatting…</p>}>
            <Markdown>{subagent.content.slice(0, 6_000)}</Markdown>
          </Suspense>
          {subagent.citations.length > 0 && (
            <div className="tx-sources">
              <span className="t-eyebrow">Sources</span>
              {subagent.citations.map((citation, index) => (
                <a href={citation.url} target="_blank" rel="noreferrer noopener" key={citation.url}>
                  <span className="t-mono">{index + 1}</span>
                  <strong>{citation.title}</strong>
                  <ExternalLink size={12} />
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* The proposed plan, editable one step per line, with approve / reject. */
function PlanReviewCard({
  review,
  busy,
  onDecision,
}: {
  review: PendingPlanReview;
  busy: boolean;
  onDecision: (approved: boolean, steps?: string[], note?: string) => void;
}) {
  const [draft, setDraft] = useState(() => review.steps.join("\n"));
  const [note, setNote] = useState("");
  const editedSteps = draft
    .split("\n")
    .map((line) => line.replace(/^\s*\d+[.)]\s*/, "").trim())
    .filter(Boolean);
  return (
    <div className="tx-approval tx-plan-review">
      <div className="tx-approval-head">
        <strong>{review.title} — research plan</strong>
        <span className="badge">Waiting for you</span>
      </div>
      <p>Review the plan before the agent starts. Edit the steps directly — one per line.</p>
      <label className="t-eyebrow" htmlFor={`plan-steps-${review.nodeId}`}>Plan steps</label>
      <textarea
        id={`plan-steps-${review.nodeId}`}
        className="input tx-plan-editor"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        rows={Math.min(10, Math.max(4, review.steps.length + 1))}
      />
      <label className="t-eyebrow" htmlFor={`plan-note-${review.nodeId}`}>Note</label>
      <textarea
        id={`plan-note-${review.nodeId}`}
        className="input"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Add a note (optional)"
        rows={2}
      />
      <div className="tx-approval-actions">
        <button className="btn btn-danger" disabled={busy} onClick={() => onDecision(false, undefined, note)}>
          Reject plan
        </button>
        <button
          className="btn btn-primary"
          disabled={busy || editedSteps.length === 0}
          onClick={() => onDecision(true, editedSteps, note)}
        >
          Approve plan
        </button>
      </div>
    </div>
  );
}

/* The model step is the content the run exists to produce, so it renders open. */
function ModelBlock({ step }: { step: RunStepSummary }) {
  const [copied, setCopied] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const out = record(step.output);
  const content = typeof out.content === "string" ? out.content : step.partialOutput ?? "";
  const citations = useMemo(() => citationsOf(step.output), [step.output]);
  const toolTrace = useMemo(() => {
    const raw = out.toolTrace;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((item) => {
      const entry = record(item);
      const summary = typeof entry.summary === "string" ? entry.summary : "";
      if (!summary) return [];
      return [{ summary, ok: entry.ok !== false }];
    });
  }, [out.toolTrace]);
  const artifacts = useMemo(() => {
    const raw = out.artifacts;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((item) => {
      const entry = record(item);
      const path = typeof entry.path === "string" ? entry.path : "";
      const type = typeof entry.type === "string" ? entry.type : "other";
      const mediaType = typeof entry.mediaType === "string" ? entry.mediaType : "text/plain";
      const artifactContent = typeof entry.content === "string" ? entry.content : "";
      if (!path || !artifactContent) return [];
      return [{ path, type, mediaType, content: artifactContent }];
    });
  }, [out.artifacts]);
  const subagents = useMemo(() => {
    const raw = out.subagents;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((item) => {
      const entry = record(item);
      const name = typeof entry.name === "string" ? entry.name : "";
      const subagentContent = typeof entry.content === "string" ? entry.content : "";
      if (!name || !subagentContent) return [];
      const subagentCitations = Array.isArray(entry.citations)
        ? (entry.citations as unknown[]).flatMap((citation) => {
            const record_ = record(citation);
            return typeof record_.url === "string"
              ? [{ title: String(record_.title ?? record_.url), url: record_.url }]
              : [];
          })
        : [];
      return [{ name, ok: entry.ok !== false, content: subagentContent, citations: subagentCitations }];
    });
  }, [out.subagents]);
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

      {step.plan && step.plan.status !== "rejected" && <PlanChecklist plan={step.plan} />}

      {toolTrace.length > 0 && (
        <ul className="tx-tool-trace">
          {toolTrace.map((entry) => (
            <li key={entry.summary} className={entry.ok ? undefined : "is-failed"}>
              {entry.summary}
            </li>
          ))}
        </ul>
      )}

      {subagents.length > 0 && (
        <div className="tx-subagents">
          {subagents.map((subagent) => (
            <SubagentBlock key={subagent.name} subagent={subagent} />
          ))}
        </div>
      )}

      {step.status === "running" && !content && (
        <p className="tx-thinking shimmer">Working…</p>
      )}
      {content && (
        <Suspense fallback={<p className="tx-thinking">Formatting output…</p>}>
          <Markdown>{content}</Markdown>
        </Suspense>
      )}
      {step.error && (
        <p className="tx-step-error">
          <CircleAlert size={14} /> {step.error}
        </p>
      )}

      {artifacts.length > 0 && (
        <div className="tx-artifacts">
          <span className="t-eyebrow">Artifacts</span>
          {artifacts.map((artifact) => {
            const isDashboard = artifact.type === "dashboard" || artifact.mediaType.includes("html");
            const isTable = artifact.type === "table" || artifact.mediaType.includes("csv");
            return (
              <div className="tx-artifact-card" key={`${artifact.type}-${artifact.path}`}>
                <div className="tx-artifact-card-head">
                  <strong>{artifact.path}</strong>
                  <small>{artifact.type}</small>
                  {isDashboard && (
                    <button type="button" className="link-btn" onClick={() => setPreviewHtml(artifact.content)}>
                      Preview
                    </button>
                  )}
                </div>
                {isTable ? (
                  <pre className="tx-artifact-preview">{artifact.content.slice(0, 1_200)}</pre>
                ) : isDashboard ? (
                  <pre className="tx-artifact-preview">{artifact.content.slice(0, 400)}</pre>
                ) : (
                  <Suspense fallback={null}>
                    <Markdown>{artifact.content.slice(0, 4_000)}</Markdown>
                  </Suspense>
                )}
              </div>
            );
          })}
        </div>
      )}

      {previewHtml && (
        <div className="tx-html-preview">
          <div className="tx-html-preview-head">
            <strong>Dashboard preview</strong>
            <button type="button" className="link-btn" onClick={() => setPreviewHtml(null)}>
              Close
            </button>
          </div>
          <iframe title="Dashboard preview" sandbox="" srcDoc={previewHtml} />
        </div>
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
  pendingPlanReview,
  planBusy,
  onPlanDecision,
  onRun,
  onRetry,
  running,
}: RunTranscriptProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const steps = result?.steps ?? [];

  // Follow the run as steps land, which is what makes it read as a conversation.
  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [steps, pendingApproval?.nodeId, pendingPlanReview?.nodeId]);

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
        const isPendingPlanReview =
          step.nodeType === "ai" &&
          step.status === "waiting" &&
          pendingPlanReview?.nodeId === step.nodeId;

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
        if (isPendingPlanReview) {
          return (
            <PlanReviewCard
              key={step.id}
              review={pendingPlanReview}
              busy={planBusy}
              onDecision={onPlanDecision}
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
              Successful steps are preserved. Retry resumes at the failed step and continues downstream.
            </small>
            {onRetry && (
              <button className="btn tx-retry" disabled={running} onClick={onRetry}>
                <RotateCcw size={13} /> Retry from failed step
              </button>
            )}
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
