import { Copy, Trash2 } from "lucide-react";
import { catalogByType } from "../catalog";
import type { ConnectionMetadata } from "../lib/convexClient";
import type { WorkflowNode } from "../types";
import { NodeMark } from "./icons";

interface InspectorProps {
  node: WorkflowNode;
  onChange: (node: WorkflowNode) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  connections: ConnectionMetadata[];
  onOpenConnectors: () => void;
}

function Text({
  label,
  value,
  onChange,
  multiline = false,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {multiline ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={5} />
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      )}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

function Num({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const raw = e.currentTarget.value;
          if (raw === "") return;
          const parsed = Number(raw);
          if (!Number.isFinite(parsed)) return;
          const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, Math.trunc(parsed)));
          onChange(clamped);
        }}
      />
    </label>
  );
}

function ConnectionField({
  provider,
  value,
  onChange,
  connections,
  onOpenConnectors,
}: {
  provider: "google" | "slack";
  value: string;
  onChange: (value: string) => void;
  connections: ConnectionMetadata[];
  onOpenConnectors: () => void;
}) {
  const available = connections.filter((c) => c.provider === provider && c.status === "active");
  const selected = available.some((c) => c.externalId === value) ? value : "";
  const id = `connection-${provider}`;
  return (
    <div className="field">
      <label htmlFor={id}>Account</label>
      <select id={id} value={selected} onChange={(e) => onChange(e.target.value)}>
        <option value="">{available.length ? "Choose an account…" : "No active connection"}</option>
        {available.map((c) => (
          <option key={c.externalId} value={c.externalId}>
            {c.ownerLabel}
          </option>
        ))}
      </select>
      {value && !selected && (
        <span className="field-hint">
          The account this step used is no longer active. Choose another before running.
        </span>
      )}
      <button type="button" className="link-btn" onClick={onOpenConnectors}>
        {available.length ? "Manage connections" : `Connect ${provider === "google" ? "Google" : "Slack"}`}
      </button>
    </div>
  );
}

