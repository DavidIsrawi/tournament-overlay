import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderError, ProviderRegistry, type TournamentDataProvider } from "../providers/index.ts";
import {
  PROTOCOL_VERSION,
  serverMessageSchema,
  type ClientCommand,
  type ServerMessage,
} from "../shared/contracts.ts";
import { buildApp } from "./app.ts";
import { fixtureEvent, fixtureProvider, MemoryOperatorStore } from "./fixtures.test-support.ts";
import { TournamentService } from "./service.ts";
import { APP_VERSION } from "../shared/app-info.ts";

const resources: { app: FastifyInstance; service: TournamentService; sockets: WebSocket[] }[] = [];

afterEach(async () => {
  for (const resource of resources.splice(0)) {
    resource.service.close();
    resource.sockets.forEach((socket) => socket.terminate());
    await resource.app.close();
  }
});

async function setup(provider: TournamentDataProvider = fixtureProvider()) {
  const service = new TournamentService(new ProviderRegistry([provider]), new MemoryOperatorStore(), 60_000);
  const app = await buildApp(service, "/nonexistent-tournament-overlay-test-assets");
  await app.ready();
  const resource = { app, service, sockets: [] as WebSocket[] };
  resources.push(resource);
  const connect = async (hello = true) => {
    const socket = await app.injectWS("/ws");
    resource.sockets.push(socket);
    const messages: ServerMessage[] = [];
    socket.on("message", (data) => {
      const text = Array.isArray(data) ? Buffer.concat(data).toString()
        : data instanceof ArrayBuffer ? Buffer.from(data).toString()
          : data.toString();
      messages.push(serverMessageSchema.parse(JSON.parse(text)));
    });
    if (hello) {
      socket.send(JSON.stringify({ type: "client.hello", appVersion: APP_VERSION, protocolVersion: PROTOCOL_VERSION, client: "dashboard" }));
      await vi.waitFor(() => expect(messages[0]?.type).toBe("state.snapshot"));
    }
    const send = (commandId: string, command: ClientCommand): void => {
      socket.send(JSON.stringify({ type: "command", commandId, command }));
    };
    const completion = async (id: string): Promise<ServerMessage> => {
      await vi.waitFor(() => expect(messages.some((message) =>
        message.type !== "state.snapshot" && message.commandId === id)).toBe(true));
      const result = messages.find((message) => message.type !== "state.snapshot" && message.commandId === id);
      if (result === undefined) {
        throw new Error("Missing command result");
      }
      return result;
    };
    return { socket, messages, send, completion };
  };
  return { service, connect };
}

