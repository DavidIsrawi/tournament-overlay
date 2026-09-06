import { describe, expect, it, vi } from "vitest";
import { RELEASES_URL } from "../shared/app-info.ts";
import { describeRelease, GitHubUpdateChecker, releaseTarget } from "./updates.ts";

function release(version = "0.4.0") {
  const tag = `v${version}`;
  return {
    tag_name: tag,
    html_url: `${RELEASES_URL}/tag/${tag}`,
    draft: false,
    prerelease: false,
    assets: [
      "tournament-overlay-macos-arm64.dmg",
      "tournament-overlay-macos-x64.dmg",
      "tournament-overlay-windows-x64-setup.exe",
      "tournament-overlay-linux-x64.tar.gz",
      "SHA256SUMS.txt",
    ].map((name) => ({
      name,
      state: "uploaded",
      browser_download_url: `${RELEASES_URL}/download/${tag}/${name}`,
    })),
  };
}
const checkedAt = "2026-09-06T00:00:00.000Z";

describe("release selection", () => {
  it.each([
    ["darwin", "arm64", "macos-arm64"],
    ["darwin", "x64", "macos-x64"],
    ["win32", "x64", "windows-x64"],
    ["linux", "x64", "linux-x64"],
    ["linux", "arm64", null],
    ["win32", "arm64", null],
  ] as const)("matches the server's %s/%s runtime", (platform, architecture, target) => {
    expect(releaseTarget(platform, architecture)).toBe(target);
  });

  it.each([
    ["0.10.0", "available"],
    ["1.0.0", "available"],
    ["0.3.0", "current"],
    ["0.2.9", "ahead"],
  ] as const)("compares %s numerically without offering downgrades", (version, status) => {
    expect(describeRelease(release(version), "0.3.0", "windows-x64", checkedAt).status).toBe(status);
  });

  it("selects native packages and exposes checksums", () => {
    expect(describeRelease(release(), "0.3.0", "macos-arm64", checkedAt)).toMatchObject({
      download: { name: "tournament-overlay-macos-arm64.dmg" },
      checksumsUrl: `${RELEASES_URL}/download/v0.4.0/SHA256SUMS.txt`,
    });
    expect(describeRelease(release(), "0.3.0", "windows-x64", checkedAt).download?.name)
      .toBe("tournament-overlay-windows-x64-setup.exe");
  });

  it("leaves unsupported or missing assets to the release page, not another architecture", () => {
    expect(describeRelease(release(), "0.3.0", null, checkedAt).download).toBeNull();
    expect(describeRelease({ ...release(), assets: [] }, "0.3.0", "macos-arm64", checkedAt).download).toBeNull();
  });

  it.each([
    { ...release(), prerelease: true },
    { ...release(), draft: true },
    release("0.4.0-beta.1"),
    release("01.0.0"),
    { ...release(), html_url: "https://example.com/release" },
    { ...release(), assets: [{ name: "tournament-overlay-macos-arm64.dmg", state: "uploaded", browser_download_url: "https://example.com/download" }] },
    {},
  ])("rejects unpublished, malformed or unexpected releases", (input) => {
    expect(() => describeRelease(input, "0.3.0", "macos-arm64", checkedAt)).toThrow();
  });
});

describe("GitHub update checks", () => {
  it("checks only on request, coalesces requests, and caches successes for five minutes", async () => {
    const request = vi.fn<typeof fetch>(() => Promise.resolve(Response.json(release())));
    let now = Date.parse(checkedAt);
    const checker = new GitHubUpdateChecker("macos-arm64", "0.3.0", request, () => now);
    expect(request).not.toHaveBeenCalled();
    const first = checker.check();
    expect(checker.check()).toBe(first);
    expect(await first).toMatchObject({ checkedAt, status: "available" });
    await checker.check();
    expect(request).toHaveBeenCalledTimes(1);
    const options = request.mock.calls[0]?.[1];
    expect(options?.headers).not.toHaveProperty("Authorization");
    expect(options?.redirect).toBe("error");
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    now += 300_001;
    await checker.check();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("surfaces rate limits and retries a failed check instead of caching a success-shaped result", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("", { status: 403 }))
      .mockResolvedValueOnce(Response.json(release()));
    const checker = new GitHubUpdateChecker(null, "0.3.0", request);
    await expect(checker.check()).rejects.toThrow("limiting update checks");
    await expect(checker.check()).resolves.toMatchObject({ status: "available" });
  });

  it("reports offline and unreadable responses without failing the application", async () => {
    const request = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(new Response("not JSON"));
    const checker = new GitHubUpdateChecker(null, "0.3.0", request);
    await expect(checker.check()).rejects.toThrow("broadcast is unaffected");
    await expect(checker.check()).rejects.toThrow("unreadable release");
  });
});
