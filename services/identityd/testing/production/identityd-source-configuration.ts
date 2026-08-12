import type {
  InvocationVerificationKeyResponse
} from "./invocation-verification-key.js";
import type {
  PrincipalAuthorizationFacts
} from "./principal-authorization-facts.js";
import type {
  ExternalIdentityLink
} from "./external-identity-link.js";
import type {
  LoginProvider
} from "./login-provider.js";
import type {
  WorkspaceLoginProviderAdmission
} from "./workspace-login-provider-admission.js";

export interface IdentitydSourceConfiguration {
  readonly callerSubject: string;
  readonly verificationKeys: InvocationVerificationKeyResponse;
  readonly principalFacts?: readonly PrincipalAuthorizationFacts[];
  readonly loginProviders?: readonly LoginProvider[];
  readonly workspaceLoginProviderAdmissions?:
    readonly WorkspaceLoginProviderAdmission[];
  readonly externalIdentityLinks?: readonly ExternalIdentityLink[];
}
