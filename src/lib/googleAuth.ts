import { GOOGLE_SCOPES } from "../../shared/googleScopes";

export { GOOGLE_SCOPES } from "../../shared/googleScopes";

export function hasRequiredGoogleScopes(approvedScopes: string): boolean {
  const approved = new Set(approvedScopes.split(/[ ,]/).filter(Boolean));
  return GOOGLE_SCOPES.every((scope) => approved.has(scope));
}
