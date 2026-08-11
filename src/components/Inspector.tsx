import { Copy, Pin, PinOff, Play, StepForward, Trash2 } from "lucide-react";
import { catalogByType } from "../catalog";
import type { ConnectionMetadata } from "../lib/convexClient";
import type { MappingSource } from "../lib/dataMapping";
import type { RunStepSummary, WorkflowNode } from "../types";
import { DataMapper } from "./DataMapper";
import { NodeMark } from "./icons";

interface InspectorProps {
  node: WorkflowNode;
  onChange: (node: WorkflowNode) => void;
  onPatchConfig: (updates: Record<string, unknown>, removeKeys?: string[]) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  connections: ConnectionMetadata[];
  onOpenConnectors: () => void;
  mappingSources: MappingSource[];
  latestStep?: RunStepSummary;
  running: boolean;
  onRunStep: (mode: "single" | "through") => void;
  onPinOutput: (output: unknown) => void;
  onUnpinOutput: () => void;
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

function InspectorConfiguration({
  node,
  onPatchConfig,
  connections,
  onOpenConnectors,
}: Pick<InspectorProps, "node" | "onPatchConfig" | "connections" | "onOpenConnectors">) {
  const config = node.data.config;
  const type = node.data.nodeType;
  const patchConfig = onPatchConfig;
  const set = (key: string, value: unknown) => patchConfig({ [key]: value });
  const str = (key: string, fallback = "") => String(config[key] ?? fallback);
  const computeOn = config.useCompute === true || (config.useCompute !== false && Boolean(config.mode));

  return (
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

        {type === "gmailEventTrigger" && (
          <>
            <Text
              label="Gmail search"
              value={str("query", "is:unread")}
              onChange={(v) => set("query", v)}
              placeholder="from:customer@example.com"
              hint="The workflow starts once for each newly arrived matching message."
            />
            <ConnectionField provider="google" value={str("connectionRef")} onChange={(v) => set("connectionRef", v)} connections={connections} onOpenConnectors={onOpenConnectors} />
          </>
        )}

        {type === "calendarTrigger" && (
          <>
            <Text label="Calendar ID" value={str("calendarId", "primary")} onChange={(v) => set("calendarId", v)} hint="Use primary or a calendar ID." />
            <ConnectionField provider="google" value={str("connectionRef")} onChange={(v) => set("connectionRef", v)} connections={connections} onOpenConnectors={onOpenConnectors} />
          </>
        )}

        {type === "driveTrigger" && (
          <>
            <Text label="Folder ID (optional)" value={str("folderId")} onChange={(v) => set("folderId", v)} hint="Leave blank to watch all visible Drive files." />
            <ConnectionField provider="google" value={str("connectionRef")} onChange={(v) => set("connectionRef", v)} connections={connections} onOpenConnectors={onOpenConnectors} />
          </>
        )}

        {type === "sheetsTrigger" && (
          <>
            <Text label="Spreadsheet ID" value={str("spreadsheetId")} onChange={(v) => set("spreadsheetId", v)} />
            <Text label="Range" value={str("range", "Sheet1!A:Z")} onChange={(v) => set("range", v)} hint="The first row is treated as column names." />
            <ConnectionField provider="google" value={str("connectionRef")} onChange={(v) => set("connectionRef", v)} connections={connections} onOpenConnectors={onOpenConnectors} />
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
              label="Role and style (optional)"
              multiline
              value={str("systemPrompt")}
              onChange={(v) => set("systemPrompt", v)}
              hint="Leave blank to use the default agent prompt."
            />
            <Text
              label="Instructions"
              multiline
              value={str("prompt")}
              onChange={(v) => set("prompt", v)}
              hint="Describe the outcome in plain language. The agent decides how to use compute. Insert earlier results with {{input}}."
            />
            <div className="chip-row" role="group" aria-label="Starter prompts">
              {[
                {
                  id: "deep-research",
                  label: "Deep research",
                  prompt:
                    "Research {{input.topic}} thoroughly. Compare competing views, cite sources, and write a concise brief with clear takeaways.",
                },
                {
                  id: "competitive",
                  label: "Competitive scan",
                  prompt:
                    "Run a competitive scan on {{input.topic}}. Summarize products, positioning, recent news, and open questions with citations.",
                },
                {
                  id: "analyze-rows",
                  label: "Analyze + dashboard",
                  prompt:
                    "Analyze these rows. Surface the top insights, write a cleaned table, and build an HTML KPI dashboard from {{input}}.",
                },
                {
                  id: "kpi-dashboard",
                  label: "KPI dashboard",
                  prompt:
                    "Build a KPI dashboard from {{input}}. Include summary metrics, a cleaned table, and a self-contained HTML dashboard.",
                },
              ].map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  className="chip"
                  onClick={() => patchConfig({ prompt: chip.prompt, useCompute: true }, ["mode"])}
                >
                  {chip.label}
                </button>
              ))}
            </div>
            <label className="switch-row">
              <span>
                <strong>Use compute</strong>
                <small>Lets the agent search, fetch, and run code in a secure sandbox when needed</small>
              </span>
              <input
                type="checkbox"
                checked={computeOn}
                onChange={(e) => patchConfig({ useCompute: e.target.checked }, ["mode"])}
              />
            </label>
            {computeOn && (
              <>
                <label className="switch-row">
                  <span>
                    <strong>Plan first</strong>
                    <small>The agent proposes a research plan and pauses for your review before executing</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={config.planFirst === true}
                    onChange={(e) => set("planFirst", e.target.checked)}
                  />
                </label>
                <Num
                  label="Maximum tool rounds"
                  value={Number(config.maxToolRounds ?? 12)}
                  onChange={(v) => set("maxToolRounds", v)}
                  min={1}
                  max={20}
                />
                <Num
                  label="Timeout (seconds)"
                  value={Number(config.timeoutSeconds ?? 220)}
                  onChange={(v) => set("timeoutSeconds", v)}
                  min={30}
                  max={220}
                />
              </>
            )}
            {!computeOn && (
              <label className="switch-row">
                <span>
                  <strong>Use web search</strong>
                  <small>Adds current web sources without a sandbox</small>
                </span>
                <input
                  type="checkbox"
                  checked={Boolean(config.webSearch)}
                  onChange={(e) => set("webSearch", e.target.checked)}
                />
              </label>
            )}
          </>
        )}

