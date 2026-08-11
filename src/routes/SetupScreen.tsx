import { Check, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GmailMark, SlackMark } from "../components/BrandMarks";
import { WorkflowMark } from "../components/WorkflowMark";
import { useConnections } from "../lib/connections";
import { convexClient, syncGoogleRef } from "../lib/convexClient";
import { markSetupSeen } from "../lib/setup";

/*
 * Post-sign-in confirmation. Clerk can grant the Workspace scopes during
 * sign-in when its Google connection is configured to request them. If it is
 * not, this screen falls back to a separate Google authorization flow.
 */
export function SetupScreen() {
  const navigate = useNavigate();
  const { google, slack, busy, connectGoogle, connectSlack, refresh } = useConnections();
  const [syncing, setSyncing] = useState(true);
  const synced = useRef(false);

  useEffect(() => {
    if (synced.current || !convexClient) {
      setSyncing(false);
      return;
    }
    synced.current = true;
    void convexClient
      .action(syncGoogleRef, {})
      .then(() => refresh())
      .catch(() => undefined)
      .finally(() => setSyncing(false));
  }, [refresh]);

  const googleAccount = google.find((connection) => connection.status === "active");
  const googleNeedsReauth = google.find((connection) => connection.status === "needs_reauth");
  const slackAccount = slack[0];

  const finish = () => {
    markSetupSeen();
    navigate("/workflow", { replace: true });
  };

  return (
    <main className="auth auth-single">
      <div className="auth-panel setup">
        <div className="auth-brand">
          <WorkflowMark size={20} />
          <span>OpenWorkflow</span>
        </div>

        <h1>{googleAccount ? "You're set up." : "Connect Google Workspace."}</h1>
        <p>
          {googleAccount
            ? slackAccount ? "Everything is connected." : "Slack is optional and can be added now or later."
            : "Your sign-in worked, but Gmail, Docs, and Drive access still needs approval."}
        </p>

        <div className="setup-list">
          <div className={`setup-item ${googleAccount ? "is-done" : ""}`}>
            <span className="setup-mark">
              <GmailMark size={18} />
            </span>
            <div>
              <strong>Google Workspace</strong>
              <small>
                {syncing
                  ? "Confirming your grant…"
                  : googleAccount
                    ? `${googleAccount.ownerLabel} · Gmail, Calendar, Drive, Docs, Sheets`
                    : "Not connected"}
              </small>
            </div>
            {syncing ? (
              <LoaderCircle className="spin" size={16} />
            ) : googleAccount ? (
              <span className="setup-check">
                <Check size={14} /> Connected
              </span>
            ) : (
              <button className="btn btn-sm" disabled={busy === "google"} onClick={() => void connectGoogle()}>
                {busy === "google" ? "Opening…" : googleNeedsReauth ? "Reauthorize" : "Connect"}
              </button>
            )}
          </div>

          <div className={`setup-item ${slackAccount ? "is-done" : ""}`}>
            <span className="setup-mark">
              <SlackMark size={18} />
            </span>
            <div>
              <strong>Slack</strong>
              <small>{slackAccount ? slackAccount.ownerLabel : "Post approved briefs to a channel"}</small>
            </div>
            {slackAccount ? (
              <span className="setup-check">
                <Check size={14} /> Connected
              </span>
            ) : (
              <button className="btn btn-sm" disabled={busy === "slack"} onClick={() => void connectSlack()}>
                {busy === "slack" ? "Opening…" : "Connect"}
              </button>
            )}
          </div>
        </div>

        <div className="setup-actions">
          {slackAccount && googleAccount ? (
            <span />
          ) : (
            <button className="setup-skip" onClick={finish}>
              {googleAccount ? "Skip Slack for now" : "Continue without Google"}
            </button>
          )}
          <button className="btn btn-primary btn-lg" onClick={finish}>
            Open workspace
          </button>
        </div>
      </div>
    </main>
  );
}
