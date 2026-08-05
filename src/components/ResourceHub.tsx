import { ArrowRight, CalendarDays, Check, FileText, HelpCircle, LockKeyhole, Mail, MessageSquare, PlugZap, ShieldCheck, Sparkles, Users, X } from "lucide-react";
import { useState } from "react";
import { WORKFLOW_TEMPLATES } from "../catalog";
import type { ConnectionMetadata } from "../lib/convexClient";

export type HubTab = "templates" | "connectors" | "help";

interface ResourceHubProps {
  initialTab?: HubTab;
  onClose: () => void;
  onUseInboxTemplate: () => void;
  connections: ConnectionMetadata[];
  connectionBusy?: string;
  onConnectGoogle: () => void;
  onDisconnectGoogle: (externalId: string) => void;
  onConnectSlack: () => void;
  onDisconnectSlack: (externalId: string) => void;
}
const scopeLabel = (scope: string) => scope.replace("https://www.googleapis.com/auth/", "");

function ConnectionCard({ connection, busy, onReconnect, onDisconnect }: {
  connection: ConnectionMetadata;
  busy: boolean;
  onReconnect: () => void;
  onDisconnect: () => void;
}) {
  const needsAttention = connection.status === "needs_reauth";
  return (
    <article className={`connected-account ${needsAttention ? "needs-reauth" : ""}`}>
      <div>
        <strong>{connection.ownerLabel}</strong>
        <small>{connection.displayName}</small>
      </div>
      <span className={`connection-status ${connection.status}`}>{connection.status === "needs_reauth" ? "Reconnect required" : connection.status}</span>
      <p>{connection.scopes.length ? connection.scopes.map(scopeLabel).join(" · ") : "No connector scopes recorded"}</p>
      <div className="connection-actions">
        <button disabled={busy} onClick={onReconnect}>{needsAttention ? "Reauthorize" : "Reconnect"}</button>
        <button className="disconnect" disabled={busy} onClick={onDisconnect}>Disconnect</button>
      </div>
    </article>
  );
}

