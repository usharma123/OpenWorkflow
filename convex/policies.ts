export function ownerKeyFor(userId: string, organizationId?: string) {
  return organizationId ? `org:${organizationId}` : `user:${userId}`;
}

export function hasRequiredScopes(granted: string[], required: string[]) {
  const normalized = new Set(granted.flatMap((scope) => scope.split(/[ ,]/)).filter(Boolean));
  return required.every((scope) => normalized.has(scope));
}

export function applyApprovalDecision(input: unknown, approval: { approved: boolean; note?: string }, decidedAt: number) {
  if (!approval.approved) throw new Error(approval.note || "Workflow was rejected.");
  return {
    ...(input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : { value: input }),
    approval: { ...approval, decidedAt },
  };
}

