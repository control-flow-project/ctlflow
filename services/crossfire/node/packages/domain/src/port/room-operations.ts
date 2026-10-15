import type { Result } from '@ctlflow/crossfire-kernel/result';

export type RoomOperations = {
  run<Value>(roomId: string, operation: () => Promise<Result<Value>>): Promise<Result<Value>>;
};
