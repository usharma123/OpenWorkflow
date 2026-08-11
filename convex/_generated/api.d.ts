/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as connectionActions from "../connectionActions.js";
import type * as connections from "../connections.js";
import type * as connectorExecution from "../connectorExecution.js";
import type * as crons from "../crons.js";
import type * as daytonaExecution from "../daytonaExecution.js";
import type * as daytonaPolicy from "../daytonaPolicy.js";
import type * as executor from "../executor.js";
import type * as http from "../http.js";
import type * as openrouterStream from "../openrouterStream.js";
import type * as policies from "../policies.js";
import type * as runs from "../runs.js";
import type * as schedules from "../schedules.js";
import type * as secretCrypto from "../secretCrypto.js";
import type * as template from "../template.js";
import type * as webhooks from "../webhooks.js";
import type * as workflows from "../workflows.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  connectionActions: typeof connectionActions;
  connections: typeof connections;
  connectorExecution: typeof connectorExecution;
  crons: typeof crons;
  daytonaExecution: typeof daytonaExecution;
  daytonaPolicy: typeof daytonaPolicy;
  executor: typeof executor;
  http: typeof http;
  openrouterStream: typeof openrouterStream;
  policies: typeof policies;
  runs: typeof runs;
  schedules: typeof schedules;
  secretCrypto: typeof secretCrypto;
  template: typeof template;
  webhooks: typeof webhooks;
  workflows: typeof workflows;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
};
