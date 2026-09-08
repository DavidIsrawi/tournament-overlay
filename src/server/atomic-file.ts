import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

export async function writePrivateFile(filePath: string, content: Buffer | string): Promise<void> {
  const file = await open(filePath, "wx", 0o600);
  try {
    await file.writeFile(content);
    await file.sync();
    await file.close();
  } catch (error) {
    // Cleanup must not mask the original write/sync/close failure.
    await file.close().catch(() => {});
    await rm(filePath, { force: true }).catch(() => {});
    throw error;
  }
}

export async function replacePrivateFile(filePath: string, content: Buffer | string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await writePrivateFile(temporaryPath, content);
  try {
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}
