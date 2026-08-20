import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";

const localConfigSchema = z.object({
  startggApiToken: z.string().trim().min(1).nullable(),
});

export interface LocalConfig {
  readonly startggApiToken: string | null;
}

const EMPTY_CONFIG: LocalConfig = {
  startggApiToken: null,
};

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

export function defaultUserConfigDirectory(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
  homeDirectory: string = homedir(),
): string {
  switch (platform) {
    case "darwin":
      return join(
        homeDirectory,
        "Library",
        "Application Support",
        "Tournament Overlay",
      );
    case "win32":
      return join(
        environment.APPDATA ?? join(homeDirectory, "AppData", "Roaming"),
        "Tournament Overlay",
      );
    default:
      return join(
        environment.XDG_CONFIG_HOME ?? join(homeDirectory, ".config"),
        "tournament-overlay",
      );
  }
}

export class AtomicLocalConfigStore {
  public constructor(private readonly filePath: string) {}

  public async load(): Promise<LocalConfig> {
    let content: string;
    try {
      content = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isMissingFile(error)) {
        return EMPTY_CONFIG;
      }
      throw error;
    }

    let input: unknown;
    try {
      input = JSON.parse(content);
    } catch (error) {
      throw new Error("The local configuration file is not valid JSON.", {
        cause: error,
      });
    }
    const parsed = localConfigSchema.safeParse(input);
    if (!parsed.success) {
      throw new Error(
        `The local configuration file is invalid: ${parsed.error.message}`,
        { cause: parsed.error },
      );
    }
    return parsed.data;
  }

  public async saveStartGgToken(token: string): Promise<void> {
    const config: LocalConfig = {
      startggApiToken: token.trim(),
    };
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.${String(process.pid)}.${String(Date.now())}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, this.filePath);
  }
}
