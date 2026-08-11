import { describe, expect, test } from "bun:test";
import {
  daytonaCreateConfig,
  publicGitUrl,
  safeSandboxPath,
  structuredProcessOutput,
} from "../convex/daytonaPolicy";

describe("Daytona sandbox policy", () => {
  test("blocks outbound networking by default", () => {
    expect(daytonaCreateConfig({})).toEqual({
      language: "typescript",
      ttlMinutes: 30,
      snapshot: undefined,
      networkBlockAll: true,
    });
  });

  test("normalizes a domain allowlist without accepting URLs", () => {
    expect(daytonaCreateConfig({
      networkMode: "allowlist",
      allowedDomains: "GitHub.com, *.githubusercontent.com, github.com",
    })).toMatchObject({ domainAllowList: "github.com,*.githubusercontent.com" });
    expect(() => daytonaCreateConfig({
      networkMode: "allowlist",
      allowedDomains: "https://github.com/path",
    })).toThrow("hostnames");
  });

  test("rejects path traversal and embedded Git credentials", () => {
    expect(safeSandboxPath("workspace/repo", "workspace")).toBe("workspace/repo");
    expect(() => safeSandboxPath("../secrets", "workspace")).toThrow("traversal");
    expect(publicGitUrl("https://github.com/openai/openai-node.git")).toBe("https://github.com/openai/openai-node.git");
    expect(() => publicGitUrl("https://token@github.com/private/repo.git")).toThrow("credentials");
  });

  test("uses JSON stdout as the next node value", () => {
    expect(structuredProcessOutput('{"ok":true}', "", 0)).toEqual({ ok: true });
    expect(structuredProcessOutput("hello\n", "", 0)).toEqual({ stdout: "hello\n", exitCode: 0 });
    expect(() => structuredProcessOutput("", "boom", 2)).toThrow("boom");
  });
});
