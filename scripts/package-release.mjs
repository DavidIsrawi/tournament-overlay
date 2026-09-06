import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";

const projectDirectory = resolve(import.meta.dirname, "..");
const templatesDirectory = resolve(import.meta.dirname, "packaging");
const buildInfoSchema = z.object({
  version: z.string(),
  platform: z.string(),
  architecture: z.string(),
  nodeVersion: z.string().regex(/^v24\./),
});
const packageInfoSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
});
const browserBuildInfoSchema = z.object({ appVersion: z.string() });

/** @param {string} platform @param {string} architecture */
export function releaseTarget(platform, architecture) {
  /** @type {Record<string, string>} */
  const targets = {
    "darwin-arm64": "macos-arm64",
    "darwin-x64": "macos-x64",
    "win32-x64": "windows-x64",
    "linux-x64": "linux-x64",
  };
  const target = targets[`${platform}-${architecture}`];
  if (target === undefined) {
    throw new Error(`Unsupported release platform: ${platform}-${architecture}`);
  }
  return target;
}

/** @param {string} value */
export function powershellLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

/** @param {string} name @param {Record<string, string>} values */
export function renderTemplate(name, values) {
  let template = readFileSync(resolve(templatesDirectory, name), "utf8");
  for (const [key, value] of Object.entries(values)) {
    template = template.replaceAll(`@@${key}@@`, value);
  }
  const missing = template.match(/@@([A-Z_]+)@@/);
  if (missing !== null) {
    throw new Error(`Missing ${missing[0]} when rendering ${name}.`);
  }
  return template;
}

/** @param {string} path */
function assertRegularTree(path) {
  const entry = lstatSync(path);
  if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) {
    throw new Error(`Release payload must contain only regular files: ${path}`);
  }
  if (entry.isDirectory()) {
    for (const child of readdirSync(path)) {
      assertRegularTree(resolve(path, child));
    }
  }
}

/**
 * @param {string} directory
 * @param {string} version
 * @param {string} platform
 * @param {string} architecture
 */
export function validatePayload(directory, version, platform, architecture) {
  const executableName =
    platform === "win32" ? "TournamentOverlay.exe" : "TournamentOverlay";
  for (const name of [executableName, "public", "build-info.json"]) {
    assertRegularTree(resolve(directory, name));
  }
  if (!lstatSync(resolve(directory, executableName)).isFile() ||
      !lstatSync(resolve(directory, "public")).isDirectory()) {
    throw new Error("The release payload needs an executable file and public directory.");
  }
  const buildInfo = buildInfoSchema.parse(
    JSON.parse(readFileSync(resolve(directory, "build-info.json"), "utf8")),
  );
  if (buildInfo.version !== version ||
      buildInfo.platform !== platform ||
      buildInfo.architecture !== architecture) {
    throw new Error("Executable build metadata does not match this release. Rebuild first.");
  }
  for (const directoryName of ["public", "public/overlay"]) {
    const browserBuildInfo = browserBuildInfoSchema.parse(
      JSON.parse(readFileSync(resolve(directory, directoryName, "app-build.json"), "utf8")),
    );
    if (browserBuildInfo.appVersion !== version ||
        !lstatSync(resolve(directory, directoryName, "index.html")).isFile()) {
      throw new Error("Browser assets do not match this release. Rebuild first.");
    }
  }
  return executableName;
}

function findInnoSetup() {
  const candidates = [
    process.env.ISCC_PATH,
    ...[process.env["ProgramFiles(x86)"], process.env.ProgramFiles]
      .filter((directory) => directory !== undefined)
      .map((directory) => resolve(directory, "Inno Setup 6", "ISCC.exe")),
  ];
  const compiler = candidates.find((candidate) => candidate && existsSync(candidate));
  if (compiler !== undefined) {
    return compiler;
  }
  throw new Error(
    "Inno Setup 6 is required. Install it and set ISCC_PATH to its ISCC.exe compiler.",
  );
}

/**
 * @param {{
 *   rootDirectory?: string,
 *   outputDirectory?: string,
 *   platform?: string,
 *   architecture?: string,
 *   run?: (file: string, args: string[], options: {stdio: "inherit"}) => unknown,
 *   innoSetup?: string,
 * }} options
 */
