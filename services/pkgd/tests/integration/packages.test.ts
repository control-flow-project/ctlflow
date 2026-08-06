import assert from "node:assert/strict";
import { test } from "node:test";
import { status } from "@grpc/grpc-js";
import type {
  DeclarePackageRequest
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
  getPackage
} from "../support/packages/get-package.js";
import {
  matchGrpcStatus
} from "../support/match-grpc-status.js";

test("declares, retries, gets, and canonically orders a Package", async () => {
  const context = getPkgdTestContext();
  const request = createPackageRequest({
    packageId: "package_complete"
  });
  const declared = await declarePackage(context, request);

  assert.equal(declared.packageId, request.packageId);
  assert.equal(declared.generation, request.generation);
  assert.equal(declared.version, request.version);
  assert.deepEqual(declared.provenance, request.provenance);
  assert.deepEqual(
    declared.components.map((value) => value.componentId),
    ["api", "worker"]);
  assert.deepEqual(
    declared.interfaces.map((value) => value.interfaceId),
    ["api_http", "worker_grpc"]);
  assert.deepEqual(
    declared.dependencies.map((value) =>
      `${value.componentId}:${value.name}`),
    ["api:Primary database", "worker:Task queue"]);
  assert.deepEqual(
    declared.exposures.map((value) => value.exposureId),
    ["web", "worker"]);
  assert.ok(declared.declaredAt instanceof Date);

  const retried = await declarePackage(context, request);
  assert.deepEqual(retried, declared);
  assert.deepEqual(
    await getPackage(
      context.client,
      request.packageId,
      request.generation),
    declared);
});

test("enforces immutable keys, versions, and consecutive generations",
  async () => {
    const context = getPkgdTestContext();
    const first = createPackageRequest({
      packageId: "package_generations"
    });
    await declarePackage(context, first);

    const conflictingKey = createPackageRequest({
      packageId: first.packageId
    });
    conflictingKey.provenance!.sourceDigest =
      `sha256:${"d".repeat(64)}`;
    await assert.rejects(
      declarePackage(context, conflictingKey),
      matchGrpcStatus(status.ALREADY_EXISTS));

    await assert.rejects(
      declarePackage(context, createPackageRequest({
        packageId: first.packageId,
        generation: 3n,
        version: "3.0.0"
      })),
      matchGrpcStatus(status.FAILED_PRECONDITION));

    const second = await declarePackage(
      context,
      createPackageRequest({
        packageId: first.packageId,
        generation: 2n,
        version: "2.0.0"
      }));
    assert.equal(second.generation, 2n);

    await assert.rejects(
      declarePackage(context, createPackageRequest({
        packageId: first.packageId,
        generation: 3n,
        version: "2.0.0"
      })),
      matchGrpcStatus(status.ALREADY_EXISTS));
  });

test("returns not found for an absent Package generation", async () => {
  const context = getPkgdTestContext();
  await assert.rejects(
    getPackage(context.client, "package_absent", 1n),
    matchGrpcStatus(status.NOT_FOUND));
});

test("validates every Package scalar family", async () => {
  const context = getPkgdTestContext();
  const invalidRequests: DeclarePackageRequest[] = [];

  invalidRequests.push(withRequest("invalid_empty_id", (request) => {
    request.packageId = "";
  }));
  invalidRequests.push(withRequest("invalid_upper_id", (request) => {
    request.packageId = "Invalid";
  }));
  invalidRequests.push(withRequest("invalid_generation", (request) => {
    request.generation = 0n;
  }));
  invalidRequests.push(withRequest("invalid_version", (request) => {
    request.version = "v1.0.0";
  }));
  invalidRequests.push(withRequest("invalid_uri", (request) => {
    request.provenance!.sourceUri = "http://packages.example.com/app";
  }));
  invalidRequests.push(withRequest("invalid_source_digest", (request) => {
    request.provenance!.sourceDigest = `sha256:${"A".repeat(64)}`;
  }));
  invalidRequests.push(withRequest("invalid_component", (request) => {
    request.components[0]!.componentId = "Invalid";
  }));
  invalidRequests.push(withRequest("invalid_repository", (request) => {
    request.components[0]!.artifact!.repository =
      "https://registry.example.com/app";
  }));
  invalidRequests.push(withRequest("invalid_manifest", (request) => {
    request.components[0]!.artifact!.manifestDigest = "sha256:bad";
  }));
  invalidRequests.push(withRequest("invalid_interface", (request) => {
    request.interfaces[0]!.interfaceId = "_invalid";
  }));
  invalidRequests.push(withRequest("invalid_protocol", (request) => {
    request.interfaces[0]!.protocol = 0;
  }));
  invalidRequests.push(withRequest("invalid_contract", (request) => {
    request.interfaces[0]!.contractId = "invalid..contract";
  }));
  invalidRequests.push(withRequest("invalid_port", (request) => {
    request.interfaces[0]!.port = 0;
  }));
  invalidRequests.push(withRequest("invalid_dependency_name", (request) => {
    request.dependencies[0]!.name = " trailing ";
  }));
  invalidRequests.push(withRequest("invalid_dependency_id", (request) => {
    request.dependencies[0]!.dependencyId = "Invalid";
  }));
  invalidRequests.push(withRequest("invalid_dependency_type", (request) => {
    request.dependencies[0]!.dependencyType = "Service:Queue";
  }));
  invalidRequests.push(withRequest("invalid_exposure", (request) => {
    request.exposures[0]!.exposureId = "Invalid";
  }));

  for (const request of invalidRequests) {
    await assert.rejects(
      declarePackage(context, request),
      matchGrpcStatus(status.INVALID_ARGUMENT));
  }
});

