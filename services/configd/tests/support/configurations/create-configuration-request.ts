import type {
  PublishConfigurationRequest
} from "../../generated/v1/configd.js";
import {
  createConsumerBinding,
  type CreateConsumerBindingOptions
} from "../bindings/create-consumer-binding.js";

export interface CreateConfigurationRequestOptions
extends CreateConsumerBindingOptions {
  readonly configurationId: string;
  readonly configurationVersionId?: string;
  readonly expectedRevision?: bigint;
  readonly content?: Buffer;
  readonly dependencyClaimId?: string;
  readonly dependencyClaimRevision?: bigint;
}

export function createConfigurationRequest(
  options: CreateConfigurationRequestOptions
): PublishConfigurationRequest {
  return {
    configurationId: options.configurationId,
    configurationVersionId:
      options.configurationVersionId
      ?? `${options.configurationId}_v1`,
    binding: createConsumerBinding(options),
    expectedRevision: options.expectedRevision,
    contentJson: options.content
      ?? Buffer.from('{"enabled":true}', "utf8"),
    dependencyClaimId: options.dependencyClaimId,
    dependencyClaimRevision:
      options.dependencyClaimRevision
  };
}
