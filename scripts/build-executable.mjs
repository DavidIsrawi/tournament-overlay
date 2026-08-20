import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = process.cwd();
const seaDirectory = resolve(root, "dist/sea");
const outputDirectory = resolve(root, "dist/executable");
const bundlePath = resolve(seaDirectory, "server.cjs");
const blobPath = resolve(seaDirectory, "server.blob");
const executableName =
  process.platform === "win32" ? "TournamentOverlay.exe" : "TournamentOverlay";
const executablePath = resolve(outputDirectory, executableName);
const postjectCliPath = resolve(root, "node_modules/postject/dist/cli.js");

function findWindowsSignTool() {
  const programFiles =
    process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const binDirectory = resolve(programFiles, "Windows Kits", "10", "bin");
  if (!existsSync(binDirectory)) {
    return null;
  }
  const architecture = process.arch === "arm64" ? "arm64" : "x64";
  const versions = readdirSync(binDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const version of versions) {
    const candidate = resolve(
      binDirectory,
      version,
      architecture,
      "signtool.exe",
    );
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

mkdirSync(seaDirectory, { recursive: true });
mkdirSync(outputDirectory, { recursive: true });

await build({
  entryPoints: [resolve(root, "src/server/index.ts")],
  outfile: bundlePath,
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node24",
  minify: true,
});

const seaConfigPath = resolve(seaDirectory, "sea-config.json");
writeFileSync(
  seaConfigPath,
  `${JSON.stringify(
    {
      main: bundlePath,
      output: blobPath,
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false,
      execArgvExtension: "none",
    },
    null,
    2,
  )}\n`,
);

execFileSync(process.execPath, ["--experimental-sea-config", seaConfigPath], {
  stdio: "inherit",
});
copyFileSync(process.execPath, executablePath);
chmodSync(executablePath, 0o755);

if (process.platform === "darwin") {
  execFileSync("codesign", ["--remove-signature", executablePath], {
    stdio: "inherit",
  });
} else if (process.platform === "win32") {
  const signTool = findWindowsSignTool();
  if (signTool === null) {
    throw new Error(
      "Windows SDK signtool.exe is required to prepare the Node executable.",
    );
  }
  execFileSync(signTool, ["remove", "/s", executablePath], {
    stdio: "inherit",
  });
}

const postjectArguments = [
  executablePath,
  "NODE_SEA_BLOB",
  blobPath,
  "--sentinel-fuse",
  "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
];
if (process.platform === "darwin") {
  postjectArguments.push("--macho-segment-name", "NODE_SEA");
}
execFileSync(process.execPath, [postjectCliPath, ...postjectArguments], {
  stdio: "inherit",
});

if (process.platform === "darwin") {
  execFileSync("codesign", ["--sign", "-", executablePath], {
    stdio: "inherit",
  });
}

cpSync(resolve(root, "dist/public"), resolve(outputDirectory, "public"), {
  recursive: true,
});

console.log(`Executable package created at ${outputDirectory}`);
