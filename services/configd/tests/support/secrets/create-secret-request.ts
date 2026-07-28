import type {
  PublishSecretRequest
} from "../../generated/v1/configd.js";
import {
  createConsumerBinding,
  type CreateConsumerBindingOptions
} from "../bindings/create-consumer-binding.js";

export interface CreateSecretRequestOptions
extends CreateConsumerBindingOptions {
  readonly secretId: string;
  readonly secretVersionId?: string;
  readonly expectedRevision?: bigint;
  readonly material?: Buffer;
  readonly dependencyClaimId?: string;
  readonly dependencyClaimRevision?: bigint;
}

export function createSecretRequest(
  options: CreateSecretRequestOptions
): PublishSecretRequest {
  return {
    secretId: options.secretId,
    secretVersionId:
      options.secretVersionId ?? `${options.secretId}_v1`,
    binding: createConsumerBinding(options),
    expectedRevision: options.expectedRevision,
    material: options.material
      ?? Buffer.from("test-secret-material", "utf8"),
    dependencyClaimId: options.dependencyClaimId,
    dependencyClaimRevision:
      options.dependencyClaimRevision
  };
}
