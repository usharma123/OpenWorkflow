import { Copy, Info, LockKeyhole, Settings2, Trash2, X } from "lucide-react";
import { catalogByType } from "../catalog";
import type { WorkflowNode } from "../types";
import { NODE_ICONS } from "./icons";

interface InspectorProps {
  node: WorkflowNode;
  onChange: (node: WorkflowNode) => void;
  onClose: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
}

function TextField({ label, value, onChange, multiline = false, placeholder }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean; placeholder?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {multiline ? <textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} rows={4} /> : <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />}
    </label>
  );
}

function ConnectionMode({ mode, onChange }: { mode: string; onChange: (value: string) => void }) {
  return (
    <div className="connection-mode">
      <div><LockKeyhole size={14} /><span><strong>Connection</strong><small>Secrets never enter this workflow</small></span></div>
      <div className="segmented-control">
        <button type="button" className={mode === "demo" ? "active" : ""} onClick={() => onChange("demo")}>Safe demo</button>
        <button type="button" className={mode === "live" ? "active" : ""} onClick={() => onChange("live")}>Connected</button>
      </div>
    </div>
  );
}

function ConnectionField({ provider, value, onChange }: { provider: "google" | "slack"; value: string; onChange: (value: string) => void }) {
  const option = provider === "google" ? { value: "google-workspace-poc", label: "Google Workspace · approved POC connection" } : { value: "slack-poc", label: "Slack workspace · approved POC connection" };
  return <label className="field"><span>Approved connection</span><select value={value || option.value} onChange={(event) => onChange(event.target.value)}><option value={option.value}>{option.label}</option></select></label>;
}

