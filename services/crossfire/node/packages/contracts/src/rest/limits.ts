export const HTTP_LIMITS = { requestBytes: 2 * 1024 * 1024, responseBytes: 32 * 1024 * 1024, requestMilliseconds: 30_000,
  publicMutationsPerMinute: 120, publicMutationsGlobalPerMinute: 4096, publicMutationClients: 4096 } as const;
