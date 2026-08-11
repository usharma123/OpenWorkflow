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
      <div className="auth-side">
        <div className="auth-brand">
          <WorkflowMark size={20} />
          <span>OpenWorkflow</span>
        </div>

        <div className="auth-panel">
          <h1>Build agents on a canvas.</h1>
          <p>Drag in triggers, models and tools. Run it and watch every step.</p>

          <button className="btn btn-primary auth-google" onClick={() => void start()} disabled={busy || !signIn}>
            <GoogleMark size={18} />
            {busy ? "Opening Google…" : "Continue with Google"}
          </button>

          {error && <p className="auth-error">{error}</p>}

          <p className="auth-fine">Gmail, Docs and Slack connect later, only if a step needs them.</p>
        </div>

        <p className="auth-foot">Google sign-in only</p>
      </div>

      <CanvasPreview />
    </main>
  );
}

/*
 * A still frame of the editor. It is decorative, so it is a plain SVG rather
 * than a real React Flow instance: no runtime cost before sign-in.
 */
function CanvasPreview() {
  return (
    <div className="auth-preview" aria-hidden>
      <svg viewBox="0 0 520 420" role="presentation">
        <path className="auth-wire" d="M170 96 C 214 96 226 190 270 190" />
        <path className="auth-wire" d="M170 190 C 214 190 226 190 270 190" />
        <path className="auth-wire" d="M400 190 C 430 190 438 300 470 300" />
        <path className="auth-wire is-dim" d="M400 190 C 430 190 438 96 470 96" />

        <PreviewNode x={30} y={72} accent="var(--cat-start)" title="Gmail" sub="New message" />
        <PreviewNode x={30} y={166} accent="var(--cat-start)" title="Schedule" sub="Weekdays 9:00" />
        <PreviewNode x={270} y={166} accent="var(--cat-think)" title="Agent" sub="Summarize" wide />
        <PreviewNode x={470} y={72} accent="var(--cat-review)" title="Approve" sub="" compact />
        <PreviewNode x={470} y={276} accent="var(--cat-deliver)" title="Slack" sub="" compact />
      </svg>
    </div>
  );
}

function PreviewNode({
  x,
  y,
  accent,
  title,
  sub,
  wide,
  compact,
}: {
  x: number;
  y: number;
  accent: string;
  title: string;
  sub: string;
  wide?: boolean;
  compact?: boolean;
}) {
  const width = compact ? 90 : wide ? 130 : 140;
  return (
    <g className="auth-node" transform={`translate(${x} ${y})`}>
      <rect width={width} height={48} rx={9} />
      <rect className="auth-node-rail" width={3} height={48} rx={1.5} fill={accent} />
      <circle className="auth-node-dot" cx={20} cy={24} r={4} fill={accent} />
      <text className="auth-node-title" x={34} y={sub ? 21 : 28}>
        {title}
      </text>
      {sub && (
        <text className="auth-node-sub" x={34} y={35}>
          {sub}
        </text>
      )}
    </g>
  );
}
