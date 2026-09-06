import { z } from "zod";
import { APP_VERSION } from "./app-info.ts";
import { PROTOCOL_VERSION } from "./contracts.ts";

export const clientHelloVersionSchema = z.object({
  type: z.literal("client.hello"),
  appVersion: z.string().optional(),
  protocolVersion: z.number(),
  client: z.enum(["dashboard", "overlay"]),
});

export function reloadMessage(client: "dashboard" | "overlay"): string {
  return client === "dashboard"
    ? "The browser and server versions differ. Reload this dashboard. If the message persists, quit the application and install the complete matching release."
    : "The browser and server versions differ. Refresh this browser source in OBS. If the message persists, install the complete matching release.";
}

export function versionsMatch(appVersion: string | undefined, protocolVersion: number): boolean {
  return appVersion === APP_VERSION && protocolVersion === PROTOCOL_VERSION;
}

const snapshotVersionSchema = z.object({
  type: z.literal("state.snapshot"),
  state: z.object({
    appVersion: z.string().optional(),
    protocolVersion: z.number(),
  }),
});

export function snapshotNeedsReload(input: unknown): boolean {
  const parsed = snapshotVersionSchema.safeParse(input);
  return parsed.success &&
    !versionsMatch(parsed.data.state.appVersion, parsed.data.state.protocolVersion);
}
