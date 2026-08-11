import { Plus, ShieldCheck } from "lucide-react";
import { GmailMark, SlackMark } from "../components/BrandMarks";
import { useConnections } from "../lib/connections";
import type { ConnectionMetadata } from "../lib/convexClient";

const STATUS_LABEL: Record<ConnectionMetadata["status"], string> = {
  active: "Connected",
  needs_reauth: "Reconnect required",
  disabled: "Disconnected",
};

const scopeLabel = (scope: string) => scope.replace("https://www.googleapis.com/auth/", "");

function ConnectionRow({
  connection,
  busy,
  onReconnect,
  onDisconnect,
}: {
  connection: ConnectionMetadata;
  busy: boolean;
  onReconnect: () => void;
  onDisconnect: () => void;
}) {
  const needsAttention = connection.status === "needs_reauth";
  const confirmDisconnect = () => {
    const consequence =
      connection.provider === "google"
        ? "Google stays available for sign-in, but workflow steps that use it will stop."
        : "The workspace is disabled and OpenWorkflow attempts to revoke its Slack token.";
    if (window.confirm(`Disconnect ${connection.ownerLabel}?\n\n${consequence}`)) onDisconnect();
  };

  return (
    <div className="row">
      <span className="row-mark">
        {connection.provider === "google" ? <GmailMark size={17} /> : <SlackMark size={17} />}
      </span>
      <span className="row-copy">
        <strong>{connection.ownerLabel}</strong>
        <small>
          {connection.scopes.length ? connection.scopes.map(scopeLabel).join(" · ") : connection.displayName}
        </small>
      </span>
      <span className="row-actions">
        <span className={`badge ${needsAttention ? "badge-danger" : ""}`}>{STATUS_LABEL[connection.status]}</span>
        <button className="btn btn-sm" disabled={busy} onClick={onReconnect}>
          {needsAttention ? "Reauthorize" : "Reconnect"}
        </button>
        <button className="btn btn-sm btn-danger" disabled={busy} onClick={confirmDisconnect}>
          Disconnect
        </button>
      </span>
    </div>
  );
}

export function ConnectionsRoute() {
  const { google, slack, busy, connectGoogle, disconnectGoogle, connectSlack, disconnectSlack } = useConnections();

  return (
    <div className="page">
      <div className="page-head">
        <h1>Connections</h1>
        <p>The accounts your steps are allowed to use.</p>
      </div>

      <section className="page-section">
        <span className="t-eyebrow">Google Workspace</span>
        <div className="stack">
          {google.map((connection) => (
            <ConnectionRow
              key={connection.externalId}
              connection={connection}
              busy={busy === connection.externalId}
              onReconnect={() => void connectGoogle()}
              onDisconnect={() => void disconnectGoogle(connection.externalId)}
            />
          ))}
          {google.length === 0 && (
            <div className="empty-state">
              <strong>No Google account connected</strong>
              Gmail and Google Docs steps will not run until one is.
            </div>
          )}
          <button className="btn" disabled={busy === "google"} onClick={() => void connectGoogle()}>
            <Plus size={14} /> {google.length ? "Add another account" : "Connect Google"}
          </button>
        </div>
      </section>

      <section className="page-section">
        <span className="t-eyebrow">Slack</span>
        <div className="stack">
          {slack.map((connection) => (
            <ConnectionRow
              key={connection.externalId}
              connection={connection}
              busy={busy === connection.externalId}
              onReconnect={() => void connectSlack()}
              onDisconnect={() => void disconnectSlack(connection.externalId)}
            />
          ))}
          {slack.length === 0 && (
            <div className="empty-state">
              <strong>No Slack workspace connected</strong>
              Approved briefs can still be created as documents.
            </div>
          )}
          <button className="btn" disabled={busy === "slack"} onClick={() => void connectSlack()}>
            <Plus size={14} /> {slack.length ? "Add another workspace" : "Connect Slack"}
          </button>
        </div>
      </section>

      <div className="note">
        <ShieldCheck size={15} />
        <span>
          <strong>Scoped to you</strong>
          Google grants stay in Clerk and Slack tokens are encrypted server-side. A missing or
          expired grant stops the run.
        </span>
      </div>
    </div>
  );
}
