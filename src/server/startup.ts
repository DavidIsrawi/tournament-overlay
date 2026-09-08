import type { FastifyInstance } from "fastify";
import type { TournamentService } from "./service.ts";

export interface RunningServer {
  readonly app: FastifyInstance;
  readonly close: () => Promise<void>;
}

export async function startServer({
  service,
  createApp,
  port,
  onReady,
}: {
  readonly service: Pick<TournamentService, "initialize" | "close">;
  readonly createApp: () => Promise<FastifyInstance>;
  readonly port: number;
  readonly onReady?: (app: FastifyInstance) => void;
}): Promise<RunningServer> {
  let app: FastifyInstance | undefined;
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      const errors: unknown[] = [];
      try {
        service.close();
      } catch (error) {
        errors.push(error);
      }
      try {
        await app?.close();
      } catch (error) {
        errors.push(error);
      }
      if (errors.length > 0) {
        throw new AggregateError(errors, "Failed to close Tournament Overlay");
      }
    })();
    return closing;
  };

  try {
    app = await createApp();
    await app.listen({ host: "127.0.0.1", port });
    onReady?.(app);
    const listeningApp = app;
    // Restore can start polling and write settings, so it must not precede binding.
    void Promise.resolve()
      .then(() => service.initialize())
      .catch((error: unknown) => {
        listeningApp.log.error(error, "Failed to initialize persisted operator state");
      });
    return { app, close };
  } catch (error) {
    try {
      await close();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Tournament Overlay failed to start and clean up",
        { cause: cleanupError },
      );
    }
    throw error;
  }
}
