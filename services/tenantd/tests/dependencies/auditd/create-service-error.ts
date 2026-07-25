import {
  Metadata,
  type ServiceError,
  type status
} from "@grpc/grpc-js";

export function createServiceError(
  code: status,
  details: string
): ServiceError {
  return Object.assign(new Error(details), {
    code,
    details,
    metadata: new Metadata()
  });
}
