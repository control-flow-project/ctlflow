import type { JsonObject } from '@crossfire/contracts/json';
export type LocalState = {
  exists(path: string): boolean;
  read<Value>(path: string): Value;
  write(path: string, value: unknown): void;
  remove(path: string): void;
};
export type Matrix = {
  get<Value = JsonObject>(path: string, query?: Record<string, string | number>): Promise<Value>;
  post<Value = JsonObject>(path: string, body: unknown): Promise<Value>;
  put<Value = JsonObject>(path: string, body: unknown): Promise<Value>;
  message(text: string): JsonObject;
};
export type Transport = (signal: AbortSignal, timeoutMs: number) => Matrix;
