import {
  request as requestHttps
} from "node:https";
import type {
  TestKubernetesApiCredentials
} from "@ctlflow/test-mesh";
import {
  createTenancyApiRequestOptions
} from "./create-tenancy-api-request-options.js";

export interface TenancyWatchEvent {
  readonly type: "ADDED" | "MODIFIED";
  readonly object: unknown;
}

const maximumEventBytes = 256 * 1024;

export async function readFirstTenancyWatchEvent(
  credentials: TestKubernetesApiCredentials,
  path: string
): Promise<TenancyWatchEvent> {
  const options = await createTenancyApiRequestOptions(credentials, {
    method: "GET",
    path,
    headers: {
      accept: "application/json;stream=watch"
    }
  });

  return await new Promise<TenancyWatchEvent>((resolve, reject) => {
    let settled = false;
    const outbound = requestHttps(options, (response) => {
      if (response.statusCode !== 200) {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          settleFailure(new Error(
            `Watch returned HTTP ${String(response.statusCode ?? 0)}: ${
              Buffer.concat(chunks).toString("utf8")}`));
        });
        return;
      }

      let buffered = Buffer.alloc(0);
      response.on("data", (chunk: Buffer) => {
        buffered = Buffer.concat([buffered, chunk]);
        if (buffered.byteLength > maximumEventBytes) {
          settleFailure(new Error(
            "Tenancy watch event exceeds the test bound"));
          return;
        }

        const newline = buffered.indexOf(0x0a);
        if (newline < 0) {
          return;
        }

        try {
          const event = JSON.parse(
            buffered.subarray(0, newline).toString("utf8")
          ) as TenancyWatchEvent;
          settled = true;
          resolve(event);
          outbound.destroy();
        } catch (error) {
          settleFailure(error);
        }
      });
      response.on("end", () => {
        if (!settled) {
          settleFailure(new Error(
            "Tenancy watch ended before returning an event"));
        }
      });
    });
    const timeout = setTimeout(() => {
      settleFailure(new Error("Tenancy watch event timed out"));
    }, 5_000);
    timeout.unref();
    outbound.on("error", (error) => {
      if (!settled) {
        settleFailure(error);
      }
    });
    outbound.end();

    function settleFailure(error: unknown): void {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      outbound.destroy();
      reject(error);
    }
  });
}
