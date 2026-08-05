import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("dispatch no-code schedules", { minutes: 1 }, internal.schedules.dispatch);
crons.interval("remove expired OAuth states", { minutes: 10 }, internal.connections.cleanupExpiredOauthStates);
crons.interval("remove pre-auth connector rows", { hours: 1 }, internal.connections.cleanupLegacyConnections);
crons.interval("backfill indexed webhook slugs", { hours: 1 }, internal.workflows.backfillWebhookSlugs);

export default crons;
