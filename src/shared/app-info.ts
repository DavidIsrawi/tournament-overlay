import { z } from "zod";
import packageInfo from "../../package.json" with { type: "json" };

export const APP_VERSION = packageInfo.version;
export const RELEASES_URL = "https://github.com/DavidIsrawi/tournament-overlay/releases";
export const RELEASE_TARGETS = [
  "macos-arm64",
  "macos-x64",
  "windows-x64",
  "linux-x64",
] as const;
export type ReleaseTarget = (typeof RELEASE_TARGETS)[number];

export const appInfoSchema = z.object({
  version: z.string().min(1),
  protocolVersion: z.number().int().positive(),
  platform: z.string(),
  architecture: z.string(),
  target: z.enum(RELEASE_TARGETS).nullable(),
});
export type AppInfo = z.infer<typeof appInfoSchema>;

const releaseUrlSchema = z.string().url().refine((value) => {
  const url = new URL(value);
  return url.origin === "https://github.com" &&
    url.pathname.startsWith("/DavidIsrawi/tournament-overlay/releases/") &&
    url.username === "" && url.password === "";
}, "Expected a Tournament Overlay GitHub release URL.");

export const updateCheckSchema = z.object({
  checkedAt: z.iso.datetime(),
  installedVersion: z.string(),
  latestVersion: z.string(),
  status: z.enum(["available", "current", "ahead"]),
  releaseUrl: releaseUrlSchema,
  download: z.object({
    name: z.string(),
    url: releaseUrlSchema,
  }).nullable(),
  checksumsUrl: releaseUrlSchema.nullable(),
});
export type UpdateCheck = z.infer<typeof updateCheckSchema>;
