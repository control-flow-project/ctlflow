import type {
  ApplyProjectionRequest,
  ProjectionTarget
} from "../../generated/v1/configd.js";
import {
  createConsumerBinding,
  type CreateConsumerBindingOptions
} from "../bindings/create-consumer-binding.js";

export function createProjectionRequest(
  target: ProjectionTarget,
  binding: CreateConsumerBindingOptions = {}
): ApplyProjectionRequest {
  return {
    target,
    binding: createConsumerBinding(binding)
  };
}
