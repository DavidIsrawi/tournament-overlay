import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const releaseTypeSchema = z.enum(["patch", "minor", "major"]);
type ReleaseType = z.infer<typeof releaseTypeSchema>;

const packageSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
});

function fail(message: string): never {
  console.error(`Release aborted: ${message}`);
  process.exit(1);
}

function command(
  executable: string,
  arguments_: readonly string[],
  options: { readonly capture?: boolean } = {},
): string {
  try {
    const result = execFileSync(executable, arguments_, {
      encoding: options.capture ? "utf8" : undefined,
      stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
    });
    return typeof result === "string" ? result.trim() : "";
  } catch {
    fail(`"${executable} ${arguments_.join(" ")}" failed.`);
  }
}

function nextVersion(version: string, releaseType: ReleaseType): string {
  const [major, minor, patch] = version.split(".").map(Number);
  if (major === undefined || minor === undefined || patch === undefined) {
    fail(`Package version "${version}" is not valid semantic versioning.`);
  }
  switch (releaseType) {
    case "major":
      return `${String(major + 1)}.0.0`;
    case "minor":
      return `${String(major)}.${String(minor + 1)}.0`;
    case "patch":
      return `${String(major)}.${String(minor)}.${String(patch + 1)}`;
  }
}

function parseArguments(arguments_: readonly string[]): {
  readonly releaseType: ReleaseType;
  readonly dryRun: boolean;
} {
  const dryRun = arguments_.includes("--dry-run");
  const releaseFlags = arguments_.filter((argument) =>
    ["--patch", "--minor", "--major"].includes(argument),
  );
  const unknownArguments = arguments_.filter(
    (argument) =>
      argument !== "--dry-run" && !releaseFlags.includes(argument),
  );

  if (unknownArguments.length > 0) {
    fail(`Unknown argument: ${unknownArguments.join(", ")}`);
  }
  if (releaseFlags.length !== 1) {
    fail("Pass exactly one of --patch, --minor, or --major.");
  }

  return {
    releaseType: releaseTypeSchema.parse(releaseFlags[0]?.slice(2)),
    dryRun,
  };
}

const { releaseType, dryRun } = parseArguments(process.argv.slice(2));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const currentPackage = packageSchema.parse(
  JSON.parse(readFileSync(resolve("package.json"), "utf8")),
);
const targetVersion = nextVersion(currentPackage.version, releaseType);
const targetTag = `v${targetVersion}`;

if (command("git", ["branch", "--show-current"], { capture: true }) !== "main") {
  fail("releases must be created from main.");
}
if (command("git", ["status", "--porcelain"], { capture: true }) !== "") {
  fail("the working tree must be clean.");
}

console.log("Checking main against origin...");
command("git", ["fetch", "origin", "main", "--tags"]);
const localHead = command("git", ["rev-parse", "HEAD"], { capture: true });
const remoteHead = command("git", ["rev-parse", "origin/main"], {
  capture: true,
});
if (localHead !== remoteHead) {
  fail("local main must exactly match origin/main.");
}
if (
  command("git", ["tag", "--list", targetTag], { capture: true }) !== ""
) {
  fail(`tag ${targetTag} already exists.`);
}

console.log(`Preparing ${releaseType} release ${targetTag}...`);
command(npm, ["run", "lint"]);
command(npm, ["test"]);
command(npm, ["run", "build"]);

if (dryRun) {
  console.log(
    `Dry run complete. A real run would create and push ${targetTag}.`,
  );
  process.exit(0);
}

const createdVersion = command(
  npm,
  ["version", releaseType, "-m", "Release v%s"],
  { capture: true },
);
if (createdVersion !== targetTag) {
  fail(
    `npm created "${createdVersion}" instead of the expected tag "${targetTag}".`,
  );
}

console.log(`Pushing main and ${targetTag} atomically...`);
command("git", ["push", "--atomic", "origin", "main", targetTag]);
console.log(
  `${targetTag} pushed. GitHub Actions will publish the release after all platform builds pass.`,
);
