import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { APP_VERSION } from "../shared/app-info.ts";
import { PROTOCOL_VERSION } from "../shared/contracts.ts";

const buildInfoSchema = z.object({
  appVersion: z.literal(APP_VERSION),
  protocolVersion: z.literal(PROTOCOL_VERSION),
});

export async function assertMatchingBrowserAssets(publicDirectory: string): Promise<void> {
  for (const directory of [publicDirectory, join(publicDirectory, "overlay")]) {
    try {
      const content = await readFile(join(directory, "app-build.json"), "utf8");
      buildInfoSchema.parse(JSON.parse(content));
    } catch (error) {
      throw new Error(
        `Browser assets in ${directory} are missing or do not match application v${APP_VERSION}. Install the complete release, including its public directory, or run npm run build for a source checkout.`,
        { cause: error },
      );
    }
  }
}
