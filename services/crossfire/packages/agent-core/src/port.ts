import type { JsonObject } from '@ctlflow/crossfire-contracts/json';
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
export type Matrix = {
  get<Value = JsonObject>(path: string, query?: Record<string, string | number>, maximumBytes?: number): Promise<Value>;
  post<Value = JsonObject>(path: string, body: unknown): Promise<Value>;
  put<Value = JsonObject>(path: string, body: unknown): Promise<Value>;
  message(text: string): JsonObject;
};
export type Transport = (signal: AbortSignal, timeoutMs: number) => Matrix;
