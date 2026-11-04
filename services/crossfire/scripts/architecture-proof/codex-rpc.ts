import { createConnection } from "node:net";
import { once } from "node:events";
import WebSocket from "ws";
import { object } from "./native-http.js";

export async function connectRpc(socket: string) {
  const connection = new WebSocket("ws://localhost/", {
    createConnection: () => createConnection(socket), perMessageDeflate: false,
    handshakeTimeout: 10_000, maxPayload: 1024 * 1024,
  });
  let sequence = 0;
  let failure: Error | undefined;
  const notifications: { method: string; params: Record<string, unknown> }[] = [];
  const pending = new Map<number, {
    resolve: (value: Record<string, unknown>) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }>();
  function stop(error: Error): void {
    if (failure) return;
    failure = error;
    connection.terminate();
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  }
  connection.on("error", stop);
  connection.on("close", () => stop(new Error("Native connection closed")));
  connection.on("message", (raw, binary) => {
    try {
      if (binary) throw new Error("Expected a native text response");
      const buffer = Array.isArray(raw) ? Buffer.concat(raw) : raw instanceof ArrayBuffer ? Buffer.from(raw) : raw;
      const value = object(JSON.parse(buffer.toString()));
      if (typeof value.method === "string") {
        if (value.id !== undefined) throw new Error("Unexpected native server request");
        if (notifications.length >= 256) throw new Error("Native notification bound exceeded");
        notifications.push({ method: value.method, params: object(value.params ?? {}) });
        return;
      }
      if (typeof value.id !== "number") throw new Error("Invalid native response ID");
      const entry = pending.get(value.id);
      if (!entry) throw new Error("Unexpected native response ID");
      const result = value.error === undefined ? object(value.result) : undefined;
      pending.delete(value.id);
      clearTimeout(entry.timer);
      if (result) entry.resolve(result);
      else entry.reject(new Error(JSON.stringify(value.error)));
    } catch (error) {
      stop(error instanceof Error ? error : new Error("Invalid native response"));
    }
  });
  function call(method: string, params: unknown): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      if (failure) { reject(failure); return; }
      const id = ++sequence;
      const timer = setTimeout(() => {
        stop(new Error("Native RPC deadline exceeded: " + method));
      }, 10_000);
      pending.set(id, { resolve, reject, timer });
      connection.send(JSON.stringify({ id, method, params }), error => { if (error) stop(error); });
    });
  }
  try {
    await once(connection, "open");
    await call("initialize", {
      clientInfo: { name: "crossfire-architecture-observer", version: "0.1.0" },
      capabilities: { experimentalApi: true },
    });
    connection.send(JSON.stringify({ method: "initialized" }), error => { if (error) stop(error); });
    return { call, close: () => stop(new Error("Native observer closed")), notifications };
  } catch (error) {
    stop(error instanceof Error ? error : new Error("Native initialization failed"));
    throw error;
  }
}
