import { useSignIn } from "@clerk/react";
import { useState } from "react";
import { GoogleMark } from "../components/BrandMarks";
import { WorkflowMark } from "../components/WorkflowMark";

/*
 * One method, one button. When Clerk's Google connection is configured with
 * the Workspace scopes, the sign-in consent also supplies the connector grant.
 * Setup provides a separate authorization fallback when it does not.
 */
export function SignInScreen() {
  const { signIn } = useSignIn();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const start = async () => {
    if (!signIn) return;
    setBusy(true);
    setError(undefined);
    try {
      const { error: cause } = await signIn.sso({
        strategy: "oauth_google",
        redirectUrl: "/setup",
        redirectCallbackUrl: `${window.location.origin}/sso-callback`,
        oidcPrompt: "consent",
      });
      if (cause) throw new Error(cause.message ?? "Google sign-in was rejected.");
    } catch (cause) {
      setBusy(false);
      setError(cause instanceof Error ? cause.message : "Google sign-in could not be started.");
    }
  };

  return (
    <main className="auth">
      <div className="auth-panel">
        <div className="auth-brand">
          <WorkflowMark size={20} />
          <span>OpenWorkflow</span>
        </div>
        <h1>Build agents that think, act, and stay under your control.</h1>
        <p>Connect models, tools, data, and human approvals in a visual workflow.</p>

        <button className="btn btn-primary auth-google" onClick={() => void start()} disabled={busy || !signIn}>
          <GoogleMark size={18} />
          {busy ? "Opening Google…" : "Continue with Google"}
        </button>

        {error && <p className="auth-error">{error}</p>}

        <p className="auth-fine">
          OpenWorkflow is a visual agent builder. Gmail, Google Docs, and Slack are optional tools;
          agents only use the accounts and actions you configure.
        </p>
      </div>
    </main>
  );
}
