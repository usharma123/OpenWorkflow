import { lazy, Suspense } from "react";
import { useAuth } from "@clerk/react";
import { useConvexAuth } from "convex/react";
import { AppLoading } from "./components/AppLoading";
import { SignInScreen } from "./routes/SignInScreen";

const AuthedApp = lazy(() => import("./AuthedApp"));

export function AppGate() {
  const { isLoaded, isSignedIn } = useAuth();
  const { isAuthenticated, isLoading } = useConvexAuth();

  if (!isLoaded || isLoading) return <AppLoading message="Establishing a secure session…" />;
  if (!isSignedIn) return <SignInScreen />;
  if (!isAuthenticated) {
    return (
      <main className="auth">
        <div className="auth-panel">
          <h1>Session could not be validated</h1>
          <p>Convex rejected this Clerk session. Check the Clerk Convex integration and issuer domain.</p>
        </div>
      </main>
    );
  }
  return (
    <Suspense fallback={<AppLoading message="Opening workspace…" />}>
      <AuthedApp />
    </Suspense>
  );
}
