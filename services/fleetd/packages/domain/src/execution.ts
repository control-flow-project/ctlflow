export type ExecutionPlacement = { kind: 'host' } | { kind: 'vm'; image: string; profile: string };
export type VmImage = { path: string; sha256: string };
export type VmMount = { path: string; readOnly: boolean };
export type VmProfile = { cpus: number; memoryMiB: number; maximumMemoryMiB: number;
  network: 'disabled' | 'outbound'; mounts: VmMount[] };
export type ExecutionCatalog = { memoryBudgetMiB: number; hostReserveMiB: number;
  images: Record<string, VmImage>; profiles: Record<string, VmProfile> };