describe("live WebSocket protocol", () => {
  it.each([
    { protocolVersion: PROTOCOL_VERSION - 1 },
    { protocolVersion: PROTOCOL_VERSION, appVersion: "0.0.1" },
    { protocolVersion: PROTOCOL_VERSION },
  ])("rejects mismatched clients before sending state or accepting commands", async (version) => {
    const { connect, service } = await setup();
    const client = await connect(false);
    const closed = new Promise<number>((resolve) => client.socket.once("close", resolve));
    client.socket.send(JSON.stringify({ type: "client.hello", client: "dashboard", ...version }));
    expect(await closed).toBe(4006);
    expect(client.messages).toEqual([expect.objectContaining({
      type: "command.error", code: "client_version_mismatch",
    })]);
    expect(client.messages.find((message) => message.type === "command.error")?.message).toContain("Reload this dashboard");
    expect(service.getState().revision).toBe(0);
  });

  it("tells an old overlay client to refresh its OBS browser source", async () => {
    const { connect } = await setup();
    const client = await connect(false);
    client.socket.send(JSON.stringify({ type: "client.hello", client: "overlay", protocolVersion: 5 }));
    await vi.waitFor(() => expect(client.messages[0]).toMatchObject({
      type: "command.error", code: "client_version_mismatch",
    }));
    expect(client.messages.find((message) => message.type === "command.error")?.message).toContain("Refresh this browser source in OBS");
  });

  it("requires the current protocol hello before accepting a command", async () => {
    const { connect } = await setup();
    const client = await connect(false);
    client.send("swap", { type: "presentation.swap" });
    expect(await client.completion("swap")).toMatchObject({ type: "command.error", code: "hello_required" });
  });

  it("synchronizes preview, Take live, presentation and reconnect snapshots", async () => {
    const { connect, service } = await setup();
    const dashboard = await connect();
    const overlay = await connect();
    dashboard.send("load", { type: "event.load", providerId: "startgg", input: fixtureEvent().slug });
    expect(await dashboard.completion("load")).toMatchObject({ type: "command.ack" });
    expect(service.getState().overlay.setId).toBeNull();
    dashboard.send("take", { type: "live.take", eventId: "event-1", setId: "group-1-a" });
    expect(await dashboard.completion("take")).toMatchObject({ type: "command.ack" });
    await vi.waitFor(() => expect(overlay.messages.at(-1)).toMatchObject({
      type: "state.snapshot", state: { overlay: { setId: "group-1-a" } },
    }));
    dashboard.send("browse", { type: "phase.select", phaseGroupId: "group-2" });
    await dashboard.completion("browse");
    dashboard.send("swap", { type: "presentation.swap" });
    await dashboard.completion("swap");
    overlay.socket.terminate();
    const reconnected = await connect();
    expect(reconnected.messages[0]).toMatchObject({
      type: "state.snapshot",
      state: {
        operator: { selectedPhaseGroupId: "group-2", presentation: { sideOrder: "swapped" } },
        overlay: { setId: "group-1-a", players: [
          { sourceEntrantId: "group-1-a-player-1" },
          { sourceEntrantId: "group-1-a-player-0" },
        ] },
      },
    });
  });

  it("returns a correlated error rather than an acknowledgment for failed provider loads", async () => {
    const { connect } = await setup({
      ...fixtureProvider(),
      loadEvent: () => Promise.reject(new ProviderError("invalid_event", "Use an event URL")),
    });
    const client = await connect();
    client.send("failed", { type: "event.load", providerId: "startgg", input: "bad-input" });
    expect(await client.completion("failed")).toMatchObject({
      type: "command.error", commandId: "failed", code: "invalid_event", message: "Use an event URL",
    });
    expect(client.messages.some((message) => message.type === "command.ack")).toBe(false);
  });

  it("executes duplicate command IDs only once, including after completion", async () => {
    const { connect, service } = await setup();
    const client = await connect();
    client.send("same-id", { type: "presentation.swap" });
    client.send("same-id", { type: "presentation.swap" });
    await vi.waitFor(() => expect(client.messages.filter((message) => message.type === "command.ack")).toHaveLength(2));
    client.send("same-id", { type: "presentation.swap" });
    await vi.waitFor(() => expect(client.messages.filter((message) => message.type === "command.ack")).toHaveLength(3));
    expect(service.getState().operator.presentation.sideOrder).toBe("swapped");
    expect(service.getState().revision).toBe(1);
  });

  it("reports superseded phase requests instead of acknowledging cancelled work", async () => {
    const provider = fixtureProvider();
    let loading = false;
    const { connect } = await setup({
      ...provider,
      loadPhaseGroupSets: (id, name, options) => id === "group-2"
        ? new Promise((_resolve, reject) => {
            loading = true;
            options?.signal?.addEventListener("abort", () => reject(new DOMException("Superseded", "AbortError")), { once: true });
          })
        : provider.loadPhaseGroupSets(id, name, options),
    });
    const client = await connect();
    client.send("load", { type: "event.load", providerId: "startgg", input: fixtureEvent().slug });
    await client.completion("load");
    client.send("slow", { type: "phase.select", phaseGroupId: "group-2" });
    await vi.waitFor(() => expect(loading).toBe(true));
    client.send("new", { type: "phase.select", phaseGroupId: "group-1" });
    expect(await client.completion("slow")).toMatchObject({ type: "command.error", code: "command_superseded" });
    expect(await client.completion("new")).toMatchObject({ type: "command.ack" });
  });
});
