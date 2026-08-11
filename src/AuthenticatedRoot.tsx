import { useAuth } from "@clerk/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { AppGate } from "./AppGate";
import { convexClient } from "./lib/convexClient";

export default function AuthenticatedRoot() {
  if (!convexClient) return null;
  return (
    <ConvexProviderWithClerk client={convexClient} useAuth={useAuth}>
      <AppGate />
    </ConvexProviderWithClerk>
  );
}
