export type Failure = {
  code: "invalid" | "unauthorized" | "forbidden" | "missing" | "conflict" | "limit" | "native";
  message: string;
};

export type Result<T> = { ok: true; value: T } | { ok: false; error: Failure };

export function success<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function failure<T = never>(code: Failure["code"], message: string): Result<T> {
  return { ok: false, error: { code, message } };
}

export const failureStatus: Record<Failure["code"], number> = {
  invalid: 400, unauthorized: 401, forbidden: 403, missing: 404,
  conflict: 409, limit: 429, native: 502,
};
