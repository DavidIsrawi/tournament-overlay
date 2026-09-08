import { resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderError, ProviderRegistry } from "../providers/index.ts";
import type { OperatorState } from "../shared/contracts.ts";
import { buildApp } from "./app.ts";
import { fixtureEvent, fixtureProvider, MemoryOperatorStore } from "./fixtures.test-support.ts";
import { TournamentService } from "./service.ts";
import { startServer } from "./startup.ts";

const services: TournamentService[] = [];
const apps: FastifyInstance[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  services.splice(0).forEach((service) => service.close());
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.useRealTimers();
});

function createService() {
  const provider = fixtureProvider();
  const loadEvent = vi.spyOn(provider, "loadEvent");
  const loadPhaseGroupSets = vi.spyOn(provider, "loadPhaseGroupSets");
  const loadSet = vi.spyOn(provider, "loadSet");
  const store = new MemoryOperatorStore();
  const load = vi.spyOn(store, "load");
  const save = vi.spyOn(store, "save");
  const service = new TournamentService(new ProviderRegistry([provider]), store, 1_000);
  services.push(service);
  const operator: OperatorState = {
    ...structuredClone(service.getState().operator),
    eventInput: fixtureEvent().slug,
    selectedPhaseGroupId: "group-1",
    selectedSetId: "group-1-a",
    liveSelection: {
      providerId: "startgg",
      eventInput: fixtureEvent().slug,
      phaseGroupId: "group-1",
      setId: "group-1-a",
    },
  };
  store.state = operator;
  return {
    service, operator, load, save, loadEvent, loadPhaseGroupSets, loadSet,
    initialize: vi.spyOn(service, "initialize"),
    closeService: vi.spyOn(service, "close"),
  };
}

async function createApp(service: TournamentService) {
  const app = await buildApp(service, resolve("src/server/startup-test-assets-missing"));
  apps.push(app);
  return {
    app,
    closeApp: vi.spyOn(app, "close"),
    logError: vi.spyOn(app.log, "error").mockImplementation(() => undefined),
  };
}

function address(app: FastifyInstance): { port: number; url: string } {
  const listeningAddress = app.server.address();
  if (listeningAddress === null || typeof listeningAddress === "string") {
    throw new Error("Expected an HTTP listener");
  }
  return {
    port: listeningAddress.port,
    url: `http://127.0.0.1:${String(listeningAddress.port)}`,
  };
}

