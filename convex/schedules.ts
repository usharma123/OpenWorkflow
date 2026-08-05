import { start } from "@convex-dev/workflow";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

type ScheduleNode = {
  id: string;
  data: {
    nodeType: string;
    config: { cron?: string; timezone?: string };
  };
};

function matchesField(field: string, value: number) {
  return field.split(",").some((part) => {
    const [range, stepText] = part.split("/");
    const step = Math.max(1, Number(stepText ?? 1));
    if (range === "*") return value % step === 0;
    if (range.includes("-")) {
      const [start, end] = range.split("-").map(Number);
      return value >= start && value <= end && (value - start) % step === 0;
    }
    return Number(range) === value;
  });
}

function dateParts(timestamp: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    minute: "numeric",
    hour: "numeric",
    day: "numeric",
    month: "numeric",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "0";
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    minute: Number(value("minute")),
    hour: Number(value("hour")),
    day: Number(value("day")),
    month: Number(value("month")),
    weekday: weekdays[value("weekday")] ?? 0,
  };
}

function cronMatches(expression: string, timestamp: number, timezone: string) {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const current = dateParts(timestamp, timezone);
  return (
    matchesField(fields[0], current.minute) &&
    matchesField(fields[1], current.hour) &&
    matchesField(fields[2], current.day) &&
    matchesField(fields[3], current.month) &&
    matchesField(fields[4], current.weekday)
  );
}

export const dispatch = internalMutation({
  args: {},
  handler: async (ctx): Promise<number> => {
    const now = Date.now();
    const minuteKey = String(Math.floor(now / 60_000));
    const definitions = await ctx.db
      .query("workflows")
      .withIndex("by_enabled", (q) => q.eq("enabled", true))
      .collect();
    let dispatched = 0;

    for (const definition of definitions) {
      const nodes = definition.nodes as ScheduleNode[];
      const schedules = nodes.filter((node) => node?.data?.nodeType === "scheduleTrigger");
      const lastFired = (definition.lastScheduleMinuteByNode ?? {}) as Record<string, string>;
      const nextLastFired = { ...lastFired };

      for (const node of schedules) {
        if (lastFired[node.id] === minuteKey) continue;
        const cron = node.data.config.cron ?? "";
        const timezone = node.data.config.timezone ?? "UTC";
        let matches = false;
        try {
          matches = cronMatches(cron, now, timezone);
        } catch {
          // Invalid timezones and malformed expressions are ignored until fixed in the editor.
        }
        if (!matches) continue;

        const runId = await ctx.db.insert("workflowRuns", {
          workflowId: definition._id,
          status: "queued",
          trigger: "schedule",
          input: { scheduledAt: now, timezone },
          startedAt: now,
        });
        const workflowEngineId = await start(ctx, internal.executor.executeWorkflow, { runId });
        await ctx.db.patch(runId, { workflowEngineId });
        nextLastFired[node.id] = minuteKey;
        dispatched += 1;
      }

      if (JSON.stringify(nextLastFired) !== JSON.stringify(lastFired)) {
        await ctx.db.patch(definition._id, { lastScheduleMinuteByNode: nextLastFired });
      }
    }
    return dispatched;
  },
});
