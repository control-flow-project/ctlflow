export type { MessagingClient, MessagingTransport } from '@ctlflow/crossfire-domain/port/messaging-client';
export type Clock = {
  now(): number;
  delay(milliseconds: number, signal: AbortSignal): Promise<void>;
  deadline(milliseconds: number): AbortSignal;
  schedule(callback: () => void, milliseconds: number, recurring?: boolean): () => void;
};
export type LocalState = {
  exists(path: string): boolean;
  read<Value>(path: string, maximumBytes?: number): Value;
  write(path: string, value: unknown, maximumBytes?: number): void;
  remove(path: string): void;
};
