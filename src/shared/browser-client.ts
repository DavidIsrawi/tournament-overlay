import {
  PROTOCOL_VERSION,
  serverMessageSchema,
  type ClientCommand,
  type ClientMessage,
  type ServerState,
} from "./contracts.ts";
import {
  deriveOverlayAnimationEvents,
  type OverlayAnimationEvent,
} from "./overlay-events.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import { CommandTracker, type PendingCommand } from "./command-tracker.ts";
import { APP_VERSION } from "./app-info.ts";
import { reloadMessage, snapshotNeedsReload } from "./compatibility.ts";

export type SocketStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

interface TournamentSocket {
  readonly state: ServerState | null;
  readonly socketStatus: SocketStatus;
  readonly error: string | null;
  readonly animationEvents: readonly OverlayAnimationEvent[];
  readonly pendingCommands: readonly PendingCommand[];
  readonly upgradeRequired: boolean;
  readonly dismissError: () => void;
  readonly sendCommand: (command: ClientCommand) => boolean;
}

function websocketUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

export function useTournamentSocket(
  client: "dashboard" | "overlay",
): TournamentSocket {
  const [state, setState] = useState<ServerState | null>(null);
  const [socketStatus, setSocketStatus] =
    useState<SocketStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [upgradeRequired, setUpgradeRequired] = useState(false);
  const [animationEvents, setAnimationEvents] = useState<
    readonly OverlayAnimationEvent[]
  >([]);
  const socketRef = useRef<WebSocket | null>(null);
  const stateRef = useRef<ServerState | null>(null);
  const nextAnimationSequenceRef = useRef(1);
  const commandsRef = useRef(new CommandTracker());
  const [pendingCommands, setPendingCommands] = useState<readonly PendingCommand[]>([]);
  const [commandError, setCommandError] = useState<string | null>(null);

  const updateCommands = useCallback((): void => {
    setPendingCommands(commandsRef.current.pending);
    setCommandError(commandsRef.current.error);
  }, []);

  useEffect(() => {
    let active = true;
    let attempts = 0;
    let reconnectTimer: number | null = null;
    let reloadRequired = false;

    const connect = (): void => {
      if (!active || reloadRequired) {
        return;
      }
      setSocketStatus(attempts === 0 ? "connecting" : "reconnecting");
      const socket = new WebSocket(websocketUrl());
      socketRef.current = socket;
      let synchronized = false;
      const requireReload = (): void => {
        reloadRequired = true;
        setUpgradeRequired(true);
        setSocketStatus("disconnected");
        commandsRef.current.disconnect();
        updateCommands();
        setError(reloadMessage(client));
        socket.close(4006, "Browser and server versions differ.");
      };

      socket.addEventListener("open", () => {
        if (!active || reloadRequired || socketRef.current !== socket) {
          return;
        }
        setError(null);
        const hello: ClientMessage = {
          type: "client.hello",
          appVersion: APP_VERSION,
          protocolVersion: PROTOCOL_VERSION,
          client,
        };
        socket.send(JSON.stringify(hello));
      });

      socket.addEventListener("message", (event) => {
        if (!active || reloadRequired || socketRef.current !== socket) {
          return;
        }
        let input: unknown;
        try {
          input = JSON.parse(String(event.data));
        } catch (parseError) {
          setError(
            parseError instanceof Error
              ? `Server sent invalid JSON: ${parseError.message}`
              : "Server sent invalid JSON.",
          );
          return;
        }

        if (snapshotNeedsReload(input)) {
          requireReload();
          return;
        }
        const message = serverMessageSchema.safeParse(input);
        if (!message.success) {
          setError("Server sent a message that does not match the protocol.");
          return;
        }
        if (message.data.type === "state.snapshot") {
          synchronized = true;
          attempts = 0;
          setSocketStatus("connected");
          setError(null);
          commandsRef.current.reconcileBracket(message.data.state.connection.status);
          updateCommands();
          const events = deriveOverlayAnimationEvents(
            stateRef.current?.overlay ?? null,
            message.data.state.overlay,
            nextAnimationSequenceRef.current,
          );
          nextAnimationSequenceRef.current += events.length;
          stateRef.current = message.data.state;
          setAnimationEvents(events);
          setState(message.data.state);
          return;
        }
        if (message.data.type === "command.error") {
          if (message.data.code === "client_version_mismatch" ||
              (!synchronized && message.data.commandId === null && message.data.code === "invalid_message")) {
            requireReload();
            return;
          }
          if (message.data.code === "command_superseded" && message.data.commandId !== null) {
            commandsRef.current.acknowledge(message.data.commandId);
          } else {
            commandsRef.current.fail(message.data.commandId, message.data.message);
          }
          updateCommands();
        }
        if (message.data.type === "command.ack") {
          commandsRef.current.acknowledge(message.data.commandId);
          updateCommands();
        }
      });

      socket.addEventListener("error", () => {
        if (active && !reloadRequired && socketRef.current === socket) {
          setError("The live connection encountered an error.");
        }
      });

      socket.addEventListener("close", (event) => {
        if (!active || socketRef.current !== socket) {
          return;
        }
        if (event.code === 4006 && !reloadRequired) {
          requireReload();
        }
        if (reloadRequired) {
          return;
        }
        attempts += 1;
        commandsRef.current.disconnect();
        updateCommands();
        setSocketStatus("reconnecting");
        reconnectTimer = window.setTimeout(
          connect,
          Math.min(500 * 2 ** attempts, 5_000),
        );
      });
    };

    connect();
    return () => {
      active = false;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [client, updateCommands]);

  const sendCommand = useCallback((command: ClientCommand): boolean => {
    const socket = socketRef.current;
    if (socketStatus !== "connected" || socket === null || socket.readyState !== WebSocket.OPEN) {
      setError("The command was not sent because the server is disconnected.");
      return false;
    }
    const message: ClientMessage = {
      type: "command",
      commandId: crypto.randomUUID(),
      command,
    };
    if (!commandsRef.current.begin(message.commandId, command)) {
      return false;
    }
    try {
      socket.send(JSON.stringify(message));
    } catch (sendError) {
      commandsRef.current.fail(
        message.commandId,
        sendError instanceof Error ? sendError.message : "The command could not be sent.",
      );
      updateCommands();
      return false;
    }
    updateCommands();
    return true;
  }, [socketStatus, updateCommands]);

  const dismissError = useCallback(() => {
    commandsRef.current.dismissError();
    setError(null);
    updateCommands();
  }, [updateCommands]);

  return {
    state,
    socketStatus,
    error: upgradeRequired ? reloadMessage(client) : commandError ?? error,
    animationEvents,
    sendCommand,
    pendingCommands,
    upgradeRequired,
    dismissError,
  };
}
