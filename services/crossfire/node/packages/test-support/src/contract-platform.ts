import type { ContractTarget } from './contract-process.js';

export type ContractHuman = { nativeToken: string; cookie: string; csrf: string; matrixUserId: string; memberId: string };
export type ContractPlatform = { directory: string; origin: string; releaseDirectory: string; targets: readonly ContractTarget[]; owner: ContractHuman;
  approve(enrollmentId: string, code: string): Promise<void>; close(): Promise<void>; restart(target?: ContractTarget): Promise<void> };