describe("server startup lifecycle", () => {
  it("does not restore, poll, or write state when another instance owns the port", async () => {
    const occupied = Fastify();
    apps.push(occupied);
    occupied.get("/active", () => ({ active: true }));
    await occupied.listen({ host: "127.0.0.1", port: 0 });
    const { port, url } = address(occupied);
    const fixture = createService();
    const { app, closeApp } = await createApp(fixture.service);
    const onReady = vi.fn();

    await expect(startServer({
      service: fixture.service,
      createApp: () => Promise.resolve(app),
      port,
      onReady,
    })).rejects.toMatchObject({ code: "EADDRINUSE" });

    expect(fixture.initialize).not.toHaveBeenCalled();
    expect(fixture.load).not.toHaveBeenCalled();
    expect(fixture.save).not.toHaveBeenCalled();
    expect(fixture.loadEvent).not.toHaveBeenCalled();
    expect(fixture.loadPhaseGroupSets).not.toHaveBeenCalled();
    expect(fixture.loadSet).not.toHaveBeenCalled();
    expect(fixture.closeService).toHaveBeenCalledExactlyOnceWith();
    expect(closeApp).toHaveBeenCalledExactlyOnceWith();
    expect(app.server.listening).toBe(false);
    expect(onReady).not.toHaveBeenCalled();
    await expect(fixture.service.dispatch({ type: "presentation.swap" })).rejects.toThrow("closed");
    const response = await fetch(`${url}/active`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ active: true });
  });

  it("closes the service if building the app rejects before returning an app", async () => {
    const fixture = createService();

    await expect(startServer({
      service: fixture.service,
      createApp: () => buildApp(fixture.service, resolve("src/server")),
      port: 0,
    })).rejects.toThrow("npm run build");

    expect(fixture.closeService).toHaveBeenCalledExactlyOnceWith();
    expect(fixture.initialize).not.toHaveBeenCalled();
    expect(fixture.load).not.toHaveBeenCalled();
    expect(fixture.save).not.toHaveBeenCalled();
  });

  it("cleans up a bound app if readiness setup throws", async () => {
    const fixture = createService();
    const { app, closeApp } = await createApp(fixture.service);
    const error = new Error("Readiness setup failed");

    await expect(startServer({
      service: fixture.service,
      createApp: () => Promise.resolve(app),
      port: 0,
      onReady: () => { throw error; },
    })).rejects.toBe(error);

    expect(fixture.closeService).toHaveBeenCalledExactlyOnceWith();
    expect(closeApp).toHaveBeenCalledExactlyOnceWith();
    expect(app.server.listening).toBe(false);
    expect(fixture.initialize).not.toHaveBeenCalled();
    expect(fixture.load).not.toHaveBeenCalled();
    expect(fixture.save).not.toHaveBeenCalled();
  });

  it.each(["restore", "provider"] as const)(
    "keeps serving an explicit dashboard error after a recoverable %s rejection",
    async (failure) => {
      const fixture = createService();
      const { app, closeApp, logError } = await createApp(fixture.service);
      const error = failure === "restore"
        ? new Error("Saved schema is newer than this application")
        : new ProviderError("invalid_event", "Saved event is unavailable");
      if (failure === "restore") {
        fixture.load.mockRejectedValue(error);
      } else {
        fixture.loadEvent.mockRejectedValue(error);
      }

      const server = await startServer({
        service: fixture.service,
        createApp: () => Promise.resolve(app),
        port: 0,
      });

      await vi.waitFor(() => expect(logError).toHaveBeenCalledWith(
        error, "Failed to initialize persisted operator state",
      ));
      expect(fixture.closeService).not.toHaveBeenCalled();
      expect(closeApp).not.toHaveBeenCalled();
      expect(app.server.listening).toBe(true);
      const response = await fetch(`${address(app).url}/api/health`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        ok: false,
        connection: { status: "error", message: expect.stringContaining(error.message) as unknown },
      });
      if (failure === "restore") {
        expect(fixture.save).not.toHaveBeenCalled();
        expect(fixture.loadEvent).not.toHaveBeenCalled();
      }
      await server.close();
    },
  );

  it("binds before restoring, serves while initialization waits, and closes polling only once", async () => {
    const fixture = createService();
    const { app, closeApp } = await createApp(fixture.service);
    const restore = Promise.withResolvers<OperatorState>();
    fixture.load.mockImplementation(() => {
      expect(app.server.listening).toBe(true);
      return restore.promise;
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const server = await startServer({
      service: fixture.service,
      createApp: () => Promise.resolve(app),
      port: 0,
    });

    expect(fixture.initialize).toHaveBeenCalledExactlyOnceWith();
    expect(fixture.load).toHaveBeenCalledOnce();
    expect(fixture.loadEvent).not.toHaveBeenCalled();
    expect((await fetch(`${address(app).url}/api/health`)).status).toBe(200);
    restore.resolve(fixture.operator);
    await vi.waitFor(() => expect(fixture.service.getState()).toMatchObject({
      connection: { status: "fresh" },
      liveConnection: { status: "fresh" },
      event: { id: "event-1" },
      overlay: { setId: "group-1-a" },
    }));
    expect(fixture.save).toHaveBeenCalled();
    expect(fixture.loadSet).toHaveBeenCalled();
    const closing = server.close();
    expect(server.close()).toBe(closing);
    await closing;

    expect(fixture.closeService).toHaveBeenCalledExactlyOnceWith();
    expect(closeApp).toHaveBeenCalledExactlyOnceWith();
    expect(app.server.listening).toBe(false);
    fixture.loadEvent.mockClear();
    fixture.loadPhaseGroupSets.mockClear();
    fixture.loadSet.mockClear();
    fixture.save.mockClear();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fixture.loadEvent).not.toHaveBeenCalled();
    expect(fixture.loadPhaseGroupSets).not.toHaveBeenCalled();
    expect(fixture.loadSet).not.toHaveBeenCalled();
    expect(fixture.save).not.toHaveBeenCalled();
  });

  it("can shut down while restore is pending without allowing its late result to start work", async () => {
    const fixture = createService();
    const { app, closeApp } = await createApp(fixture.service);
    const restore = Promise.withResolvers<OperatorState>();
    fixture.load.mockReturnValue(restore.promise);
    const server = await startServer({
      service: fixture.service,
      createApp: () => Promise.resolve(app),
      port: 0,
    });

    await server.close();
    restore.resolve(fixture.operator);
    const initialization = fixture.initialize.mock.results[0];
    if (initialization?.type !== "return") {
      throw new Error("Expected initialization to have started");
    }
    await initialization.value;

    expect(fixture.closeService).toHaveBeenCalledExactlyOnceWith();
    expect(closeApp).toHaveBeenCalledExactlyOnceWith();
    expect(app.server.listening).toBe(false);
    expect(fixture.loadEvent).not.toHaveBeenCalled();
    expect(fixture.loadPhaseGroupSets).not.toHaveBeenCalled();
    expect(fixture.loadSet).not.toHaveBeenCalled();
    expect(fixture.save).not.toHaveBeenCalled();
  });

  it("closes the app even when service cleanup throws and preserves the startup error", async () => {
    const fixture = createService();
    const { app, closeApp } = await createApp(fixture.service);
    const startupError = new Error("Listen failed");
    const cleanupError = new Error("Service close failed");
    vi.spyOn(app, "listen").mockRejectedValue(startupError);
    fixture.closeService.mockImplementation(() => { throw cleanupError; });

    await expect(startServer({
      service: fixture.service,
      createApp: () => Promise.resolve(app),
      port: 0,
    })).rejects.toMatchObject({
      errors: [startupError, expect.objectContaining({ errors: [cleanupError] })],
    });

    expect(closeApp).toHaveBeenCalledExactlyOnceWith();
    expect(fixture.initialize).not.toHaveBeenCalled();
  });

  it("closes the service and reports app shutdown rejection through the shared close promise", async () => {
    const fixture = createService();
    const { app, closeApp } = await createApp(fixture.service);
    fixture.initialize.mockResolvedValue();
    const server = await startServer({
      service: fixture.service,
      createApp: () => Promise.resolve(app),
      port: 0,
    });
    const error = new Error("App close failed");
    closeApp.mockRejectedValue(error);

    const closing = server.close();
    await expect(closing).rejects.toMatchObject({ errors: [error] });
    expect(server.close()).toBe(closing);
    expect(fixture.closeService).toHaveBeenCalledExactlyOnceWith();
    expect(closeApp).toHaveBeenCalledExactlyOnceWith();
  });
});