        {type === "webSearch" && (
          <>
            <Text
              label="Search query"
              value={str("query")}
              onChange={(v) => set("query", v)}
              placeholder="latest updates on {{input.content}}"
              hint="Insert earlier results with template expressions. Requires EXA_API_KEY in Convex."
            />
            <Num
              label="Maximum results"
              value={Number(config.numResults ?? 5)}
              onChange={(v) => set("numResults", v)}
              min={1}
              max={10}
            />
            <label className="switch-row">
              <span>
                <strong>Include page text</strong>
                <small>Adds a snippet of each page so later steps can quote it</small>
              </span>
              <input
                type="checkbox"
                checked={config.includeText !== false}
                onChange={(e) => set("includeText", e.target.checked)}
              />
            </label>
          </>
        )}

        {type === "gmailSend" && (
          <>
            <Text
              label="To"
              value={str("to")}
              onChange={(v) => set("to", v)}
              placeholder="person@example.com"
            />
            <Text label="Subject" value={str("subject")} onChange={(v) => set("subject", v)} />
            <Text
              label="Body"
              multiline
              value={str("body")}
              onChange={(v) => set("body", v)}
              hint="Insert earlier results with {{input.content}}."
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

        {type === "calendarEvent" && (
          <>
            <Text label="Calendar ID" value={str("calendarId", "primary")} onChange={(v) => set("calendarId", v)} hint="Use primary or a calendar ID." />
            <Text label="Event title" value={str("title")} onChange={(v) => set("title", v)} />
            <Text label="Event description" multiline value={str("description")} onChange={(v) => set("description", v)} />
            <Text
              label="Start time (ISO)"
              value={str("startIso")}
              onChange={(v) => set("startIso", v)}
              placeholder="2026-08-11T15:00:00Z"
              hint="Leave blank to schedule one hour from now."
            />
            <Num
              label="Duration (minutes)"
              value={Number(config.durationMinutes ?? 30)}
              onChange={(v) => set("durationMinutes", v)}
              min={5}
              max={1440}
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

        {type === "sheetsAppend" && (
          <>
            <Text label="Spreadsheet ID" value={str("spreadsheetId")} onChange={(v) => set("spreadsheetId", v)} />
            <Text label="Range" value={str("range", "Sheet1!A:Z")} onChange={(v) => set("range", v)} hint="The row is appended after the last row of this range." />
            <Text
              label="Row values"
              multiline
              value={str("values")}
              onChange={(v) => set("values", v)}
              placeholder='Acme, renewed, {{input.date}}'
              hint="Separate cells with commas, or provide a JSON array."
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

        {type === "driveUpload" && (
          <>
            <Text label="File name" value={str("fileName", "openworkflow-result.txt")} onChange={(v) => set("fileName", v)} />
            <Text
              label="File content"
              multiline
              value={str("content")}
              onChange={(v) => set("content", v)}
              hint="Leave blank to save the full input as JSON."
            />
            <Text label="Folder (optional)" value={str("folder")} onChange={(v) => set("folder", v)} hint="Created in Drive when it does not exist yet." />
            <ConnectionField
              provider="google"
              value={str("connectionRef")}
              onChange={(v) => set("connectionRef", v)}
              connections={connections}
              onOpenConnectors={onOpenConnectors}
            />
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

        {type === "daytonaSandbox" && (
          <>
            <label className="field">
              <span>Runtime language</span>
              <select value={str("language", "typescript")} onChange={(e) => set("language", e.target.value)}>
                <option value="typescript">TypeScript</option>
                <option value="javascript">JavaScript</option>
                <option value="python">Python</option>
              </select>
            </label>
            <Text
              label="Snapshot (optional)"
              value={str("snapshot")}
              onChange={(v) => set("snapshot", v)}
              placeholder="Prebuilt Daytona snapshot name"
            />
            <label className="field">
              <span>Outbound network</span>
              <select value={str("networkMode", "blocked")} onChange={(e) => set("networkMode", e.target.value)}>
                <option value="blocked">Block all</option>
                <option value="allowlist">Allow listed domains</option>
              </select>
            </label>
            {str("networkMode", "blocked") === "allowlist" && (
              <Text
                label="Allowed domains"
                value={str("allowedDomains")}
                onChange={(v) => set("allowedDomains", v)}
                placeholder="github.com,*.githubusercontent.com"
                hint="Comma-separated hostnames only. Credentials are not copied into the sandbox."
              />
            )}
            <Num
              label="Maximum lifetime (minutes)"
              value={Number(config.ttlMinutes ?? 30)}
              onChange={(v) => set("ttlMinutes", v)}
              min={5}
              max={240}
            />
          </>
        )}

        {type === "code" && (
          <>
            <Text
              label="Code"
              multiline
              value={str("code")}
              onChange={(v) => set("code", v)}
              hint="Read JSON input from OPENWORKFLOW_INPUT. Print JSON to return a structured value."
            />
            <Num
              label="Timeout (seconds)"
              value={Number(config.timeoutSeconds ?? 60)}
              onChange={(v) => set("timeoutSeconds", v)}
              min={1}
              max={900}
            />
          </>
        )}

        {type === "shell" && (
          <>
            <Text label="Command" multiline value={str("command")} onChange={(v) => set("command", v)} />
            <Text
              label="Working directory"
              value={str("workingDirectory", "workspace")}
              onChange={(v) => set("workingDirectory", v)}
              hint="Relative path inside the shared sandbox filesystem."
            />
            <Num
              label="Timeout (seconds)"
              value={Number(config.timeoutSeconds ?? 60)}
              onChange={(v) => set("timeoutSeconds", v)}
              min={1}
              max={900}
            />
          </>
        )}

        {type === "git" && (
          <>
            <Text
              label="Repository URL"
              value={str("repositoryUrl")}
              onChange={(v) => set("repositoryUrl", v)}
              placeholder="https://github.com/org/repository.git"
              hint="Public HTTPS repositories only in this first version. Add the host to the boundary allowlist."
            />
            <Text label="Directory" value={str("directory", "workspace/repository")} onChange={(v) => set("directory", v)} />
            <Text label="Branch (optional)" value={str("branch")} onChange={(v) => set("branch", v)} />
            <Num
              label="Clone depth"
              value={Number(config.depth ?? 1)}
              onChange={(v) => set("depth", v)}
              min={1}
              max={1000}
            />
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

        {type === "forEach" && (
          <>
            <Text
              label="List path"
              value={str("path", "items")}
              onChange={(v) => set("path", v)}
              hint="Use a dotted path such as messages. Leave blank when the input itself is a list."
            />
            <Text
              label="Template for each item"
              multiline
              value={str("template", "{{input}}")}
              onChange={(v) => set("template", v)}
              hint="The template runs once per item and cannot execute code."
            />
          </>
        )}

        {type === "merge" && (
          <label className="field">
            <span>Merge mode</span>
            <select value={str("mode", "append")} onChange={(e) => set("mode", e.target.value)}>
              <option value="append">Append items</option>
              <option value="combine">Combine object fields</option>
              <option value="first">Use first result</option>
            </select>
            <span className="field-hint">The step waits for every connected branch that produced a result.</span>
          </label>
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
  );
}

export function Inspector({
  node,
  onChange,
  onPatchConfig,
  onDelete,
  onDuplicate,
  connections,
  onOpenConnectors,
  mappingSources,
  latestStep,
  running,
  onRunStep,
  onPinOutput,
  onUnpinOutput,
}: InspectorProps) {
  const item = catalogByType[node.data.nodeType];
  const config = node.data.config;
  const type = node.data.nodeType;
  const computeOn = config.useCompute === true || (config.useCompute !== false && Boolean(config.mode));
  const set = (key: string, value: unknown) => onPatchConfig({ [key]: value });

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

      <InspectorConfiguration
        node={node}
        onPatchConfig={onPatchConfig}
        connections={connections}
        onOpenConnectors={onOpenConnectors}
      />

      <DataMapper
        key={`${node.id}:${node.data.nodeType}`}
        node={node}
        sources={mappingSources}
        onChange={onChange}
      />

      {type !== "daytonaSandbox" && (
        <section className="inspector-section step-testing">
          <div className="mapper-heading">
            <span className="t-eyebrow">Test step</span>
            {Object.prototype.hasOwnProperty.call(config, "pinnedOutput") && <span className="badge">Pinned</span>}
          </div>
          <p className="mapper-help">Run only this step with pinned inputs, or execute everything leading to it.</p>
          <div className="step-testing-actions">
            <button className="btn" disabled={running} onClick={() => onRunStep("single")}>
              <Play size={13} /> Run this step
            </button>
            <button className="btn" disabled={running} onClick={() => onRunStep("through")}>
              <StepForward size={13} /> Run through here
            </button>
          </div>
          {Object.prototype.hasOwnProperty.call(config, "pinnedOutput") ? (
            <button className="link-btn step-pin" type="button" onClick={onUnpinOutput}>
              <PinOff size={12} /> Unpin sample output
            </button>
          ) : latestStep?.status === "completed" && latestStep.output !== undefined ? (
            <button className="link-btn step-pin" type="button" onClick={() => onPinOutput(latestStep.output)}>
              <Pin size={12} /> Pin latest output as sample data
            </button>
          ) : null}
        </section>
      )}

      {!type.endsWith("Trigger") && !["condition", "output", "daytonaSandbox"].includes(type) && (
        <section className="inspector-section">
          <label className="switch-row">
            <span>
              <strong>Route failures to an error branch</strong>
              <small>Adds an error output you can connect to recovery steps</small>
            </span>
            <input
              type="checkbox"
              checked={config.errorOutput === true}
              onChange={(e) => set("errorOutput", e.target.checked)}
            />
          </label>
        </section>
      )}

      {!type.endsWith("Trigger") && !["approval", "delay", "output", "daytonaSandbox", "googleDoc", "slack", "gmailSend", "calendarEvent", "sheetsAppend", "driveUpload"].includes(type) && (
        <section className="inspector-section">
          <span className="t-eyebrow">Reliability</span>
          {type === "ai" && computeOn ? (
            <p className="t-small t-muted">
              Long-running agents stop with a checkpoint before the action limit. Completed subagents are reused instead of restarting the whole step.
            </p>
          ) : (
            <>
              <Num
                label="Retries after failure"
                value={Number(config.retryAttempts ?? 2)}
                onChange={(value) => set("retryAttempts", value)}
                min={0}
                max={5}
              />
              <Num
                label="Initial retry delay (ms)"
                value={Number(config.retryBackoffMs ?? 250)}
                onChange={(value) => set("retryBackoffMs", value)}
                min={100}
                max={60000}
              />
            </>
          )}
          {["http", "ai"].includes(type) && !(type === "ai" && computeOn) && (
            <Num
              label="Timeout (seconds)"
              value={Number(config.timeoutSeconds ?? (type === "ai" ? 120 : 30))}
              onChange={(value) => set("timeoutSeconds", value)}
              min={1}
              max={900}
            />
          )}
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