export function Inspector({ node, onChange, onClose, onDelete, onDuplicate }: InspectorProps) {
  const item = catalogByType[node.data.nodeType];
  const Icon = NODE_ICONS[node.data.nodeType];
  const config = node.data.config;
  const setConfig = (key: string, value: unknown) => onChange({ ...node, data: { ...node.data, config: { ...config, [key]: value } } });

  return (
    <aside className="inspector panel">
      <div className="inspector-header">
        <div className="inspector-icon" style={{ color: item.accent }}><Icon size={18} /></div>
        <div><strong>{item.label}</strong><span>{item.category} step</span></div>
        <button className="icon-button" onClick={onClose} aria-label="Close inspector"><X size={17} /></button>
      </div>
      <div className="inspector-scroll">
        <section className="inspector-section">
          <h3><Settings2 size={14} /> What this step does</h3>
          <p className="outcome-copy">{item.outcome}</p>
          <TextField label="Step name" value={node.data.label} onChange={(label) => onChange({ ...node, data: { ...node.data, label } })} />
          <TextField label="Short description" value={node.data.description} onChange={(description) => onChange({ ...node, data: { ...node.data, description } })} />
        </section>
        <section className="inspector-section">
          <h3>Set up this step</h3>
          {item.setup === "connection" && <ConnectionMode mode={String(config.executionMode ?? "demo")} onChange={(value) => setConfig("executionMode", value)} />}
          {node.data.nodeType === "gmailTrigger" && <><TextField label="Which emails should be included?" value={String(config.search ?? "")} onChange={(value) => setConfig("search", value)} placeholder="is:unread newer_than:1d" /><label className="field"><span>Maximum number of emails</span><input type="number" min={1} max={25} value={Number(config.maxMessages ?? 5)} onChange={(event) => setConfig("maxMessages", Number(event.target.value))} /></label><ConnectionField provider="google" value={String(config.connectionRef ?? "")} onChange={(value) => setConfig("connectionRef", value)} /></>}
          {node.data.nodeType === "ai" && <><label className="field"><span>AI model</span><select value={String(config.model ?? "openai/gpt-5.6-luna")} onChange={(event) => setConfig("model", event.target.value)}><option value="openai/gpt-5.6-luna">GPT-5.6 Luna (OpenRouter)</option></select></label><TextField label="Role and writing style" multiline value={String(config.systemPrompt ?? "")} onChange={(value) => setConfig("systemPrompt", value)} /><TextField label="Instructions" multiline value={String(config.prompt ?? "")} onChange={(value) => setConfig("prompt", value)} /><label className="toggle-row"><span><strong>Use web search</strong><small>Add current web sources when needed</small></span><input type="checkbox" checked={Boolean(config.webSearch)} onChange={(event) => setConfig("webSearch", event.target.checked)} /></label>{Boolean(config.webSearch) && <label className="field"><span>Maximum sources</span><input type="number" min={1} max={10} value={Number(config.maxSearchResults ?? 5)} onChange={(event) => setConfig("maxSearchResults", Number(event.target.value))} /></label>}</>}
          {node.data.nodeType === "googleDoc" && <><TextField label="Document title" value={String(config.title ?? "")} onChange={(value) => setConfig("title", value)} /><TextField label="Save in folder" value={String(config.folder ?? "")} onChange={(value) => setConfig("folder", value)} /><ConnectionField provider="google" value={String(config.connectionRef ?? "")} onChange={(value) => setConfig("connectionRef", value)} /></>}
          {node.data.nodeType === "slack" && <><TextField label="Slack channel" value={String(config.channel ?? "")} onChange={(value) => setConfig("channel", value)} placeholder="#leadership-updates" /><TextField label="Message" multiline value={String(config.message ?? "")} onChange={(value) => setConfig("message", value)} /><ConnectionField provider="slack" value={String(config.connectionRef ?? "")} onChange={(value) => setConfig("connectionRef", value)} /></>}
          {node.data.nodeType === "webhookTrigger" && <TextField label="Secure URL name" value={String(config.slug ?? "")} onChange={(value) => setConfig("slug", value)} />}
          {node.data.nodeType === "scheduleTrigger" && <><TextField label="Schedule" value={String(config.cron ?? "")} onChange={(value) => setConfig("cron", value)} /><TextField label="Timezone" value={String(config.timezone ?? "")} onChange={(value) => setConfig("timezone", value)} /></>}
          {node.data.nodeType === "http" && <><label className="field"><span>Request type</span><select value={String(config.method ?? "GET")} onChange={(event) => setConfig("method", event.target.value)}><option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option></select></label><TextField label="Approved HTTPS URL" value={String(config.url ?? "")} onChange={(value) => setConfig("url", value)} /><TextField label="Headers (JSON)" multiline value={String(config.headers ?? "{}") } onChange={(value) => setConfig("headers", value)} /><TextField label="Request body" multiline value={String(config.body ?? "")} onChange={(value) => setConfig("body", value)} /></>}
          {node.data.nodeType === "condition" && <><TextField label="Information to check" value={String(config.path ?? "")} onChange={(value) => setConfig("path", value)} /><label className="field"><span>Rule</span><select value={String(config.operator ?? "equals")} onChange={(event) => setConfig("operator", event.target.value)}><option value="equals">Equals</option><option value="contains">Contains</option><option value="exists">Has a value</option><option value="greaterThan">Is greater than</option></select></label><TextField label="Compare with" value={String(config.value ?? "")} onChange={(value) => setConfig("value", value)} /></>}
          {node.data.nodeType === "transform" && <TextField label="New format" multiline value={String(config.template ?? "")} onChange={(value) => setConfig("template", value)} />}
          {node.data.nodeType === "delay" && <label className="field"><span>Wait time in seconds</span><input type="number" min={1} value={Number(config.seconds ?? 60)} onChange={(event) => setConfig("seconds", Number(event.target.value))} /></label>}
          {node.data.nodeType === "approval" && <><TextField label="Question for the reviewer" multiline value={String(config.prompt ?? "")} onChange={(value) => setConfig("prompt", value)} /><TextField label="Who should review it?" value={String(config.approver ?? "")} onChange={(value) => setConfig("approver", value)} /></>}
          {node.data.nodeType === "output" && <TextField label="Result name" value={String(config.outputName ?? "result")} onChange={(value) => setConfig("outputName", value)} />}
          {node.data.nodeType === "manualTrigger" && <p className="empty-config">Nothing to configure. Choose Run workflow when you are ready.</p>}
        </section>
        <section className="template-help"><strong><Info size={12} /> Use information from earlier steps</strong><p>Insert a value such as <code>{"{{input.documentUrl}}"}</code>. OpenWorkflow fills it in when the run reaches this step.</p></section>
      </div>
      <div className="inspector-actions"><button onClick={onDuplicate}><Copy size={15} /> Duplicate</button><button className="danger" onClick={onDelete}><Trash2 size={15} /> Delete</button></div>
    </aside>
  );
}
