import type { GenericActionCtx, GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { DataModel } from "./_generated/dataModel";
import { ownerKeyFor } from "./policies";

type AuthCtx =
  | GenericActionCtx<DataModel>
  | GenericMutationCtx<DataModel>
  | GenericQueryCtx<DataModel>;

export type Principal = {
  userId: string;
  organizationId?: string;
  ownerKey: string;
};

export async function requirePrincipal(ctx: AuthCtx): Promise<Principal> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Sign in to continue.");

  const claims = identity as unknown as Record<string, unknown>;
  const organizationId =
    typeof claims.org_id === "string"
      ? claims.org_id
      : typeof claims.organization_id === "string"
        ? claims.organization_id
        : undefined;
  const userId = identity.subject;
  return {
    userId,
    organizationId,
    ownerKey: ownerKeyFor(userId, organizationId),
  };
}