test("validates Package messages, uniqueness, and local references",
  async () => {
    const context = getPkgdTestContext();
    const requests: DeclarePackageRequest[] = [];

    requests.push(withRequest("missing_provenance", (request) => {
      request.provenance = undefined;
    }));
    requests.push(withRequest("missing_artifact", (request) => {
      request.components[0]!.artifact = undefined;
    }));
    requests.push(withRequest("missing_options", (request) => {
      request.dependencies[0]!.options = undefined;
    }));
    requests.push(withRequest("no_components", (request) => {
      request.components = [];
    }));
    requests.push(withRequest("duplicate_component", (request) => {
      request.components[1]!.componentId =
        request.components[0]!.componentId;
    }));
    requests.push(withRequest("duplicate_interface", (request) => {
      request.interfaces[1]!.interfaceId =
        request.interfaces[0]!.interfaceId;
    }));
    requests.push(withRequest("duplicate_dependency_id", (request) => {
      request.dependencies[1]!.dependencyId =
        request.dependencies[0]!.dependencyId;
    }));
    requests.push(withRequest("duplicate_dependency_name", (request) => {
      request.dependencies[1]!.componentId =
        request.dependencies[0]!.componentId;
      request.dependencies[1]!.name =
        request.dependencies[0]!.name;
    }));
    requests.push(withRequest("duplicate_exposure", (request) => {
      request.exposures[1]!.exposureId =
        request.exposures[0]!.exposureId;
    }));
    requests.push(withRequest("unresolved_interface", (request) => {
      request.interfaces[0]!.componentId = "absent";
    }));
    requests.push(withRequest("unresolved_dependency", (request) => {
      request.dependencies[0]!.componentId = "absent";
    }));
    requests.push(withRequest("unresolved_exposure", (request) => {
      request.exposures[0]!.interfaceId = "absent";
    }));
    requests.push(withRequest("duplicate_exposed_interface", (request) => {
      request.exposures[1]!.interfaceId =
        request.exposures[0]!.interfaceId;
    }));

    for (const request of requests) {
      await assert.rejects(
        declarePackage(context, request),
        matchGrpcStatus(status.INVALID_ARGUMENT));
    }
  });

function withRequest(
  packageId: string,
  change: (request: DeclarePackageRequest) => void
): DeclarePackageRequest {
  const request = createPackageRequest({ packageId });
  change(request);
  return request;
}

test("declares, orders, retains, and freezes component operations",
  async () => {
    const context = getPkgdTestContext();
    const request = createPackageRequest({
      packageId: "package_operations"
    });
    // Request order is not canonical order; the retained declaration is.
    request.components[0]!.declaredOperations = [
      "chat_messages.post",
      "chat_attachments.upload"
    ];
    request.components[1]!.declaredOperations = ["chat_topics.create"];
    const declared = await declarePackage(context, request);
    assert.deepEqual(
      declared.components.map((value) => ({
        componentId: value.componentId,
        declaredOperations: value.declaredOperations
      })),
      [
        {
          componentId: "api",
          declaredOperations: ["chat_topics.create"]
        },
        {
          componentId: "worker",
          declaredOperations: [
            "chat_attachments.upload",
            "chat_messages.post"
          ]
        }
      ]);

    const retried = await declarePackage(context, request);
    assert.deepEqual(retried, declared);
    assert.deepEqual(
      await getPackage(
        context.client,
        request.packageId,
        request.generation),
      declared);

    // Declarations are immutable with their generation.
    request.components[1]!.declaredOperations = ["chat_topics.delete"];
    await assert.rejects(
      declarePackage(context, request),
      matchGrpcStatus(status.ALREADY_EXISTS));

    // A later generation may drop a token or bind it to another component.
    const next = createPackageRequest({
      packageId: "package_operations",
      generation: 2n,
      version: "1.1.0"
    });
    next.components[0]!.declaredOperations = ["chat_topics.create"];
    const revised = await declarePackage(context, next);
    assert.deepEqual(
      revised.components.map((value) => value.declaredOperations),
      [[], ["chat_topics.create"]]);
  });

test("rejects malformed and duplicated component operations", async () => {
  const context = getPkgdTestContext();
  const malformed = [
    "",
    "nodot",
    "Chat_messages.post",
    "chat_messages.post.extra",
    "chat-messages.post",
    "chat_messages.",
    ".post"
  ];
  for (const operation of malformed) {
    const request = withRequest("operations_malformed", (value) => {
      value.components[0]!.declaredOperations = [operation];
    });
    await assert.rejects(
      declarePackage(context, request),
      matchGrpcStatus(status.INVALID_ARGUMENT),
      operation);
  }

  // One component owns a token within a generation.
  const duplicated = withRequest("operations_duplicated", (value) => {
    value.components[0]!.declaredOperations = ["chat_messages.post"];
    value.components[1]!.declaredOperations = ["chat_messages.post"];
  });
  await assert.rejects(
    declarePackage(context, duplicated),
    matchGrpcStatus(status.INVALID_ARGUMENT));
  const repeated = withRequest("operations_repeated", (value) => {
    value.components[0]!.declaredOperations = [
      "chat_messages.post",
      "chat_messages.post"
    ];
  });
  await assert.rejects(
    declarePackage(context, repeated),
    matchGrpcStatus(status.INVALID_ARGUMENT));
});
