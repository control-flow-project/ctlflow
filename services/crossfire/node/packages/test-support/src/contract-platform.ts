export type ContractHuman = { nativeToken: string; cookie: string; csrf: string; matrixUserId: string; memberId: string };
export type ContractPlatform = { directory: string; origin: string; owner: ContractHuman; approve(enrollmentId: string, code: string): Promise<void> };
