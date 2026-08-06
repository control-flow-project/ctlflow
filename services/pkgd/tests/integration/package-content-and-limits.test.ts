import assert from "node:assert/strict";
import { test } from "node:test";
import { status } from "@grpc/grpc-js";
import {
  InterfaceProtocol,
  type DeclarePackageRequest,
  type PackageDependency
} from "../generated/v1/pkgd.js";
import {
  getPkgdTestContext
} from "../suite/get-pkgd-test-context.js";
import {
  createPackageRequest
} from "../support/packages/create-package-request.js";
import {
  declarePackage
} from "../support/packages/declare-package.js";
import {
  matchGrpcStatus
} from "../support/match-grpc-status.js";

test("accepts and returns RFC 8785 canonical dependency options", async () => {
  const context = getPkgdTestContext();
  const request = createPackageRequest({
    packageId: "package_canonical_json"
  });
  const canonical = Buffer.from(
    "{\"a\":1e+30,\"b\":0.000001,\"c\":1e-7,"
    + "\"emoji\":\"😀\",\"rounded\":333333333.3333333}",
    "utf8");
  request.dependencies[0]!.options!.canonicalJson = canonical;

  const declared = await declarePackage(context, request);
  assert.deepEqual(
    declared.dependencies.find(
      (value) => value.name === "Task queue")!
      .options!.canonicalJson,
    canonical);
});

test("rejects invalid and non-canonical dependency options", async () => {
  const context = getPkgdTestContext();
  const invalid = [
    Buffer.from("", "utf8"),
    Buffer.from("{", "utf8"),
    Buffer.from("[]", "utf8"),
    Buffer.from("{\"b\":1,\"a\":2}", "utf8"),
    Buffer.from("{ \"a\":1}", "utf8"),
    Buffer.from("{\"a\":1.0}", "utf8"),
    Buffer.from("{\"a\":-0}", "utf8"),
    Buffer.from("{\"a\":1,\"a\":2}", "utf8"),
    Buffer.from("{\"a\":\"\\u0061\"}", "utf8"),
    Buffer.from("{\"a\":NaN}", "utf8")
  ];

  for (let index = 0; index < invalid.length; index++) {
    const request = createPackageRequest({
      packageId: `invalid_options_${String(index)}`
    });
    request.dependencies[0]!.options!.canonicalJson = invalid[index]!;
    await assert.rejects(
      declarePackage(context, request),
      matchGrpcStatus(status.INVALID_ARGUMENT));
  }
});

test("enforces Package collection bounds", async () => {
  const context = getPkgdTestContext();
  const cases = [
    excessiveComponents(),
    excessiveInterfaces(),
    excessiveDependencies(),
    excessiveExposures(),
    excessiveComponentOperations(),
    excessiveGenerationOperations()
  ];

  for (const request of cases) {
    await assert.rejects(
      declarePackage(context, request),
      matchGrpcStatus(status.RESOURCE_EXHAUSTED));
  }
});

test("enforces dependency option byte and nesting bounds", async () => {
  const context = getPkgdTestContext();
  const oversized = createPackageRequest({
    packageId: "options_oversized"
  });
  oversized.dependencies[0]!.options!.canonicalJson = Buffer.from(
    `{"value":"${"a".repeat(65_525)}"}`,
    "utf8");
  assert.ok(
    oversized.dependencies[0]!.options!.canonicalJson.length > 65_536);
  await assert.rejects(
    declarePackage(context, oversized),
    matchGrpcStatus(status.RESOURCE_EXHAUSTED));

  const tooDeep = createPackageRequest({
    packageId: "options_too_deep"
  });
  tooDeep.dependencies[0]!.options!.canonicalJson = Buffer.from(
    `{"value":${"[".repeat(16)}0${"]".repeat(16)}}`,
    "utf8");
  await assert.rejects(
    declarePackage(context, tooDeep),
    matchGrpcStatus(status.RESOURCE_EXHAUSTED));
});

