import type {
  JsonWebKey
} from "node:crypto";
import type {
  OidcProviderEvidence
} from "./oidc-provider-evidence.js";
import type {
  OidcProviderMode
} from "./oidc-provider-mode.js";

export interface AuthorizationResult {
  readonly statusCode: number;
  readonly location: string;
}

export interface ControlledOidcProvider {
  readonly issuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly userInfoEndpoint: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly keyId: string;
  readonly publicKey: JsonWebKey;
  readonly certificateAuthorityPath: string;
  readonly serverName: string;
  readonly authorize: (location: string) =>
    Promise<AuthorizationResult>;
  readonly setMode: (mode: OidcProviderMode) => Promise<void>;
  readonly clearEvidence: () => Promise<void>;
  readonly readEvidence: () => Promise<OidcProviderEvidence>;
  readonly stop: () => Promise<void>;
}