export function Inspector({
  node,
  onChange,
  onDelete,
  onDuplicate,
  connections,
  onOpenConnectors,
}: InspectorProps) {
  const item = catalogByType[node.data.nodeType];
  const config = node.data.config;
  const type = node.data.nodeType;
  const set = (key: string, value: unknown) =>
    onChange({ ...node, data: { ...node.data, config: { ...config, [key]: value } } });
  const str = (key: string, fallback = "") => String(config[key] ?? fallback);

  return (
    <div className="inspector">
      <div className="inspector-identity">
        <span className="inspector-mark">
          <NodeMark type={type} size={18} />
        </span>
        <span>
          <strong className="t-heading">{item.label}</strong>
          <span className="t-small t-muted">{item.outcome}</span>
        </span>
      </div>

      <section className="inspector-section">
        <span className="t-eyebrow">Step</span>
        <Text
          label="Name"
          value={node.data.label}
          onChange={(label) => onChange({ ...node, data: { ...node.data, label } })}
        />
        <Text
          label="Description"
          value={node.data.description}
          onChange={(description) => onChange({ ...node, data: { ...node.data, description } })}
        />
      </section>

      <section className="inspector-section">
        <span className="t-eyebrow">Configuration</span>

        {type === "gmailTrigger" && (
          <>
            <Text
              label="Which emails to include"
              value={str("search", "")}
              onChange={(v) => set("search", v)}
              placeholder="is:unread newer_than:1d"
              hint="Standard Gmail search syntax."
            />
            <Num
              label="Maximum emails"
              value={Number(config.maxMessages ?? 5)}
              onChange={(v) => set("maxMessages", v)}
              min={1}
              max={25}
            />
            <ConnectionField
              provider="google"
              value={str("connectionRef")}
              onChange={(v) => set("connectionRef", v)}
              connections={connections}
              onOpenConnectors={onOpenConnectors}
            />
          </>
        )}

        {type === "ai" && (
          <>
            <label className="field">
              <span>Model</span>
              <select value={str("model", "openai/gpt-5.6-luna")} onChange={(e) => set("model", e.target.value)}>
                <option value="openai/gpt-5.6-luna">GPT-5.6 Luna (OpenRouter)</option>
              </select>
            </label>
            <Text
              label="Role and style"
              multiline
              value={str("systemPrompt")}
              onChange={(v) => set("systemPrompt", v)}
            />
            <Text
              label="Instructions"
              multiline
              value={str("prompt")}
              onChange={(v) => set("prompt", v)}
              hint="Insert earlier results with {{input.messages}}."
            />
            <label className="switch-row">
              <span>
                <strong>Use web search</strong>
                <small>Adds current web sources when the model needs them</small>
              </span>
              <input
                type="checkbox"
                checked={Boolean(config.webSearch)}
                onChange={(e) => set("webSearch", e.target.checked)}
              />
            </label>
            {Boolean(config.webSearch) && (
              <Num
                label="Maximum sources"
                value={Number(config.maxSearchResults ?? 5)}
                onChange={(v) => set("maxSearchResults", v)}
                min={1}
                max={10}
              />
            )}
          </>
        )}

        {type === "googleDoc" && (
          <>
            <Text label="Document title" value={str("title")} onChange={(v) => set("title", v)} />
            <Text label="Folder" value={str("folder")} onChange={(v) => set("folder", v)} />
            <ConnectionField
              provider="google"
              value={str("connectionRef")}
              onChange={(v) => set("connectionRef", v)}
              connections={connections}
              onOpenConnectors={onOpenConnectors}
            />
          </>
        )}

        {type === "slack" && (
          <>
            <Text
              label="Channel ID"
              value={str("channel")}
              onChange={(v) => set("channel", v)}
              placeholder="C0123456789"
            />
            <Text label="Message" multiline value={str("message")} onChange={(v) => set("message", v)} />
            <ConnectionField
              provider="slack"
              value={str("connectionRef")}
              onChange={(v) => set("connectionRef", v)}
              connections={connections}
              onOpenConnectors={onOpenConnectors}
            />
          </>
        )}

        {type === "webhookTrigger" && (
          <Text label="URL name" value={str("slug")} onChange={(v) => set("slug", v)} />
        )}

        {type === "scheduleTrigger" && (
          <>
            <Text label="Schedule" value={str("cron")} onChange={(v) => set("cron", v)} hint="Cron expression." />
            <Text label="Timezone" value={str("timezone")} onChange={(v) => set("timezone", v)} />
          </>
        )}

        {type === "http" && (
          <>
            <label className="field">
              <span>Method</span>
              <select value={str("method", "GET")} onChange={(e) => set("method", e.target.value)}>
                <option>GET</option>
                <option>POST</option>
                <option>PUT</option>
                <option>PATCH</option>
                <option>DELETE</option>
              </select>
            </label>
            <Text label="HTTPS URL" value={str("url")} onChange={(v) => set("url", v)} />
            <Text label="Headers (JSON)" multiline value={str("headers", "{}")} onChange={(v) => set("headers", v)} />
            <Text label="Body" multiline value={str("body")} onChange={(v) => set("body", v)} />
          </>
        )}

        {type === "condition" && (
          <>
            <Text label="Value to check" value={str("path")} onChange={(v) => set("path", v)} />
            <label className="field">
              <span>Rule</span>
              <select value={str("operator", "equals")} onChange={(e) => set("operator", e.target.value)}>
                <option value="equals">Equals</option>
                <option value="contains">Contains</option>
                <option value="exists">Has a value</option>
                <option value="greaterThan">Is greater than</option>
              </select>
            </label>
            <Text label="Compare with" value={str("value")} onChange={(v) => set("value", v)} />
          </>
        )}

        {type === "transform" && (
          <Text label="Template" multiline value={str("template")} onChange={(v) => set("template", v)} />
        )}

        {type === "delay" && (
          <Num
            label="Wait time (seconds)"
            value={Number(config.seconds ?? 60)}
            onChange={(v) => set("seconds", v)}
            min={1}
          />
        )}

        {type === "approval" && (
          <>
            <Text
              label="Question for the reviewer"
              multiline
              value={str("prompt")}
              onChange={(v) => set("prompt", v)}
            />
            <Text label="Reviewer" value={str("approver")} onChange={(v) => set("approver", v)} />
          </>
        )}

        {type === "output" && (
          <Text label="Result name" value={str("outputName", "result")} onChange={(v) => set("outputName", v)} />
        )}

        {type === "manualTrigger" && (
          <p className="t-small t-muted">Nothing to configure. Run the workflow when you are ready.</p>
        )}
      </section>

      {/*
        Live is the default and reads as unremarkable. Demo is a quiet opt-out
        rather than a mode the whole interface announces.
      */}
      {item.setup === "connection" && (
        <section className="inspector-section">
          <label className="switch-row">
            <span>
              <strong>Run against sample data</strong>
              <small>Skips the real account and returns a fixed example</small>
            </span>
            <input
              type="checkbox"
              checked={config.executionMode !== "live"}
              onChange={(e) => set("executionMode", e.target.checked ? "demo" : "live")}
            />
          </label>
        </section>
      )}

      <div className="inspector-actions">
        <button className="btn" onClick={onDuplicate}>
          <Copy size={14} /> Duplicate
        </button>
        <button className="btn btn-danger" onClick={onDelete}>
          <Trash2 size={14} /> Delete
        </button>
      </div>
    </div>
  );
}
