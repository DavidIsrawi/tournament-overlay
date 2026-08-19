import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  operatorStateSchema,
  type OperatorState,
} from "../shared/contracts.ts";

export class AtomicOperatorStateStore {
  public constructor(private readonly filePath: string) {}

  public async load(defaultState: OperatorState): Promise<OperatorState> {
    let content: string;
    try {
      content = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return defaultState;
      }
      throw error;
    }

    const parsed = operatorStateSchema.safeParse(JSON.parse(content));
    if (!parsed.success) {
      throw new Error(
        `Persisted operator state is invalid: ${parsed.error.message}`,
        { cause: parsed.error },
      );
    }

    return parsed.data;
  }

  public async save(state: OperatorState): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${String(process.pid)}.${String(Date.now())}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, this.filePath);
  }
}
