import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ReactFlowProvider } from "@xyflow/react";
import { AuthenticateWithRedirectCallback, ClerkProvider, SignIn, useAuth } from "@clerk/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useConvexAuth } from "convex/react";
import "@xyflow/react/dist/style.css";
import "./styles.css";
import App from "./App";
import { convexClient } from "./lib/convexClient";

const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.trim();

function SetupRequired() {
  return (
    <main className="auth-shell">
      <section className="setup-card">
        <span className="setup-kicker">Configuration required</span>
        <h1>Connect Clerk and Convex</h1>
        <p>Set <code>VITE_CLERK_PUBLISHABLE_KEY</code> and <code>VITE_CONVEX_URL</code>, then restart the Vite server.</p>
        <small>No authentication or connector access is attempted until both values are configured.</small>
      </section>
    </main>
  );
}

function AppGate() {
  const { isLoaded, isSignedIn } = useAuth();
  const { isAuthenticated, isLoading } = useConvexAuth();
  if (!isLoaded || isLoading) return <main className="auth-shell"><div className="auth-loading">Establishing a secure session…</div></main>;
  if (!isSignedIn) return <main className="auth-shell"><SignIn routing="hash" /></main>;
  if (!isAuthenticated) return <main className="auth-shell"><div className="auth-loading">Convex could not validate this Clerk session. Check the Clerk Convex integration and issuer domain.</div></main>;
  return <ReactFlowProvider><App /></ReactFlowProvider>;
}

function Root() {
  if (!clerkKey || !convexClient) return <SetupRequired />;
  if (window.location.pathname === "/sso-callback") {
    return (
      <ClerkProvider publishableKey={clerkKey}>
        <AuthenticateWithRedirectCallback signInFallbackRedirectUrl="/?integration=google&status=connected" signUpFallbackRedirectUrl="/?integration=google&status=connected" />
      </ClerkProvider>
    );
  }
  return (
    <ClerkProvider publishableKey={clerkKey}>
      <ConvexProviderWithClerk client={convexClient} useAuth={useAuth}>
        <AppGate />
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Root /></StrictMode>);
