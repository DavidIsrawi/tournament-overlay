import { existsSync } from "node:fs";
import type { ServerMessage } from "../shared/contracts.ts";
import {
  PROTOCOL_VERSION,
  clientMessageSchema,
} from "../shared/contracts.ts";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import type { RawData, WebSocket } from "ws";
import { z } from "zod";
import type { TournamentService } from "./service.ts";
import { ProviderError } from "../providers/index.ts";
import { APP_VERSION, type UpdateCheck } from "../shared/app-info.ts";
import { clientHelloVersionSchema, reloadMessage, versionsMatch } from "../shared/compatibility.ts";
import { assertMatchingBrowserAssets } from "./browser-assets.ts";
import { GitHubUpdateChecker, releaseTarget, UpdateCheckError } from "./updates.ts";

const startGgTokenSchema = z
  .object({
    token: z.string().trim().min(1).max(4_096),
  })
  .strict();

export interface CredentialSettings {
  readonly saveStartGgToken: (token: string) => Promise<void>;
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(message));
  }
}

function rawDataToText(data: RawData): string {
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  return data.toString("utf8");
}

export async function buildApp(
  service: TournamentService,
  publicDirectory: string,
  credentialSettings?: CredentialSettings,
  options: { readonly checkForUpdates?: () => Promise<UpdateCheck> } = {},
): Promise<FastifyInstance> {
  const hasBrowserAssets = existsSync(publicDirectory);
  if (hasBrowserAssets) {
    await assertMatchingBrowserAssets(publicDirectory);
  }
  const app = Fastify({ logger: true });
  await app.register(fastifyWebsocket);
  const info = {
    version: APP_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    platform: process.platform,
    architecture: process.arch,
    target: releaseTarget(process.platform, process.arch),
  };
  const checker = new GitHubUpdateChecker(info.target);

  app.get("/api/app", (_request, reply) => reply.header("Cache-Control", "no-store").send(info));
  app.post("/api/updates/check", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      return await (options.checkForUpdates?.() ?? checker.check());
    } catch (error) {
      if (!(error instanceof UpdateCheckError)) {
        throw error;
      }
      app.log.warn({ err: error }, "Update check failed");
      return reply.code(502).send({ error: error.message });
    }
  });

  app.get("/api/health", () => {
    const state = service.getState();
    return {
      version: APP_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      ok: state.connection.status !== "error",
      startedAt: state.startedAt,
      revision: state.revision,
      provider: state.operator.providerId,
      connection: state.connection,
      liveConnection: state.liveConnection,
    };
  });

  if (credentialSettings !== undefined) {
    app.post("/api/settings/startgg-token", async (request, reply) => {
      const parsed = startGgTokenSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Enter a valid StartGG API token.",
        });
      }
      await credentialSettings.saveStartGgToken(parsed.data.token);
      return reply.code(204).send();
    });
  }

  app.get("/ws", { websocket: true }, (socket) => {
    let identified = false;
    const commands = new Map<string, Promise<ServerMessage>>();
    const completedCommands = new Set<string>();
    const unsubscribe = service.subscribe((state) => {
      if (identified) {
        send(socket, { type: "state.snapshot", state });
      }
    });

    socket.on("message", (data: RawData) => {
      let input: unknown;
      try {
        input = JSON.parse(rawDataToText(data));
      } catch (error) {
        send(socket, {
          type: "command.error",
          commandId: null,
          code: "invalid_json",
          message:
            error instanceof Error
              ? `Message is not valid JSON: ${error.message}`
              : "Message is not valid JSON.",
        });
        return;
      }

      const hello = clientHelloVersionSchema.safeParse(input);
      if (hello.success && !versionsMatch(hello.data.appVersion, hello.data.protocolVersion)) {
        identified = false;
        send(socket, {
          type: "command.error",
          commandId: null,
          code: "client_version_mismatch",
          message: reloadMessage(hello.data.client),
        });
        socket.close(4006, "Reload the dashboard or refresh the OBS browser source.");
        return;
      }

      const parsed = clientMessageSchema.safeParse(input);
      if (!parsed.success) {
        send(socket, {
          type: "command.error",
          commandId: null,
          code: "invalid_message",
          message: parsed.error.message,
        });
        return;
      }

      if (parsed.data.type === "client.hello") {
        identified = true;
        send(socket, {
          type: "state.snapshot",
          state: service.getState(),
        });
        return;
      }
      const commandMessage = parsed.data;

      if (!identified) {
        send(socket, {
          type: "command.error",
          commandId: commandMessage.commandId,
          code: "hello_required",
          message: `Send client.hello for protocol version ${String(PROTOCOL_VERSION)} first.`,
        });
        return;
      }

      const existing = commands.get(commandMessage.commandId);
      if (existing !== undefined) {
        void existing.then((message) => send(socket, message));
        return;
      }
      const result = service
        .dispatch(commandMessage.command)
        .then((): ServerMessage => ({
          type: "command.ack",
          commandId: commandMessage.commandId,
        }))
        .catch((error: unknown): ServerMessage => ({
          type: "command.error",
          commandId: commandMessage.commandId,
          code: error instanceof ProviderError ? error.code
            : error instanceof Error && error.name === "AbortError"
              ? "command_superseded"
              : "command_failed",
          message:
            error instanceof Error ? error.message : "Command failed.",
        }));
      commands.set(commandMessage.commandId, result);
      void result.then((message) => {
        send(socket, message);
        // Keep recent completions to make duplicate command IDs idempotent.
        completedCommands.add(commandMessage.commandId);
        if (completedCommands.size > 100) {
          const oldest = completedCommands.keys().next().value;
          if (oldest !== undefined) {
            commands.delete(oldest);
            completedCommands.delete(oldest);
          }
        }
      });
    });

    socket.on("close", unsubscribe);
  });

  app.get("/overlay/octagon/", (_request, reply) =>
    reply.code(308).redirect("/overlay/?template=octagon"),
  );

  if (hasBrowserAssets) {
    await app.register(fastifyStatic, {
      root: publicDirectory,
      prefix: "/",
      setHeaders(reply, path) {
        if (path.endsWith(".html") || path.endsWith("app-build.json")) {
          void reply.header("Cache-Control", "no-store");
        }
      },
    });
  } else {
    app.get("/", (_request, reply) =>
      reply
        .code(503)
        .type("text/plain")
        .send("Browser assets are not built. Run npm run build."),
    );
  }

  return app;
}
