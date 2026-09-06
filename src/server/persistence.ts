import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { APP_VERSION } from "../shared/app-info.ts";
import {
  operatorStateSchema,
  type OperatorState,
} from "../shared/contracts.ts";

export const SAVED_STATE_SCHEMA_VERSION = 1;

const savedStateSchema = z.strictObject({
  schemaVersion: z.literal(SAVED_STATE_SCHEMA_VERSION),
  appVersion: z.string().trim().min(1),
  // Legacy defaults must only run behind the backed-up schema-0 migration.
  operator: z.unknown().refine((value) =>
    typeof value === "object" &&
    value !== null &&
    "liveSelection" in value &&
    "presentation" in value &&
    typeof value.presentation === "object" &&
    value.presentation !== null &&
    "overlayTemplateId" in value.presentation,
  "Versioned operator state must explicitly include liveSelection and presentation.overlayTemplateId.",
  ).pipe(operatorStateSchema),
});

interface SavedState {
  readonly content: Buffer;
  readonly operator: OperatorState;
  readonly needsMigration: boolean;
}

async function writePrivateFile(filePath: string, content: Buffer | string): Promise<void> {
  const file = await open(filePath, "wx", 0o600);
  try {
    await file.writeFile(content);
    await file.sync();
    await file.close();
  } catch (error) {
    // Cleanup is best-effort; the original write/sync/close failure must win.
    await file.close().catch(() => {});
    await rm(filePath, { force: true }).catch(() => {});
    throw error;
  }
}

export class AtomicOperatorStateStore {
  private loadFailure: { readonly cause: unknown } | null = null;
  private pending: Promise<void> = Promise.resolve();

  public constructor(private readonly filePath: string) {}

  public load(defaultState: OperatorState): Promise<OperatorState> {
    return this.serialize(async () => {
      try {
        const saved = await this.read();
        if (saved?.needsMigration) {
          await this.backup(saved.content);
          await this.write(saved.operator);
        }
        this.loadFailure = null;
        return saved?.operator ?? defaultState;
      } catch (error) {
        this.loadFailure = { cause: error };
        throw error;
      }
    });
  }

  public save(state: OperatorState): Promise<void> {
    return this.serialize(async () => {
      if (this.loadFailure !== null) {
        throw new Error(
          "Cannot save operator state after a failed restore. Restore a compatible saved-state file and load it successfully before saving.",
          { cause: this.loadFailure.cause },
        );
      }

      const parsed = operatorStateSchema.safeParse(state);
      if (!parsed.success) {
        throw new Error(`Cannot save invalid operator state: ${parsed.error.message}`, {
          cause: parsed.error,
        });
      }

      // Inspect every save, including callers that have never loaded this store.
      try {
        const saved = await this.read();
        if (saved?.needsMigration) {
          await this.backup(saved.content);
        }
      } catch (error) {
        this.loadFailure = { cause: error };
        throw error;
      }

      await this.write(parsed.data);
    });
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation);
    // Keep the queue usable after an error without changing the caller's result.
    this.pending = result.then(() => {}, () => {});
    return result;
  }

  private async read(): Promise<SavedState | null> {
    let content: Buffer;
    try {
      content = await readFile(this.filePath);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return null;
      }
      throw error;
    }

    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(content));
    } catch (error) {
      throw new Error("Persisted operator state is not valid UTF-8 JSON. The file was left unchanged.", {
        cause: error,
      });
    }

    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      if ("schemaVersion" in value) {
        // Never pass an unknown envelope through the permissive legacy schema.
        if (
          typeof value.schemaVersion !== "number" ||
          !Number.isSafeInteger(value.schemaVersion)
        ) {
          throw new Error("Persisted operator state has an invalid schemaVersion. The file was left unchanged.");
        }
        if (value.schemaVersion !== SAVED_STATE_SCHEMA_VERSION) {
          throw new Error(
            `Persisted operator state schema version ${String(value.schemaVersion)} is not supported by this application (supported: ${String(SAVED_STATE_SCHEMA_VERSION)}). Use a compatible application or restore a pre-migration backup; downgrades are not automatic. The file was left unchanged.`,
          );
        }

        const parsed = savedStateSchema.safeParse(value);
        if (!parsed.success) {
          throw new Error(`Persisted operator state envelope is invalid: ${parsed.error.message}`, {
            cause: parsed.error,
          });
        }
        return { content, operator: parsed.data.operator, needsMigration: false };
      }

      if ("operator" in value || "appVersion" in value) {
        throw new Error("Persisted operator state envelope is missing schemaVersion. The file was left unchanged.");
      }
    }

    const parsed = operatorStateSchema.safeParse(value);
    if (!parsed.success) {
      throw new Error(
        `Persisted operator state is invalid: ${parsed.error.message}`,
        { cause: parsed.error },
      );
    }

    return { content, operator: parsed.data, needsMigration: true };
  }

  private async backup(content: Buffer): Promise<void> {
    const backupPath = `${this.filePath}.schema-0.${String(Date.now())}.${randomUUID()}.bak`;
    await writePrivateFile(backupPath, content);
  }

  private async write(state: OperatorState): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    await writePrivateFile(temporaryPath, `${JSON.stringify({
      schemaVersion: SAVED_STATE_SCHEMA_VERSION,
      appVersion: APP_VERSION,
      operator: state,
    }, null, 2)}\n`);
    try {
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => {});
      throw error;
    }
  }
}