test("enforces the encoded Package declaration bound", async () => {
  const context = getPkgdTestContext();
  const request = createPackageRequest({
    packageId: "declaration_oversized"
  });
  request.dependencies = Array.from(
    { length: 18 },
    (_, index) => largeDependency(index));

  await assert.rejects(
    declarePackage(context, request),
    matchGrpcStatus(status.RESOURCE_EXHAUSTED));
});

function excessiveComponents(): DeclarePackageRequest {
  const request = createPackageRequest({
    packageId: "too_many_components"
  });
  request.components = Array.from(
    { length: 65 },
    (_, index) => ({
      componentId: `component_${String(index).padStart(2, "0")}`,
      artifact: {
        repository: "registry.example.com/apps/component",
        manifestDigest: `sha256:${"a".repeat(64)}`
      },
      declaredOperations: []
    }));
  request.interfaces = [];
  request.dependencies = [];
  request.exposures = [];
  return request;
}

function excessiveComponentOperations(): DeclarePackageRequest {
  const request = createPackageRequest({
    packageId: "too_many_component_operations"
  });
  request.components[0]!.declaredOperations = Array.from(
    { length: 65 },
    (_, index) =>
      `resources_${String(index).padStart(2, "0")}.read`);
  return request;
}

function excessiveGenerationOperations(): DeclarePackageRequest {
  const request = createPackageRequest({
    packageId: "too_many_generation_operations"
  });
  // Nine components, each within its own bound, exceed the generation bound.
  request.components = Array.from(
    { length: 9 },
    (_, componentIndex) => ({
      componentId:
        `component_${String(componentIndex).padStart(2, "0")}`,
      artifact: {
        repository: "registry.example.com/apps/component",
        manifestDigest: `sha256:${"a".repeat(64)}`
      },
      declaredOperations: Array.from(
        { length: 57 },
        (_, index) =>
          `resources_${String(componentIndex).padStart(2, "0")}`
          + `_${String(index).padStart(2, "0")}.read`)
    }));
  request.interfaces = [];
  request.dependencies = [];
  request.exposures = [];
  return request;
}

function excessiveInterfaces(): DeclarePackageRequest {
  const request = createPackageRequest({
    packageId: "too_many_interfaces"
  });
  request.interfaces = Array.from(
    { length: 257 },
    (_, index) => ({
      interfaceId: `interface_${String(index).padStart(3, "0")}`,
      componentId: "api",
      protocol: InterfaceProtocol.INTERFACE_PROTOCOL_HTTP,
      contractId: "apps.v1.http",
      port: 8_080
    }));
  request.dependencies = [];
  request.exposures = [];
  return request;
}

function excessiveDependencies(): DeclarePackageRequest {
  const request = createPackageRequest({
    packageId: "too_many_dependencies"
  });
  request.dependencies = Array.from(
    { length: 257 },
    (_, index) => ({
      name: `Dependency ${String(index).padStart(3, "0")}`,
      componentId: "api",
      dependencyType: "service:example",
      options: {
        canonicalJson: Buffer.from("{}", "utf8")
      }
    }));
  request.exposures = [];
  return request;
}

function excessiveExposures(): DeclarePackageRequest {
  const request = createPackageRequest({
    packageId: "too_many_exposures"
  });
  request.interfaces = Array.from(
    { length: 256 },
    (_, index) => ({
      interfaceId: `interface_${String(index).padStart(3, "0")}`,
      componentId: "api",
      protocol: InterfaceProtocol.INTERFACE_PROTOCOL_HTTP,
      contractId: "apps.v1.http",
      port: 8_080
    }));
  request.dependencies = [];
  request.exposures = Array.from(
    { length: 257 },
    (_, index) => ({
      exposureId: `exposure_${String(index).padStart(3, "0")}`,
      interfaceId: `interface_${String(index % 256).padStart(3, "0")}`
    }));
  return request;
}

function largeDependency(index: number): PackageDependency {
  return {
    name: `Large dependency ${String(index).padStart(2, "0")}`,
    componentId: "api",
    dependencyType: "service:large",
    options: {
      canonicalJson: Buffer.from(
        `{"value":"${"a".repeat(61_000)}"}`,
        "utf8")
    }
  };
}
