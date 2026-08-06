export interface InvocationTokenOptions {
  readonly tenantId?: string;
  readonly workspaceId?: string;
  readonly subject?: string;
  readonly actorSubject?: string;
  readonly sessionId?: string | null;
  readonly runId?: string;
  readonly tokenId?: string;
  readonly issuer?: string;
  readonly audience?: string;
  readonly issuedAt?: number;
  readonly notBefore?: number;
  readonly expiresAt?: number;
  readonly authorityClaim?: ForbiddenAuthorityClaim;
}

export type ForbiddenAuthorityClaim =
  | "roles"
  | "capabilities"
  | "grants"
  | "kubernetes"
  | "kubernetes.io"
  | "kubernetes.io/serviceaccount/namespace";

export interface InvocationAuthority {
  readonly issuer: string;
  readonly audience: string;
  readonly verificationKey: InvocationVerificationKey;
  readonly sign: (options?: InvocationTokenOptions) => string;
  readonly signPayload: (payloadJson: string) => string;
  readonly signToken: (
    headerJson: string,
    payloadJson: string
  ) => string;
  readonly writePrivateKey: (path: string) => Promise<void>;
}
import type {
  InvocationVerificationKey
} from "@ctlflow/identityd/testing/production";
