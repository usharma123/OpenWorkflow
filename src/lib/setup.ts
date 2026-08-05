const SETUP_SEEN_KEY = "openworkflow.setupComplete";

export function markSetupSeen() {
  localStorage.setItem(SETUP_SEEN_KEY, "true");
}

export function hasSeenSetup(): boolean {
  return localStorage.getItem(SETUP_SEEN_KEY) === "true";
}
