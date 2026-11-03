import type { Parsed } from '@ctlflow/crossfire-contracts/schema/validation';
import type { attachment } from '@ctlflow/fleetd-contracts/attachment';
import type { Result } from '@ctlflow/crossfire-kernel/result';

export type Attachment = Parsed<typeof attachment>;
export type NativeInfo = { sessionId: string; status: string; authenticated: boolean; configuredModel: string | null;
  configuredReasoning: string | null; projectSkills: { name: string; path: string }[]; turns: number | null };
export type NativePreserver = (workspace: string) => Result<{ path: string; bytes: number; sha256: string }[]>;
export type NativeInspector = (input: { attachment: Attachment; options: Record<string, unknown>; fresh: boolean; requiredSkills: string[] }, signal: AbortSignal) => Promise<Result<NativeInfo>>;
