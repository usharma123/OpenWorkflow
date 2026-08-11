export const GOOGLE_SCOPES: string[] = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/spreadsheets",
];

export function hasRequiredGoogleScopes(approvedScopes: string): boolean {
  const approved = new Set(approvedScopes.split(/[ ,]/).filter(Boolean));
  return GOOGLE_SCOPES.every((scope) => approved.has(scope));
}
