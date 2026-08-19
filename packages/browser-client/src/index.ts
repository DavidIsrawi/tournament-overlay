import {
  PROTOCOL_VERSION,
  serverMessageSchema,
  type ClientCommand,
  type ClientMessage,
  type ServerState,
} from "@tournament-overlay/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

export type SocketStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

interface TournamentSocket {
  readonly state: ServerState | null;
  readonly socketStatus: SocketStatus;
  readonly error: string | null;
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
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let active = true;
    let attempts = 0;
    let reconnectTimer: number | null = null;

    const connect = (): void => {
      if (!active) {
        return;
      }
      setSocketStatus(attempts === 0 ? "connecting" : "reconnecting");
      const socket = new WebSocket(websocketUrl());
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        attempts = 0;
        setSocketStatus("connected");
        setError(null);
        const hello: ClientMessage = {
          type: "client.hello",
          protocolVersion: PROTOCOL_VERSION,
          client,
        };
        socket.send(JSON.stringify(hello));
      });

      socket.addEventListener("message", (event) => {
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

        const message = serverMessageSchema.safeParse(input);
        if (!message.success) {
          setError("Server sent a message that does not match the protocol.");
          return;
        }
        if (message.data.type === "state.snapshot") {
          setState(message.data.state);
          return;
        }
        if (message.data.type === "command.error") {
          setError(message.data.message);
        }
      });

      socket.addEventListener("error", () => {
        setError("The live connection encountered an error.");
      });

      socket.addEventListener("close", () => {
        if (!active) {
          return;
        }
        attempts += 1;
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
  }, [client]);

  const sendCommand = useCallback((command: ClientCommand): boolean => {
    const socket = socketRef.current;
    if (socket === null || socket.readyState !== WebSocket.OPEN) {
      setError("The command was not sent because the server is disconnected.");
      return false;
    }
    const message: ClientMessage = {
      type: "command",
      commandId: crypto.randomUUID(),
      command,
    };
    socket.send(JSON.stringify(message));
    return true;
  }, []);

  return { state, socketStatus, error, sendCommand };
}
