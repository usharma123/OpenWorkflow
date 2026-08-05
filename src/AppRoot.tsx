import { AuthenticateWithRedirectCallback, ClerkProvider, useAuth } from "@clerk/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppGate } from "./AppGate";
import { WorkflowMark } from "./components/WorkflowMark";
import { convexClient } from "./lib/convexClient";

const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.trim();

export function AppRoot() {
  if (!clerkKey || !convexClient) {
    return (
      <main className="auth">
        <div className="auth-panel">
          <div className="auth-brand">
            <WorkflowMark size={20} />
            <span>OpenWorkflow</span>
          </div>
          <h1>Configuration required</h1>
          <p>
            Set <code>VITE_CLERK_PUBLISHABLE_KEY</code> and <code>VITE_CONVEX_URL</code>, then restart
            the dev server.
          </p>
          <p className="auth-fine">
            No authentication or connector access is attempted until both values are configured.
          </p>
        </div>
      </main>
    );
  }

  return (
    <BrowserRouter>
      <ClerkProvider
        publishableKey={clerkKey}
        signInFallbackRedirectUrl="/setup"
        signUpFallbackRedirectUrl="/setup"
      >
        <Routes>
          <Route
            path="/sso-callback"
            element={
              <AuthenticateWithRedirectCallback
                signInFallbackRedirectUrl="/setup"
                signUpFallbackRedirectUrl="/setup"
              />
            }
          />
          <Route
            path="*"
            element={
              <ConvexProviderWithClerk client={convexClient} useAuth={useAuth}>
                <AppGate />
              </ConvexProviderWithClerk>
            }
          />
        </Routes>
      </ClerkProvider>
    </BrowserRouter>
  );
}
