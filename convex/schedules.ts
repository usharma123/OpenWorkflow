import { internalMutation } from "./_generated/server";
import { createPinnedRun } from "./runs";

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
    const dispatchCounts = await Promise.all(definitions.map(async (definition) => {
      if (!definition.ownerKey || !definition.ownerUserId) return 0;
      const published = definition.publishedVersionId ? await ctx.db.get(definition.publishedVersionId) : null;
      const executableDefinition = published?.workflowId === definition._id
        ? { ...definition, nodes: published.nodes, edges: published.edges }
        : definition;
      const nodes = executableDefinition.nodes as ScheduleNode[];
      const schedules = nodes.filter((node) => node?.data?.nodeType === "scheduleTrigger");
      const lastFired = (definition.lastScheduleMinuteByNode ?? {}) as Record<string, string>;
      const nextLastFired = { ...lastFired };
      const dueSchedules = schedules.filter((node) => {
        if (lastFired[node.id] === minuteKey) return false;
        const cron = node.data.config.cron ?? "";
        const timezone = node.data.config.timezone ?? "UTC";
        try {
          return cronMatches(cron, now, timezone);
        } catch {
          // Invalid timezones and malformed expressions are ignored until fixed in the editor.
          return false;
        }
      });
      if (dueSchedules.length === 0) return 0;

      await Promise.all(dueSchedules.map((node) => {
        const timezone = node.data.config.timezone ?? "UTC";
        nextLastFired[node.id] = minuteKey;
        return createPinnedRun(ctx, executableDefinition, "schedule", {
          scheduledAt: now,
          timezone,
          triggerNodeId: node.id,
        }, { usePublished: true });
      }));

      await ctx.db.patch(definition._id, { lastScheduleMinuteByNode: nextLastFired });
      return dueSchedules.length;
    }));
    return dispatchCounts.reduce((total, count) => total + count, 0);
  },
});
