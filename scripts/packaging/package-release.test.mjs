import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  rmdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, resolve } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  packageRelease,
  powershellLiteral,
  releaseTarget,
  renderTemplate,
  validatePayload,
} from "../package-release.mjs";

const workspace = resolve(import.meta.dirname, ".test-work");
let root = "";

beforeEach(() => {
  root = resolve(workspace, `Package O'Brien ${randomUUID()}`);
  mkdirSync(root, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

afterAll(() => {
  rmdirSync(workspace);
});

function fixture(platform = "linux", architecture = "x64") {
  const payload = resolve(root, "dist/executable");
  mkdirSync(resolve(payload, "public/overlay"), { recursive: true });
  writeFileSync(resolve(root, "package.json"), JSON.stringify({ version: "0.3.0" }));
  writeFileSync(resolve(payload,
    platform === "win32" ? "TournamentOverlay.exe" : "TournamentOverlay"), "executable fixture");
  writeFileSync(resolve(payload, "build-info.json"), JSON.stringify({
    version: "0.3.0", platform, architecture, nodeVersion: "v24.12.0",
  }));
  for (const directory of ["public", "public/overlay"]) {
    writeFileSync(resolve(payload, directory, "index.html"), "<html></html>");
    writeFileSync(resolve(payload, directory, "app-build.json"), JSON.stringify({
      appVersion: "0.3.0", protocolVersion: 1,
    }));
  }
  return payload;
}

describe("release payload validation", () => {
  it.each([
    ["darwin", "arm64", "macos-arm64"],
    ["darwin", "x64", "macos-x64"],
    ["win32", "x64", "windows-x64"],
    ["linux", "x64", "linux-x64"],
  ])("maps %s %s to %s", (platform, architecture, target) => {
    expect(releaseTarget(platform, architecture)).toBe(target);
  });

  it("rejects unsupported targets instead of using them in output paths", () => {
    expect(() => releaseTarget("linux", "../../escape")).toThrow("Unsupported release platform");
  });

  it("requires executable metadata matching the package and native runtime", () => {
    const payload = fixture();
    expect(validatePayload(payload, "0.3.0", "linux", "x64")).toBe("TournamentOverlay");
    expect(() => validatePayload(payload, "0.4.0", "linux", "x64")).toThrow("Rebuild first");
    expect(() => validatePayload(payload, "0.3.0", "darwin", "x64")).toThrow("Rebuild first");
    expect(() => validatePayload(payload, "0.3.0", "linux", "arm64")).toThrow("Rebuild first");
    writeFileSync(resolve(payload, "build-info.json"), JSON.stringify({
      version: "0.3.0", platform: "linux", architecture: "x64", nodeVersion: "v22.16.0",
    }));
    expect(() => validatePayload(payload, "0.3.0", "linux", "x64")).toThrow();
  });

  it("rejects mismatched browser versions", () => {
    const payload = fixture();
    writeFileSync(resolve(payload, "public/overlay/app-build.json"),
      JSON.stringify({ appVersion: "0.2.0" }));
    expect(() => validatePayload(payload, "0.3.0", "linux", "x64")).toThrow("Browser assets");
  });

  it.skipIf(process.platform === "win32")("rejects symlinks into data outside the payload", () => {
    const payload = fixture();
    const secret = resolve(root, "user-config.json");
    writeFileSync(secret, "must never be packaged");
    symlinkSync(secret, resolve(payload, "public/data.json"));
    expect(() => validatePayload(payload, "0.3.0", "linux", "x64")).toThrow("regular files");
  });

  it("rejects invalid native package versions before creating output", () => {
    fixture();
    writeFileSync(resolve(root, "package.json"), JSON.stringify({ version: "0.3.0\nbad" }));
    expect(() => packageRelease({ rootDirectory: root, platform: "linux", architecture: "x64" }))
      .toThrow();
    expect(existsSync(resolve(root, "dist/release"))).toBe(false);
  });
});

describe("native and portable packaging", () => {
  it("can rebuild into a separate directory without replacing an existing installer", () => {
    fixture();
    const previous = resolve(root, "dist/release/tournament-overlay-linux-x64.tar.gz");
    mkdirSync(resolve(root, "dist/release"), { recursive: true });
    writeFileSync(previous, "existing release");
    const outputDirectory = resolve(root, "dist/release/rebuild");
    const assets = packageRelease({ rootDirectory: root, platform: "linux", architecture: "x64", outputDirectory });
    expect(assets).toEqual([resolve(outputDirectory, "tournament-overlay-linux-x64.tar.gz")]);
    expect(readFileSync(previous, "utf8")).toBe("existing release");
  });

  it("creates a real Linux archive without adjacent user files or stale staging assets", () => {
    const payload = fixture();
    writeFileSync(resolve(payload, ".env"), "SECRET=do-not-ship");
    writeFileSync(resolve(payload, "operator-state.json"), "do-not-ship");
    mkdirSync(resolve(root, "dist/packaging/linux-x64/portable/public"), { recursive: true });
    writeFileSync(resolve(root, "dist/packaging/linux-x64/portable/public/stale.js"), "stale");
    const assets = packageRelease({ rootDirectory: root, platform: "linux", architecture: "x64" });
    expect(assets.map((path) => basename(path))).toEqual(["tournament-overlay-linux-x64.tar.gz"]);
    const archive = assets[0];
    expect(archive).toBeDefined();
    const listing = execFileSync("tar", ["-tzf", archive ?? ""], { encoding: "utf8" });
    expect(listing).toContain("public/overlay/index.html");
    expect(listing).toContain("build-info.json");
    expect(listing).toContain("README.txt");
    expect(listing).not.toMatch(/\.env|operator-state|stale\.js/);
    const readme = readFileSync(resolve(root, "dist/packaging/linux-x64/portable/README.txt"), "utf8");
    expect(readme).toContain("Tournament Overlay 0.3.0");
    expect(readme).toContain("Terminal=true");
  });

  it.skipIf(process.platform === "win32")("packages a native macOS entrypoint with separately sealed resources", () => {
    fixture("darwin", "arm64");
    const run = vi.fn(
      /** @param {string} file @param {string[]} args */
      (file, args) => {
        if (file === "tar") {
          execFileSync(file, args);
        } else if (file === "xcrun") {
          writeFileSync(args.at(-1) ?? "", "native launcher fixture");
        } else if (file === "hdiutil") {
          writeFileSync(args.at(-1) ?? "", "disk image fixture");
        }
      },
    );
    const assets = packageRelease({
      rootDirectory: root, platform: "darwin", architecture: "arm64", run,
    });
    expect(assets.map((path) => basename(path))).toEqual([
      "tournament-overlay-macos-arm64.tar.gz", "tournament-overlay-macos-arm64.dmg",
    ]);
    const disk = resolve(root, "dist/packaging/macos-arm64/dmg");
    const contents = resolve(disk, "Tournament Overlay.app/Contents");
    expect(existsSync(resolve(contents, "MacOS/TournamentOverlay"))).toBe(true);
    expect(existsSync(resolve(contents, "MacOS/TournamentOverlayLauncher"))).toBe(true);
    expect(existsSync(resolve(contents, "Resources/public/overlay/index.html"))).toBe(true);
    expect(existsSync(resolve(contents, "MacOS/public"))).toBe(false);
    expect(readlinkSync(resolve(disk, "Applications"))).toBe("/Applications");
    const plist = readFileSync(resolve(contents, "Info.plist"), "utf8");
    expect(plist).toContain("<string>io.github.davidisrawi.tournament-overlay</string>");
    expect(plist).toContain("<string>0.3.0</string>");
    expect(plist).toContain("<string>13.5</string>");
    expect(plist).toContain("<string>TournamentOverlayLauncher</string>");
    expect(plist).not.toContain("<key>LSUIElement</key>");
    expect(plist).not.toContain("@@");
    expect(run.mock.calls.map(([file]) => file)).toEqual(["tar", "plutil", "xcrun", "codesign", "codesign", "hdiutil"]);
  });

  it("escapes PowerShell paths and requests the exact Windows installer name", () => {
    fixture("win32", "x64");
    const run = vi.fn(
      /** @param {string} file @param {string[]} args */
      (file, args) => {
        const name = file === "powershell.exe"
          ? "tournament-overlay-windows-x64.zip"
          : "tournament-overlay-windows-x64-setup.exe";
        writeFileSync(resolve(root, "dist/release", name), args.join("\n"));
      },
    );
    const assets = packageRelease({
      rootDirectory: root, platform: "win32", architecture: "x64",
      innoSetup: "C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe", run,
    });
    expect(assets.map((path) => basename(path))).toEqual([
      "tournament-overlay-windows-x64.zip", "tournament-overlay-windows-x64-setup.exe",
    ]);
    const calls = run.mock.calls;
    expect(calls[0]?.[1].at(-1)).toContain("Package O''Brien");
    expect(calls[0]?.[1].at(-1)).toContain("Compress-Archive -LiteralPath");
    expect(calls[1]?.[1]).toContain("/DAppVersionNumeric=0.3.0.0");
    expect(calls[1]?.[1]).toContain(
      `/DSourceDir=${resolve(root, "dist/packaging/windows-x64/portable")}`,
    );
    expect(powershellLiteral("C:\\O'Brien\\space here")).toBe("'C:\\O''Brien\\space here'");
  });

  it("reserves only the installation payload for deletion and disables automatic restarts", () => {
    const installer = readFileSync(resolve(import.meta.dirname, "windows.iss"), "utf8");
    expect(installer).toContain("PrivilegesRequired=lowest");
    expect(installer).toContain("DefaultDirName={localappdata}\\Programs\\Tournament Overlay");
    expect(installer).toContain('Type: filesandordirs; Name: "{app}\\app"');
    expect(installer).toContain("CloseApplications=no");
    expect(installer).toContain("RestartApplications=no");
    expect(installer).toContain("Handle := CreateFileW");
    expect(installer).toContain("not FileExists(ExpandConstant('{app}\\app\\.tournament-overlay-installation'))");
    expect(installer).toContain("function InitializeUninstall");
    expect(installer).not.toMatch(/\[Run\]|\[UninstallDelete\]|restartreplace|Flags:.*run/);
    expect(installer).not.toContain("{userappdata}");
  });

  it("fails rather than leaving unresolved template metadata", () => {
    expect(() => renderTemplate("Info.plist", { VERSION: "0.3.0" })).toThrow("ARCHITECTURE");
  });
});
