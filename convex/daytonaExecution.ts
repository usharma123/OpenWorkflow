"use node";

import { Daytona, type CreateSandboxFromSnapshotParams, type Sandbox } from "@daytona/sdk";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, type ActionCtx } from "./_generated/server";
import { daytonaCreateConfig, publicGitUrl, safeSandboxPath, structuredProcessOutput } from "./daytonaPolicy";
import { LIVE_OUTPUT_CHARS, LIVE_UPDATE_INTERVAL_MS } from "./liveState";

type WorkflowNode = {
  id: string;
  parentId?: string;
  data: { nodeType: string; config: Record<string, unknown> };
};

function daytonaClient() {
  const apiKey = process.env.DAYTONA_API_KEY?.trim();
  if (!apiKey) throw new Error("DAYTONA_API_KEY is not configured in Convex.");
  return new Daytona({
    apiKey,
    ...(process.env.DAYTONA_API_URL?.trim() ? { apiUrl: process.env.DAYTONA_API_URL.trim() } : {}),
    ...(process.env.DAYTONA_TARGET?.trim() ? { target: process.env.DAYTONA_TARGET.trim() } : {}),
    requestTimeoutMs: 15 * 60 * 1_000,
  });
}

async function getSandbox(
  daytona: Daytona,
  existingSandboxId: string | undefined,
  boundaryId: string,
  boundaryConfig: Record<string, unknown>,
) {
  if (existingSandboxId) {
    try {
      const existing = await daytona.get(existingSandboxId);
      if (String(existing.state) !== "started") await existing.start(60);
      return existing;
    } catch (error) {
      throw new Error(`The Daytona sandbox for ${boundaryId} is no longer available: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  const config = daytonaCreateConfig(boundaryConfig);
  const params: CreateSandboxFromSnapshotParams = {
    language: config.language,
    ttlMinutes: config.ttlMinutes,
    ephemeral: true,
    public: false,
    labels: { openworkflow_boundary: boundaryId },
    ...(config.snapshot ? { snapshot: config.snapshot } : {}),
    ...(config.networkBlockAll ? { networkBlockAll: true } : {}),
    ...(config.domainAllowList ? { domainAllowList: config.domainAllowList } : {}),
  };
  return daytona.create(params, { timeout: 90 });
}

async function streamCommand(
  ctx: ActionCtx,
  sandbox: Sandbox,
  command: string,
  cwd: string,
  timeout: number,
  stepRunId: import("./_generated/dataModel").Id<"stepRuns">,
) {
  await sandbox.fs.createFolder(cwd, "755");
  const sessionId = `openworkflow-${crypto.randomUUID()}`;
  await sandbox.process.createSession(sessionId);
  let stdout = "";
  let stderr = "";
  let lastPatchAt = 0;
  let patchQueue = Promise.resolve<unknown>(undefined);
  const patchOutput = () => {
    const now = Date.now();
    if (now - lastPatchAt < LIVE_UPDATE_INTERVAL_MS) return;
    lastPatchAt = now;
    const partialOutput = `${stdout}${stderr ? `\n[stderr]\n${stderr}` : ""}`.slice(-LIVE_OUTPUT_CHARS);
    patchQueue = patchQueue.then(() => ctx.runMutation(internal.executor.updateStepPartialOutput, {
      stepRunId,
      partialOutput,
    }));
  };

  try {
    const started = await sandbox.process.executeSessionCommand(sessionId, {
      command,
      runAsync: true,
      suppressInputEcho: true,
    }, timeout);
    await sandbox.process.getSessionCommandLogs(
      sessionId,
      started.cmdId,
      (chunk) => { stdout += chunk; patchOutput(); },
      (chunk) => { stderr += chunk; patchOutput(); },
    );
    await patchQueue;
    const completed = await sandbox.process.getSessionCommand(sessionId, started.cmdId);
    const output = structuredProcessOutput(stdout, stderr, completed.exitCode ?? 1);
    await ctx.runMutation(internal.executor.updateStepPartialOutput, {
      stepRunId,
      partialOutput: `${stdout}${stderr ? `\n[stderr]\n${stderr}` : ""}`.slice(-LIVE_OUTPUT_CHARS),
    });
    return output;
  } finally {
    await sandbox.process.deleteSession(sessionId).catch(() => undefined);
  }
}

export const execute = internalAction({
  args: {
    node: v.any(),
    input: v.any(),
    boundaryId: v.string(),
    boundaryConfig: v.any(),
    existingSandboxId: v.optional(v.string()),
    stepRunId: v.id("stepRuns"),
  },
  handler: async (ctx, args): Promise<{ sandboxId: string; output: unknown }> => {
    const node = args.node as WorkflowNode;
    const daytona = daytonaClient();
    let sandbox: Sandbox | undefined;
    try {
      sandbox = await getSandbox(daytona, args.existingSandboxId, args.boundaryId, args.boundaryConfig);
      await ctx.runMutation(internal.executor.attachSandbox, { stepRunId: args.stepRunId, sandboxId: sandbox.id });
      const serializedInput = JSON.stringify(args.input) ?? "null";
      await sandbox.fs.uploadFile(Buffer.from(serializedInput), "/tmp/openworkflow-input.json");
      const config = node.data.config;
      const timeout = Math.min(900, Math.max(1, Math.trunc(Number(config.timeoutSeconds ?? 60))));
      let output: unknown;

      if (node.data.nodeType === "code") {
        const code = String(config.code ?? "");
        if (!code.trim()) throw new Error("Code cannot be empty.");
        if (code.length > 200_000) throw new Error("Code is limited to 200,000 characters per step.");
        const result = await sandbox.process.codeRun(code, {
          env: {
            OPENWORKFLOW_INPUT: serializedInput,
            OPENWORKFLOW_INPUT_PATH: "/tmp/openworkflow-input.json",
          },
        }, timeout);
        output = structuredProcessOutput(result.result, "", result.exitCode);
        await ctx.runMutation(internal.executor.updateStepPartialOutput, {
          stepRunId: args.stepRunId,
          partialOutput: result.result.slice(-LIVE_OUTPUT_CHARS),
        });
      } else if (node.data.nodeType === "shell") {
        const command = String(config.command ?? "");
        if (!command.trim()) throw new Error("Shell command cannot be empty.");
        if (command.length > 50_000) throw new Error("Shell commands are limited to 50,000 characters per step.");
        const cwd = safeSandboxPath(config.workingDirectory, "workspace");
        output = await streamCommand(ctx, sandbox, command, cwd, timeout, args.stepRunId);
      } else if (node.data.nodeType === "git") {
        const repositoryUrl = publicGitUrl(config.repositoryUrl);
        const directory = safeSandboxPath(config.directory, "workspace/repository");
        const branch = String(config.branch ?? "").trim() || undefined;
        const depth = Math.min(1_000, Math.max(1, Math.trunc(Number(config.depth ?? 1))));
        await sandbox.git.clone(repositoryUrl, directory, branch, undefined, undefined, undefined, false, depth);
        const status = await sandbox.git.status(directory);
        output = { repositoryUrl, directory, branch: status.currentBranch, status };
      } else {
        throw new Error(`Unsupported Daytona operation: ${node.data.nodeType}`);
      }

      return { sandboxId: sandbox.id, output };
    } catch (error) {
      // The outer workflow only learns a sandbox ID after this action succeeds.
      // Clean up a newly created sandbox here when the first step fails early.
      if (!args.existingSandboxId && sandbox) {
        await daytona.delete(sandbox, 60, true).catch(() => undefined);
      }
      throw error;
    } finally {
      await daytona[Symbol.asyncDispose]().catch(() => undefined);
    }
  },
});

export const cleanup = internalAction({
  args: { sandboxIds: v.array(v.string()) },
  handler: async (_ctx, { sandboxIds }) => {
    if (!process.env.DAYTONA_API_KEY?.trim()) return { deleted: 0 };
    const daytona = daytonaClient();
    try {
      const results = await Promise.all([...new Set(sandboxIds)].map(async (sandboxId) => {
        try {
          const sandbox = await daytona.get(sandboxId);
          await daytona.delete(sandbox, 60, true);
          return true;
        } catch {
          // Ephemeral sandboxes may already have expired or been deleted.
          return false;
        }
      }));
      return { deleted: results.filter(Boolean).length };
    } finally {
      await daytona[Symbol.asyncDispose]().catch(() => undefined);
    }
  },
});
