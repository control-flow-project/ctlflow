import {
  randomBytes
} from "node:crypto";

const traceParentPattern =
  /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/u;

export function createTraceParent(candidate?: string): string {
  const match = candidate?.match(traceParentPattern);
  const traceId = match?.[1];
  const spanId = match?.[2];
  if (traceId !== undefined
      && spanId !== undefined
      && !isAllZero(traceId)
      && !isAllZero(spanId)) {
    return candidate as string;
  }

  return `00-${randomNonzeroHex(16)}-${randomNonzeroHex(8)}-01`;
}

function randomNonzeroHex(bytes: number): string {
  let value: string;
  do {
    value = randomBytes(bytes).toString("hex");
  } while (isAllZero(value));
  return value;
}

function isAllZero(value: string): boolean {
  return /^0+$/u.test(value);
}
