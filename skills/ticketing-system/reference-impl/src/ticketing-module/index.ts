/**
 * Ticketing module barrel. Re-exports the client-safe surface (types, schema,
 * pure helpers, read api, hooks). Deliberately does NOT export `actions.ts` so
 * the barrel stays importable from client components.
 */
export * from "./types";
export * from "./schema";
export * from "./status";
export * from "./priority";
export * from "./labels";
export * from "./notifications";
export * as api from "./api";
export * from "./hooks";