export function packageRelease({
  rootDirectory = projectDirectory,
  outputDirectory = resolve(rootDirectory, "dist/release"),
  platform = process.platform,
  architecture = process.arch,
  run = execFileSync,
  innoSetup,
} = {}) {
  const target = releaseTarget(platform, architecture);
  const { version } = packageInfoSchema.parse(
    JSON.parse(readFileSync(resolve(rootDirectory, "package.json"), "utf8")),
  );
  if (version.split(".").some((part) => Number(part) > 65_535)) {
    throw new Error("Package version components must fit native installer metadata.");
  }
  const inputDirectory = resolve(rootDirectory, "dist/executable");
  const executableName = validatePayload(inputDirectory, version, platform, architecture);
  const stageDirectory = resolve(rootDirectory, "dist/packaging", target);
  const portableDirectory = resolve(stageDirectory, "portable");
  const basename = `tournament-overlay-${target}`;
  const assets = [];

  rmSync(stageDirectory, { recursive: true, force: true });
  mkdirSync(portableDirectory, { recursive: true });
  mkdirSync(outputDirectory, { recursive: true });
  // Copy an allowlist, never .env, local state, or other files next to the binary.
  for (const name of [executableName, "public", "build-info.json"]) {
    cpSync(resolve(inputDirectory, name), resolve(portableDirectory, name), {
      recursive: true,
    });
  }
  if (platform !== "win32") {
    chmodSync(resolve(portableDirectory, executableName), 0o755);
  }
  const readme = renderTemplate(`README-${platform}.txt`, { VERSION: version });
  writeFileSync(resolve(portableDirectory, "README.txt"), readme);

  if (platform === "win32") {
    const archive = resolve(outputDirectory, `${basename}.zip`);
    run("powershell.exe", [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
      `$ErrorActionPreference = 'Stop'; Compress-Archive -LiteralPath ` +
        `(Get-ChildItem -LiteralPath ${powershellLiteral(portableDirectory)}).FullName ` +
        `-DestinationPath ${powershellLiteral(archive)} -Force`,
    ], { stdio: "inherit" });
    assets.push(archive);
    run(innoSetup ?? findInnoSetup(), [
      `/DAppVersion=${version}`,
      `/DAppVersionNumeric=${version}.0`,
      `/DSourceDir=${portableDirectory}`,
      `/DOutputDir=${outputDirectory}`,
      resolve(templatesDirectory, "windows.iss"),
    ], { stdio: "inherit" });
    assets.push(resolve(outputDirectory, `${basename}-setup.exe`));
  } else {
    const archive = resolve(outputDirectory, `${basename}.tar.gz`);
    run("tar", ["-C", portableDirectory, "-czf", archive, "."], { stdio: "inherit" });
    assets.push(archive);
    if (platform === "darwin") {
      const diskDirectory = resolve(stageDirectory, "dmg");
      const contentsDirectory = resolve(diskDirectory, "Tournament Overlay.app/Contents");
      mkdirSync(resolve(contentsDirectory, "MacOS"), { recursive: true });
      mkdirSync(resolve(contentsDirectory, "Resources"), { recursive: true });
      copyFileSync(resolve(portableDirectory, executableName), resolve(contentsDirectory, "MacOS", executableName));
      for (const resource of ["public", "build-info.json", "README.txt"]) {
        cpSync(resolve(portableDirectory, resource), resolve(contentsDirectory, "Resources", resource), { recursive: true });
      }
      const plistPath = resolve(contentsDirectory, "Info.plist");
      writeFileSync(plistPath, renderTemplate("Info.plist", {
        VERSION: version,
        ARCHITECTURE: architecture === "x64" ? "x86_64" : "arm64",
      }));
      writeFileSync(resolve(contentsDirectory, "PkgInfo"), "APPL????");
      copyFileSync(resolve(portableDirectory, "README.txt"), resolve(diskDirectory, "README.txt"));
      symlinkSync("/Applications", resolve(diskDirectory, "Applications"));
      run("plutil", ["-lint", plistPath], { stdio: "inherit" });
      run("xcrun", [
        "swiftc", "-O", "-swift-version", "5",
        "-target", `${architecture === "x64" ? "x86_64" : "arm64"}-apple-macos13.5`,
        "-framework", "AppKit",
        resolve(templatesDirectory, "MacLauncher.swift"),
        "-o", resolve(contentsDirectory, "MacOS/TournamentOverlayLauncher"),
      ], { stdio: "inherit" });
      run("codesign", ["--force", "--sign", "-", resolve(diskDirectory, "Tournament Overlay.app")], { stdio: "inherit" });
      run("codesign", ["--verify", "--deep", "--strict", resolve(diskDirectory, "Tournament Overlay.app")], { stdio: "inherit" });
      const diskImage = resolve(outputDirectory, `${basename}.dmg`);
      run("hdiutil", [
        "create", "-volname", `Tournament Overlay ${version}`,
        "-srcfolder", diskDirectory, "-fs", "HFS+", "-format", "UDZO", "-ov", diskImage,
      ], { stdio: "inherit" });
      assets.push(diskImage);
    }
  }
  for (const asset of assets) {
    if (!existsSync(asset) || !lstatSync(asset).isFile() || lstatSync(asset).size === 0) {
      throw new Error(`Packaging did not create an expected asset: ${asset}`);
    }
  }
  return assets;
}

if (process.argv[1] !== undefined &&
    pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({ options: { target: { type: "string" } } });
  const hostTarget = releaseTarget(process.platform, process.arch);
  if (values.target !== undefined && values.target !== hostTarget) {
    throw new Error(`Target ${values.target} does not match this host (${hostTarget}).`);
  }
  for (const asset of packageRelease()) {
    console.log(`Release package created at ${asset}`);
  }
}
