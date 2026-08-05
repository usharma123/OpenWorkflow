export const GOOGLE_SCOPES: string[] = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive.file",
];

export function hasRequiredGoogleScopes(approvedScopes: string): boolean {
  const approved = new Set(approvedScopes.split(/[ ,]/).filter(Boolean));
  return GOOGLE_SCOPES.every((scope) => approved.has(scope));
}
