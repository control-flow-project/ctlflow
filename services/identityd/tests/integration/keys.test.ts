import assert from "node:assert/strict";
import { test } from "node:test";
import { status } from "@grpc/grpc-js";
import type {
  GetInvocationVerificationKeysResponse
} from "../generated/v1/identityd.js";
import {
  VerificationKeyAlgorithm
} from "../generated/v1/identityd.js";
import {
  getIdentitydTestContext
} from "../suite/get-identityd-test-context.js";
import {
  callUnary
} from "../support/call-unary.js";
import {
  createInvocationAuthority
} from "../support/create-invocation-authority.js";
import {
  matchGrpcStatus
} from "../support/match-grpc-status.js";
import {
  workloadMetadata
} from "../support/workload-metadata.js";

interface StoredKey {
  readonly key_id: string;
  readonly algorithm: string;
  readonly modulus_base64url: string;
  readonly exponent_base64url: string;
  readonly state: number;
  readonly revision: number;
}

test("returns the bounded current public key set and expiry", async () => {
  const before = Date.now();
  const response = await getKeys();
  const after = Date.now();
  assert.deepEqual(
    response.keys.map((key) => ({
      keyId: key.keyId,
      algorithm: key.algorithm
    })),
    [{
      keyId: "identity-primary-key",
      algorithm:
        VerificationKeyAlgorithm.VERIFICATION_KEY_ALGORITHM_RS256
    }]);
  assert.ok(response.keys[0]?.modulusBase64url.length !== 0);
  assert.ok(response.keys[0]?.exponentBase64url.length !== 0);
  assert.ok(response.expiresAt !== undefined);
  assert.ok(response.expiresAt.getTime() > after);
  assert.ok(response.expiresAt.getTime() <= before + 5 * 60_000);
});

test("returns active and retiring keys in ordinal key-ID order", async () => {
  const context = getIdentitydTestContext();
  const extra = await createInvocationAuthority("aaa-retiring-key");
  await context.database.connection(
    "invocation_verification_keys"
  ).insert({
    key_id: extra.verificationKey.keyId,
    algorithm: "RS256",
    modulus_base64url:
      extra.verificationKey.modulusBase64url,
    exponent_base64url:
      extra.verificationKey.exponentBase64url,
    state: 2,
    revision: 2
  });
  try {
    const response = await getKeys();
    assert.deepEqual(
      response.keys.map((key) => key.keyId),
      ["aaa-retiring-key", "identity-primary-key"]);
  } finally {
    await context.database.connection(
      "invocation_verification_keys"
    ).where({ key_id: "aaa-retiring-key" }).delete();
  }
});

test("empty and oversized key state fails unavailable", async () => {
  const context = getIdentitydTestContext();
  const primary = await readPrimaryKey();
  await context.database.connection(
    "invocation_verification_keys"
  ).delete();
  try {
    await assert.rejects(
      getKeys(),
      matchGrpcStatus(status.UNAVAILABLE));
  } finally {
    await context.database.connection(
      "invocation_verification_keys"
    ).insert(primary);
  }

  const extras = Array.from({ length: 8 }, (_value, index) => ({
    ...primary,
    key_id: `overflow-key-${String(index)}`,
    revision: index + 10
  }));
  await context.database.connection(
    "invocation_verification_keys"
  ).insert(extras);
  try {
    await assert.rejects(
      getKeys(),
      matchGrpcStatus(status.UNAVAILABLE));
  } finally {
    await context.database.connection(
      "invocation_verification_keys"
    ).whereLike("key_id", "overflow-key-%").delete();
  }
});

test("malformed stored public key state fails unavailable", async () => {
  const context = getIdentitydTestContext();
  await context.database.connection.raw(
    "PRAGMA ignore_check_constraints = ON");
  await context.database.connection(
    "invocation_verification_keys"
  ).where({ key_id: "identity-primary-key" }).update({
    algorithm: "none"
  });
  try {
    await assert.rejects(
      getKeys(),
      matchGrpcStatus(status.UNAVAILABLE));
  } finally {
    await context.database.connection(
      "invocation_verification_keys"
    ).where({ key_id: "identity-primary-key" }).update({
      algorithm: "RS256"
    });
    await context.database.connection.raw(
      "PRAGMA ignore_check_constraints = OFF");
  }
});

test("verification-key persistence outage fails unavailable", async () => {
  const context = getIdentitydTestContext();
  await context.database.connection.schema.renameTable(
    "invocation_verification_keys",
    "invocation_verification_keys_unavailable");
  try {
    await assert.rejects(
      getKeys(),
      matchGrpcStatus(status.UNAVAILABLE));
  } finally {
    await context.database.connection.schema.renameTable(
      "invocation_verification_keys_unavailable",
      "invocation_verification_keys");
  }
});

async function getKeys():
Promise<GetInvocationVerificationKeysResponse> {
  const context = getIdentitydTestContext();
  return await callUnary<GetInvocationVerificationKeysResponse>((done) =>
    context.client.getInvocationVerificationKeys(
      {},
      workloadMetadata(
        context.policydWorkload.callerToken),
      done));
}

async function readPrimaryKey(): Promise<StoredKey> {
  const context = getIdentitydTestContext();
  const value = await context.database.connection<StoredKey>(
    "invocation_verification_keys"
  ).where({ key_id: "identity-primary-key" }).first();
  assert.ok(value !== undefined);
  return value;
}
