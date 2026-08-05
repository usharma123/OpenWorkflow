import { Copy, Settings2, Trash2, X } from "lucide-react";
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

function TextField({
  label,
  value,
  onChange,
  multiline = false,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {multiline ? (
        <textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} rows={4} />
      ) : (
        <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
      )}
    </label>
  );
}

export function Inspector({ node, onChange, onClose, onDelete, onDuplicate }: InspectorProps) {
  const item = catalogByType[node.data.nodeType];
  const Icon = NODE_ICONS[node.data.nodeType];
  const config = node.data.config;
  const setConfig = (key: string, value: unknown) =>
    onChange({ ...node, data: { ...node.data, config: { ...config, [key]: value } } });

  return (
    <aside className="inspector panel">
      <div className="inspector-header">
        <div className="inspector-icon" style={{ color: item.accent }}><Icon size={18} /></div>
        <div><strong>{item.label}</strong><span>{item.category} block</span></div>
        <button className="icon-button" onClick={onClose} aria-label="Close inspector"><X size={17} /></button>
      </div>
      <div className="inspector-scroll">
        <section className="inspector-section">
          <h3><Settings2 size={14} /> General</h3>
          <TextField
            label="Name"
            value={node.data.label}
            onChange={(label) => onChange({ ...node, data: { ...node.data, label } })}
          />
          <TextField
            label="Description"
            value={node.data.description}
            onChange={(description) => onChange({ ...node, data: { ...node.data, description } })}
          />
        </section>
        <section className="inspector-section">
          <h3>Configuration</h3>
          {node.data.nodeType === "ai" && (
            <>
              <TextField label="Model" value={String(config.model ?? "")} onChange={(value) => setConfig("model", value)} />
              <TextField label="System prompt" multiline value={String(config.systemPrompt ?? "")} onChange={(value) => setConfig("systemPrompt", value)} />
              <TextField label="User prompt" multiline value={String(config.prompt ?? "")} onChange={(value) => setConfig("prompt", value)} />
              <label className="toggle-row">
                <span><strong>Web search</strong><small>OpenRouter search tool with citations</small></span>
                <input type="checkbox" checked={Boolean(config.webSearch)} onChange={(event) => setConfig("webSearch", event.target.checked)} />
              </label>
              {Boolean(config.webSearch) && (
                <label className="field">
                  <span>Maximum results</span>
                  <input type="number" min={1} max={10} value={Number(config.maxSearchResults ?? 5)} onChange={(event) => setConfig("maxSearchResults", Number(event.target.value))} />
                </label>
              )}
            </>
          )}
          {node.data.nodeType === "webhookTrigger" && (
            <TextField label="Webhook slug" value={String(config.slug ?? "")} onChange={(value) => setConfig("slug", value)} />
          )}
          {node.data.nodeType === "scheduleTrigger" && (
            <>
              <TextField label="Cron expression" value={String(config.cron ?? "")} onChange={(value) => setConfig("cron", value)} />
              <TextField label="Timezone" value={String(config.timezone ?? "")} onChange={(value) => setConfig("timezone", value)} />
            </>
          )}
          {node.data.nodeType === "http" && (
            <>
              <label className="field"><span>Method</span><select value={String(config.method ?? "GET")} onChange={(event) => setConfig("method", event.target.value)}><option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option></select></label>
              <TextField label="HTTPS URL" value={String(config.url ?? "")} onChange={(value) => setConfig("url", value)} />
              <TextField label="Headers (JSON)" multiline value={String(config.headers ?? "{}")} onChange={(value) => setConfig("headers", value)} />
              <TextField label="Body template" multiline value={String(config.body ?? "")} onChange={(value) => setConfig("body", value)} />
            </>
          )}
          {node.data.nodeType === "condition" && (
            <>
              <TextField label="Value path" value={String(config.path ?? "")} onChange={(value) => setConfig("path", value)} />
              <label className="field"><span>Operator</span><select value={String(config.operator ?? "equals")} onChange={(event) => setConfig("operator", event.target.value)}><option value="equals">Equals</option><option value="contains">Contains</option><option value="exists">Exists</option><option value="greaterThan">Greater than</option></select></label>
              <TextField label="Compare with" value={String(config.value ?? "")} onChange={(value) => setConfig("value", value)} />
            </>
          )}
          {node.data.nodeType === "transform" && (
            <TextField label="Output template" multiline value={String(config.template ?? "")} onChange={(value) => setConfig("template", value)} />
          )}
          {node.data.nodeType === "delay" && (
            <label className="field"><span>Seconds</span><input type="number" min={1} value={Number(config.seconds ?? 60)} onChange={(event) => setConfig("seconds", Number(event.target.value))} /></label>
          )}
          {node.data.nodeType === "approval" && (
            <TextField label="Approval prompt" multiline value={String(config.prompt ?? "")} onChange={(value) => setConfig("prompt", value)} />
          )}
          {node.data.nodeType === "output" && (
            <TextField label="Output name" value={String(config.outputName ?? "result")} onChange={(value) => setConfig("outputName", value)} />
          )}
          {node.data.nodeType === "manualTrigger" && <p className="empty-config">No configuration needed. Use Run workflow to start.</p>}
        </section>
        <section className="template-help">
          <strong>Dynamic values</strong>
          <p>Use <code>{"{{input.field}}"}</code> in prompts, bodies, and transforms.</p>
        </section>
      </div>
      <div className="inspector-actions">
        <button onClick={onDuplicate}><Copy size={15} /> Duplicate</button>
        <button className="danger" onClick={onDelete}><Trash2 size={15} /> Delete</button>
      </div>
    </aside>
  );
}
