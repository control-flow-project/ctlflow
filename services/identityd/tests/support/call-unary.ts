import type {
  ClientUnaryCall,
  ServiceError
} from "@grpc/grpc-js";

export async function callUnary<T>(
  start: (
    callback: (error: ServiceError | null, response: T) => void
  ) => ClientUnaryCall
): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const call = start((error, response) => {
      if (error === null) {
        resolve(response);
      } else {
        reject(error);
      }
    });
    call.on("error", () => undefined);
  });
}