export function ResourceHub(props: ResourceHubProps) {
  const [tab, setTab] = useState<HubTab>(props.initialTab ?? "templates");
  const google = props.connections.filter((connection) => connection.provider === "google" && connection.status !== "disabled");
  const slack = props.connections.filter((connection) => connection.provider === "slack" && connection.status !== "disabled");
  return (
    <div className="hub-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && props.onClose()}>
      <section className="resource-hub" role="dialog" aria-modal="true" aria-label="Templates, connectors, and help">
        <header className="hub-header">
          <div><span className="hub-mark"><Sparkles size={18} /></span><span><strong>OpenWorkflow library</strong><small>Start quickly, then make it yours</small></span></div>
          <button className="icon-button" onClick={props.onClose} aria-label="Close library"><X size={18} /></button>
        </header>
        <nav className="hub-tabs">
          <button className={tab === "templates" ? "active" : ""} onClick={() => setTab("templates")}>Templates</button>
          <button className={tab === "connectors" ? "active" : ""} onClick={() => setTab("connectors")}>Connectors</button>
          <button className={tab === "help" ? "active" : ""} onClick={() => setTab("help")}>How it works</button>
        </nav>
        <div className="hub-content">
          {tab === "templates" && <><div className="hub-intro"><h2>Automations for everyday work</h2><p>Each template explains the outcome, the apps it needs, and where a person stays in control.</p></div><div className="template-grid">{WORKFLOW_TEMPLATES.map((template, index) => <article className={`template-card ${!template.ready ? "coming" : ""}`} key={template.id}><div className="template-card-top"><span>{index === 0 ? <Mail size={18} /> : index === 1 ? <CalendarDays size={18} /> : <MessageSquare size={18} />}</span><small>{template.ready ? "Ready with connections" : "Coming soon"}</small></div><h3>{template.name}</h3><p>{template.description}</p><footer><span>{template.timeSaved}</span>{template.ready && <button onClick={props.onUseInboxTemplate}>Use template <ArrowRight size={13} /></button>}</footer></article>)}</div></>}
          {tab === "connectors" && <>
            <div className="hub-intro"><h2>Your connected work apps</h2><p>Google grants stay in Clerk and are fetched fresh for every action. Slack bot tokens are encrypted server-side and never returned to this browser.</p></div>
            <section className="provider-section">
              <header><span className="connector-logo" style={{ color: "#4285f4" }}><FileText size={19} /></span><div><strong>Google Workspace</strong><small>Gmail read-only · create Google Docs · app-created Drive files</small></div><button disabled={props.connectionBusy === "google"} onClick={props.onConnectGoogle}><PlugZap size={13} /> {google.length ? "Add account" : "Connect Google"}</button></header>
              {google.length ? google.map((connection) => <ConnectionCard key={connection.externalId} connection={connection} busy={props.connectionBusy === connection.externalId} onReconnect={props.onConnectGoogle} onDisconnect={() => props.onDisconnectGoogle(connection.externalId)} />) : <p className="no-connection">Not connected. Connected-mode Gmail and Docs steps fail closed until an account grants all required scopes.</p>}
            </section>
            <section className="provider-section">
              <header><span className="connector-logo" style={{ color: "#36c5f0" }}><MessageSquare size={19} /></span><div><strong>Slack</strong><small>Post approved links with <code>chat:write</code></small></div><button disabled={props.connectionBusy === "slack"} onClick={props.onConnectSlack}><PlugZap size={13} /> {slack.length ? "Add workspace" : "Connect Slack"}</button></header>
              {slack.length ? slack.map((connection) => <ConnectionCard key={connection.externalId} connection={connection} busy={props.connectionBusy === connection.externalId} onReconnect={props.onConnectSlack} onDisconnect={() => props.onDisconnectSlack(connection.externalId)} />) : <p className="no-connection">Not connected. Slack connected mode requires an administrator-configured OAuth app and a channel ID.</p>}
            </section>
            <div className="unavailable-grid">
              <article><CalendarDays size={17} /><span><strong>Google Calendar</strong><small>Coming soon — no OAuth adapter yet</small></span></article>
              <article><Mail size={17} /><span><strong>Outlook</strong><small>Coming soon — no Microsoft OAuth path yet</small></span></article>
              <article><Users size={17} /><span><strong>Microsoft Teams</strong><small>Coming soon — no tenant connector yet</small></span></article>
            </div>
            <div className="security-note"><ShieldCheck size={19} /><span><strong>Least privilege and owner isolation</strong><small>Every workflow, run, approval, webhook, connection, and audit record is owner-bound. Missing, expired, or under-scoped grants stop execution and point back here.</small></span></div>
          </>}
          {tab === "help" && <><div className="hub-intro"><h2>A workflow is just a clear handoff</h2><p>Each card takes the result from the previous card, performs one understandable job, and passes the result on.</p></div><div className="help-steps"><article><span>1</span><div><strong>Choose an outcome</strong><p>Start with a template or add steps from the left.</p></div></article><article><span>2</span><div><strong>Connect your own accounts</strong><p>Connected steps select an account owned by your user or active organization.</p></div></article><article><span>3</span><div><strong>Use Safe demo deliberately</strong><p>Demo mode is clearly labeled and never reads or posts real company data.</p></div></article><article><span>4</span><div><strong>Keep people in control</strong><p>Approval pauses the durable run; rejection prevents Slack delivery.</p></div></article></div><div className="help-callout"><HelpCircle size={17} /><span><strong>What is live?</strong><small>Clerk sign-in, owner-isolated Convex persistence, Gmail reading, Docs creation, encrypted Slack OAuth, Luna through OpenRouter, durable approvals, and audit events. Calendar and Microsoft connectors are intentionally unavailable.</small></span></div><div className="guardrail-list"><span><Check size={13} /> Owner isolated</span><span><LockKeyhole size={13} /> Server-only tokens</span><span><ShieldCheck size={13} /> Fail-closed scopes</span></div></>}
        </div>
      </section>
    </div>
  );
}
