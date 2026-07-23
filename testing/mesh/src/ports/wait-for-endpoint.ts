import { connect } from "node:net";

const retryMilliseconds = 50;

export async function waitForEndpoint(
  host: string,
  port: number,
  timeoutMilliseconds: number
): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;

  while (Date.now() < deadline) {
    if (await canConnect(host, port)) {
      return;
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, retryMilliseconds);
    });
  }

  throw new Error(
    `Endpoint did not listen on ${host}:${String(port)}`);
}

async function canConnect(host: string, port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = connect({ host, port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}
