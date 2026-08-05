import { Check, CircleAlert, Clipboard, Code2, ExternalLink, FileOutput, LoaderCircle, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { LatestRunResult } from "../types";

interface OutputPanelProps {
  result: LatestRunResult;
  onClose: () => void;
}

interface Citation {
  title: string;
  url: string;
}

function outputContent(output: unknown): string {
  if (typeof output === "string") return output;
  if (output && typeof output === "object") {
    const record = output as Record<string, unknown>;
    if (typeof record.content === "string") return record.content;
    if (typeof record.value === "string") return record.value;
  }
  return output == null ? "" : JSON.stringify(output, null, 2);
}

function outputCitations(output: unknown): Citation[] {
  if (!output || typeof output !== "object") return [];
  const raw = (output as Record<string, unknown>).citations;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const nested = record.url_citation && typeof record.url_citation === "object"
      ? record.url_citation as Record<string, unknown>
      : record;
    const url = typeof nested.url === "string" ? nested.url : "";
    if (!url) return [];
    return [{ title: typeof nested.title === "string" ? nested.title : `Source ${index + 1}`, url }];
  });
}

export function OutputPanel({ result, onClose }: OutputPanelProps) {
  const [raw, setRaw] = useState(false);
  const [copied, setCopied] = useState(false);
  const content = useMemo(() => outputContent(result.output), [result.output]);
  const citations = useMemo(() => outputCitations(result.output), [result.output]);
  const finished = result.status === "completed" || result.status === "failed";

  const copyOutput = async () => {
    await navigator.clipboard.writeText(raw ? JSON.stringify(result.output, null, 2) : content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <aside className="output-inspector panel">
      <div className="output-header">
        <div className="output-icon"><FileOutput size={18} /></div>
        <div>
          <strong>Latest output</strong>
          <span>{result.id ? `Run ${result.id.slice(-8)}` : "Preparing run"}</span>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close output"><X size={17} /></button>
      </div>

      <div className="output-status">
        {result.status === "completed" ? <Check size={14} /> : result.status === "failed" ? <CircleAlert size={14} /> : <LoaderCircle className="spin" size={14} />}
        <span>{result.status === "completed" ? "Completed" : result.status === "failed" ? "Failed" : "Workflow is running"}</span>
      </div>

      <div className="output-scroll">
        {!finished && (
          <div className="output-waiting">
            <LoaderCircle className="spin" size={24} />
            <strong>Building your result</strong>
            <p>Convex is executing each block. This pane will update automatically.</p>
          </div>
        )}

        {result.status === "failed" && (
          <div className="output-error"><CircleAlert size={16} /><span>{result.error ?? "The workflow failed."}</span></div>
        )}

        {result.status === "completed" && (
          <>
            <div className="output-toolbar">
              <span>Response</span>
              <div>
                <button onClick={() => setRaw((current) => !current)} className={raw ? "active" : ""}><Code2 size={13} /> JSON</button>
                <button onClick={() => void copyOutput()}>{copied ? <Check size={13} /> : <Clipboard size={13} />} {copied ? "Copied" : "Copy"}</button>
              </div>
            </div>
            <div className={raw ? "output-content raw" : "output-content"}>
              {raw ? JSON.stringify(result.output, null, 2) : content || "The workflow returned an empty result."}
            </div>
            {citations.length > 0 && (
              <section className="output-sources">
                <h3>Sources <span>{citations.length}</span></h3>
                {citations.map((citation, index) => (
                  <a href={citation.url} target="_blank" rel="noreferrer" key={`${citation.url}-${index}`}>
                    <span>{index + 1}</span>
                    <strong>{citation.title}</strong>
                    <ExternalLink size={12} />
                  </a>
                ))}
              </section>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
