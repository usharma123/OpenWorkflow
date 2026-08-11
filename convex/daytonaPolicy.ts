const SANDBOX_LANGUAGES = new Set(["typescript", "javascript", "python"]);

export function daytonaCreateConfig(config: Record<string, unknown>) {
  const language = String(config.language ?? "typescript");
  if (!SANDBOX_LANGUAGES.has(language)) throw new Error("Unsupported Daytona sandbox language.");

  const ttlMinutes = Math.min(240, Math.max(5, Math.trunc(Number(config.ttlMinutes ?? 30))));
  const snapshot = String(config.snapshot ?? "").trim();
  if (snapshot && !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(snapshot)) {
    throw new Error("Daytona snapshot names may contain letters, numbers, dots, slashes, colons, underscores, and dashes.");
  }

  const networkMode = String(config.networkMode ?? "blocked");
  if (networkMode === "blocked") {
    return { language, ttlMinutes, snapshot: snapshot || undefined, networkBlockAll: true as const };
  }
  if (networkMode !== "allowlist") throw new Error("Unsupported Daytona network mode.");
  const domains = String(config.allowedDomains ?? "")
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
  if (!domains.length) throw new Error("Add an allowed domain or block sandbox networking.");
  if (domains.some((domain) => domain.includes("://") || domain.includes("/") || !/^(\*\.)?[a-z0-9.-]+$/.test(domain))) {
    throw new Error("Daytona allowed domains must be hostnames without URLs or paths.");
  }
  return { language, ttlMinutes, snapshot: snapshot || undefined, domainAllowList: [...new Set(domains)].join(",") };
}

export function safeSandboxPath(value: unknown, fallback: string) {
  const path = String(value ?? fallback).trim() || fallback;
  if (path.startsWith("/") || path.split("/").some((part) => part === "..") || !/^[a-zA-Z0-9._/-]+$/.test(path)) {
    throw new Error("Sandbox paths must be relative and cannot contain parent-directory traversal.");
  }
  return path.replace(/^\.\//, "");
}

export function publicGitUrl(value: unknown) {
  const url = new URL(String(value ?? ""));
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("Git clone supports public HTTPS repository URLs without embedded credentials or query parameters.");
  }
  return url.toString();
}

export function structuredProcessOutput(stdout: string, stderr: string, exitCode: number) {
  const trimmed = stdout.trim();
  if (exitCode !== 0) {
    throw new Error(`Sandbox process exited with code ${exitCode}: ${(stderr || stdout).slice(0, 1_000)}`);
  }
  if (trimmed) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      // Human-readable stdout remains available as a structured field.
    }
  }
  return { stdout, ...(stderr ? { stderr } : {}), exitCode };
}
