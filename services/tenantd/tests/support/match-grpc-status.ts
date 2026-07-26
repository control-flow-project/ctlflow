import type {
  ServiceError
} from "@grpc/grpc-js";

export function matchGrpcStatus(expected: number): (error: unknown) => boolean {
  return (error: unknown): boolean =>
    typeof error === "object"
    && error !== null
    && "code" in error
    && (error as ServiceError).code === expected;
}
