import { z } from "zod";
import {
  APP_VERSION,
  RELEASES_URL,
  type ReleaseTarget,
  type UpdateCheck,
} from "../shared/app-info.ts";

const LATEST_RELEASE_API =
  "https://api.github.com/repos/DavidIsrawi/tournament-overlay/releases/latest";
const CACHE_MS = 5 * 60_000;
const releaseSchema = z.object({
  tag_name: z.string(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  html_url: z.string().url(),
  assets: z.array(z.object({
    name: z.string(),
    browser_download_url: z.string().url(),
    state: z.string(),
  })),
});
const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function releaseTarget(
  platform: NodeJS.Platform,
  architecture: string,
): ReleaseTarget | null {
  if (platform === "darwin" && (architecture === "arm64" || architecture === "x64")) {
    return `macos-${architecture}`;
  }
  if (platform === "win32" && architecture === "x64") {
    return "windows-x64";
  }
  if (platform === "linux" && architecture === "x64") {
    return "linux-x64";
  }
  return null;
}

function preferredAsset(target: ReleaseTarget): string {
  switch (target) {
    case "macos-arm64":
    case "macos-x64":
      return `tournament-overlay-${target}.dmg`;
    case "windows-x64":
      return "tournament-overlay-windows-x64-setup.exe";
    case "linux-x64":
      return "tournament-overlay-linux-x64.tar.gz";
  }
}

export class UpdateCheckError extends Error {}

function versionParts(version: string): readonly number[] {
  if (!stableVersionPattern.test(version)) {
    throw new UpdateCheckError("The release version is not a stable semantic version.");
  }
  const parts = version.split(".").map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) {
    throw new UpdateCheckError("The release version is outside the supported range.");
  }
  return parts;
}

export function describeRelease(
  input: unknown,
  installedVersion: string,
  target: ReleaseTarget | null,
  checkedAt: string,
): UpdateCheck {
  const parsed = releaseSchema.safeParse(input);
  if (!parsed.success) {
    throw new UpdateCheckError("GitHub returned an unreadable release. Open the releases page or try again later.");
  }
  const release = parsed.data;
  if (release.draft || release.prerelease) {
    throw new UpdateCheckError("GitHub did not return a published stable release.");
  }
  const latestVersion = release.tag_name.replace(/^v/, "");
  const latest = versionParts(latestVersion);
  const installed = versionParts(installedVersion);
  const difference = latest.map((part, index) => part - (installed[index] ?? 0))
    .find((part) => part !== 0) ?? 0;
  const expectedReleaseUrl = `${RELEASES_URL}/tag/${release.tag_name}`;
  if (release.html_url !== expectedReleaseUrl) {
    throw new UpdateCheckError("GitHub returned an unexpected release link.");
  }
  const asset = (name: string): { name: string; url: string } | null => {
    const match = release.assets.find((candidate) => candidate.name === name && candidate.state === "uploaded");
    if (match === undefined) {
      return null;
    }
    const expectedUrl = `${RELEASES_URL}/download/${release.tag_name}/${name}`;
    if (match.browser_download_url !== expectedUrl) {
      throw new UpdateCheckError("GitHub returned an unexpected download link.");
    }
    return { name, url: expectedUrl };
  };
  return {
    checkedAt,
    installedVersion,
    latestVersion,
    status: difference > 0 ? "available" : difference < 0 ? "ahead" : "current",
    releaseUrl: expectedReleaseUrl,
    download: target === null ? null : asset(preferredAsset(target)),
    checksumsUrl: asset("SHA256SUMS.txt")?.url ?? null,
  };
}

export class GitHubUpdateChecker {
  #cached: UpdateCheck | null = null;
  #pending: Promise<UpdateCheck> | null = null;

  public constructor(
    private readonly target: ReleaseTarget | null,
    private readonly version = APP_VERSION,
    private readonly request: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  public check(): Promise<UpdateCheck> {
    if (this.#cached !== null && this.now() - Date.parse(this.#cached.checkedAt) < CACHE_MS) {
      return Promise.resolve(this.#cached);
    }
    if (this.#pending !== null) {
      return this.#pending;
    }
    this.#pending = this.#load().then((result) => {
      this.#cached = result;
      return result;
    }).finally(() => {
      this.#pending = null;
    });
    return this.#pending;
  }

  async #load(): Promise<UpdateCheck> {
    let response: Response;
    try {
      response = await this.request(LATEST_RELEASE_API, {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "Tournament-Overlay-Update-Check",
        },
        signal: AbortSignal.timeout(8_000),
        redirect: "error",
      });
    } catch (error) {
      throw new UpdateCheckError(
        "Could not reach GitHub. Check your internet connection and try again; your broadcast is unaffected.",
        { cause: error },
      );
    }
    if (!response.ok) {
      throw new UpdateCheckError(response.status === 403 || response.status === 429
        ? "GitHub is limiting update checks. Try again later or open the releases page."
        : response.status === 404
          ? "No stable release is available on GitHub yet."
          : `GitHub could not check for updates (HTTP ${String(response.status)}). Try again later.`);
    }
    let input: unknown;
    try {
      input = await response.json();
    } catch (error) {
      throw new UpdateCheckError("GitHub returned an unreadable release. Try again later.", { cause: error });
    }
    return describeRelease(input, this.version, this.target, new Date(this.now()).toISOString());
  }
}
