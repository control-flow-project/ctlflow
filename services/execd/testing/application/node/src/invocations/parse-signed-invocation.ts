import {
  TextDecoder
} from "node:util";
import {
  decodeBase64Url
} from "../tokens/decode-base64-url.js";
import type {
  SignedInvocation
} from "./signed-invocation.js";

const maximumTokenLength = 16 * 1_024;
const maximumJsonDepth = 16;
const utf8 = new TextDecoder("utf-8", { fatal: true });

export function parseSignedInvocation(token: string): SignedInvocation {
  if (token.length === 0 || token.length > maximumTokenLength) {
    throw new TypeError("invocation token length is invalid");
  }

  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    throw new TypeError("invocation token shape is invalid");
  }
  const [headerPart, payloadPart, signaturePart] = parts as [
    string,
    string,
    string
  ];
  const header = parseJsonObject(headerPart);
  const payload = parseJsonObject(payloadPart);
  const keyId = header.kid;
  if (header.alg !== "RS256"
      || "crit" in header
      || typeof keyId !== "string"
      || !isVisibleAscii(keyId, 128)) {
    throw new TypeError("invocation header is invalid");
  }

  return {
    keyId,
    signingInput: `${headerPart}.${payloadPart}`,
    signature: decodeBase64Url(signaturePart),
    payload
  };
}

function parseJsonObject(part: string): Readonly<Record<string, unknown>> {
  const text = utf8.decode(decodeBase64Url(part));
  requireBoundedUniqueJson(text);
  const value = JSON.parse(text) as unknown;
  if (value === null
      || typeof value !== "object"
      || Array.isArray(value)) {
    throw new TypeError("invocation token part is not an object");
  }
  return value as Readonly<Record<string, unknown>>;
}

function requireBoundedUniqueJson(text: string): void {
  const objectMembers: (Set<string> | undefined)[] = [];
  let depth = 0;
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    if (character === "{") {
      depth++;
      requireDepth(depth);
      objectMembers.push(new Set<string>());
      index++;
      continue;
    }
    if (character === "[") {
      depth++;
      requireDepth(depth);
      objectMembers.push(undefined);
      index++;
      continue;
    }
    if (character === "}" || character === "]") {
      depth--;
      objectMembers.pop();
      index++;
      continue;
    }
    if (character !== "\"") {
      index++;
      continue;
    }

    const end = findStringEnd(text, index);
    const name = JSON.parse(text.slice(index, end)) as string;
    let probe = end;
    while (probe < text.length && /[\t\n\r ]/u.test(text[probe]!)) {
      probe++;
    }
    const members = objectMembers.at(-1);
    if (text[probe] === ":" && members !== undefined) {
      if (members.has(name)) {
        throw new SyntaxError("duplicate JSON member");
      }
      members.add(name);
    }
    index = end;
  }
}

function requireDepth(depth: number): void {
  if (depth > maximumJsonDepth) {
    throw new SyntaxError("JSON depth exceeds the invocation bound");
  }
}

function findStringEnd(text: string, start: number): number {
  let index = start + 1;
  while (index < text.length) {
    const character = text[index];
    if (character === "\\") {
      index += 2;
      continue;
    }
    if (character === "\"") {
      return index + 1;
    }
    index++;
  }
  throw new SyntaxError("unterminated JSON string");
}

function isVisibleAscii(value: string, maximumLength: number): boolean {
  return value.length >= 1
    && value.length <= maximumLength
    && [...value].every(
      (character) => character >= "!" && character <= "~");
}
