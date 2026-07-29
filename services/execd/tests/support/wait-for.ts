import { inspect } from "node:util";

export async function waitFor<T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  timeoutMilliseconds = 15_000
): Promise<T> {
  const deadline = Date.now() + timeoutMilliseconds;
  let current = await read();
  while (!accept(current)) {
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out waiting for expected state: ${inspect(current)}`);
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100);
    });
    current = await read();
  }
  return current;
}
