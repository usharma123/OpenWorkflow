import { ArrowRight, CalendarDays, Check, FileText, HelpCircle, LockKeyhole, Mail, MessageSquare, ShieldCheck, Sparkles, Users, X } from "lucide-react";
import { useState } from "react";
import { WORKFLOW_TEMPLATES } from "../catalog";

export type HubTab = "templates" | "connectors" | "help";

const connectors = [
  { name: "Gmail", icon: Mail, color: "#ef4444", state: "POC ready", scopes: "Read email metadata and content", implementation: "Live adapter + safe demo" },
  { name: "Google Docs & Drive", icon: FileText, color: "#4285f4", state: "POC ready", scopes: "Create documents in an approved folder", implementation: "Live adapter + safe demo" },
  { name: "Slack", icon: MessageSquare, color: "#36c5f0", state: "POC ready", scopes: "Post messages to approved channels", implementation: "Live adapter + safe demo" },
  { name: "Google Calendar", icon: CalendarDays, color: "#34a853", state: "Architecture ready", scopes: "Read selected calendars", implementation: "Discovery only in this slice" },
  { name: "Outlook", icon: Mail, color: "#0078d4", state: "Architecture ready", scopes: "Read mail and create drafts", implementation: "Discovery only in this slice" },
  { name: "Microsoft Teams", icon: Users, color: "#6264a7", state: "Architecture ready", scopes: "Post to approved teams and channels", implementation: "Discovery only in this slice" },
];

interface ResourceHubProps {
  initialTab?: HubTab;
  onClose: () => void;
  onUseInboxTemplate: () => void;
}

export function ResourceHub({ initialTab = "templates", onClose, onUseInboxTemplate }: ResourceHubProps) {
  const [tab, setTab] = useState<HubTab>(initialTab);
  return (
    <div className="hub-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="resource-hub" role="dialog" aria-modal="true" aria-label="Templates, connectors, and help">
        <header className="hub-header">
          <div><span className="hub-mark"><Sparkles size={18} /></span><span><strong>OpenWorkflow library</strong><small>Start quickly, then make it yours</small></span></div>
          <button className="icon-button" onClick={onClose} aria-label="Close library"><X size={18} /></button>
        </header>
        <nav className="hub-tabs">
          <button className={tab === "templates" ? "active" : ""} onClick={() => setTab("templates")}>Templates</button>
          <button className={tab === "connectors" ? "active" : ""} onClick={() => setTab("connectors")}>Connectors</button>
          <button className={tab === "help" ? "active" : ""} onClick={() => setTab("help")}>How it works</button>
        </nav>
        <div className="hub-content">
          {tab === "templates" && <><div className="hub-intro"><h2>Automations for everyday work</h2><p>Each template explains the outcome, the apps it needs, and where a person stays in control.</p></div><div className="template-grid">{WORKFLOW_TEMPLATES.map((template, index) => <article className={`template-card ${!template.ready ? "coming" : ""}`} key={template.id}><div className="template-card-top"><span>{index === 0 ? <Mail size={18} /> : index === 1 ? <CalendarDays size={18} /> : <MessageSquare size={18} />}</span><small>{template.ready ? "Ready to use" : "Coming next"}</small></div><h3>{template.name}</h3><p>{template.description}</p><footer><span>{template.timeSaved}</span>{template.ready && <button onClick={onUseInboxTemplate}>Use template <ArrowRight size={13} /></button>}</footer></article>)}</div></>}
          {tab === "connectors" && <><div className="hub-intro"><h2>Connect work apps safely</h2><p>Workflows refer to approved connections by name. Tokens stay out of the browser and every connector use is auditable.</p></div><div className="connector-list">{connectors.map(({ name, icon: Icon, color, state, scopes, implementation }) => <article className="connector-row" key={name}><span className="connector-logo" style={{ color }}><Icon size={19} /></span><span><strong>{name}</strong><small>{scopes}</small></span><span className={state === "POC ready" ? "connector-ready" : "connector-planned"}>{state}</span><small>{implementation}</small></article>)}</div><div className="security-note"><ShieldCheck size={19} /><span><strong>Least privilege by design</strong><small>Connections declare their provider, approved scopes, status, and owner. Workflow steps never store raw credentials; production OAuth tokens belong in an encrypted vault.</small></span></div></>}
          {tab === "help" && <><div className="hub-intro"><h2>A workflow is just a clear handoff</h2><p>Each card takes the result from the previous card, performs one understandable job, and passes the result on.</p></div><div className="help-steps"><article><span>1</span><div><strong>Choose an outcome</strong><p>Start with a template or add steps from the left. The card subtitle says what the business gets.</p></div></article><article><span>2</span><div><strong>Use safe connections</strong><p>Pick an approved connection. Credentials are resolved in Convex and are never saved in the canvas or browser.</p></div></article><article><span>3</span><div><strong>Test with sample data</strong><p>Safe demo mode shows the complete experience without reading or posting real company data.</p></div></article><article><span>4</span><div><strong>Keep people in control</strong><p>An approval step pauses the durable run. Approve or reject with an optional note before sharing.</p></div></article></div><div className="help-callout"><HelpCircle size={17} /><span><strong>What is live in this POC?</strong><small>Convex persistence, durable execution, Luna through OpenRouter, approvals, audit events, and the Gmail/Docs/Slack adapters. OAuth onboarding and production token vaulting are intentionally represented by named connection references.</small></span></div><div className="guardrail-list"><span><Check size={13} /> No arbitrary code</span><span><LockKeyhole size={13} /> Server-side secrets</span><span><ShieldCheck size={13} /> Audited connector use</span></div></>}
        </div>
      </section>
    </div>
  );
}
