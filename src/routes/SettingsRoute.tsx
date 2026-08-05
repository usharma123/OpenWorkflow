import { SignOutButton, useUser } from "@clerk/react";
import { LogOut, ShieldCheck, User } from "lucide-react";
import { Link } from "react-router-dom";
import { GmailMark, SlackMark } from "../components/BrandMarks";
import { useConnections } from "../lib/connections";

export function SettingsRoute() {
  const { user } = useUser();
  const { google, slack } = useConnections();

  return (
    <div className="page">
      <div className="page-head">
        <h1>Settings</h1>
        <p>Your account and what OpenWorkflow is allowed to reach on your behalf.</p>
      </div>

      <section className="page-section">
        <span className="t-eyebrow">Account</span>
        <div className="row">
          <span className="row-mark">
            <User size={16} />
          </span>
          <span className="row-copy">
            <strong>{user?.fullName ?? user?.primaryEmailAddress?.emailAddress ?? "Signed in"}</strong>
            <small>{user?.primaryEmailAddress?.emailAddress}</small>
          </span>
          <span className="row-actions">
            <SignOutButton>
              <button className="btn btn-sm">
                <LogOut size={13} /> Sign out
              </button>
            </SignOutButton>
          </span>
        </div>
      </section>

      <section className="page-section">
        <span className="t-eyebrow">Connections</span>
        <div className="stack">
          <Link className="row" to="/connections">
            <span className="row-mark">
              <GmailMark size={16} />
            </span>
            <span className="row-copy">
              <strong>Google Workspace</strong>
              <small>
                {google.length
                  ? `${google.length} account${google.length === 1 ? "" : "s"} connected`
                  : "Not connected"}
              </small>
            </span>
            <span className="row-actions">
              <span className="badge">Manage</span>
            </span>
          </Link>
          <Link className="row" to="/connections">
            <span className="row-mark">
              <SlackMark size={16} />
            </span>
            <span className="row-copy">
              <strong>Slack</strong>
              <small>
                {slack.length
                  ? `${slack.length} workspace${slack.length === 1 ? "" : "s"} connected`
                  : "Not connected"}
              </small>
            </span>
            <span className="row-actions">
              <span className="badge">Manage</span>
            </span>
          </Link>
        </div>
      </section>

      <div className="note">
        <ShieldCheck size={15} />
        <span>
          <strong>What is stored</strong>
          Google account metadata is kept in Convex, but Google tokens are not — each action asks
          Clerk for a current token and verifies the exact scopes it needs.
        </span>
      </div>
    </div>
  );
}
