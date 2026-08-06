import {
  InterfaceProtocol,
  type DeclarePackageRequest
} from "../../generated/v1/pkgd.js";

const digestA = `sha256:${"a".repeat(64)}`;
const digestB = `sha256:${"b".repeat(64)}`;
const digestC = `sha256:${"c".repeat(64)}`;

export interface CreatePackageRequestOptions {
  readonly packageId: string;
  readonly generation?: bigint;
  readonly version?: string;
}

export function createPackageRequest(
  options: CreatePackageRequestOptions
): DeclarePackageRequest {
  return {
    packageId: options.packageId,
    generation: options.generation ?? 1n,
    version: options.version ?? "1.0.0",
    provenance: {
      sourceUri:
        `https://packages.example.com/${options.packageId}`,
      sourceDigest: digestA
    },
    components: [
      {
        componentId: "worker",
        artifact: {
          repository: "registry.example.com/apps/worker",
          manifestDigest: digestC
        },
        declaredOperations: []
      },
      {
        componentId: "api",
        artifact: {
          repository: "registry.example.com/apps/api",
          manifestDigest: digestB
        },
        declaredOperations: []
      }
    ],
    interfaces: [
      {
        interfaceId: "worker_grpc",
        componentId: "worker",
        protocol: InterfaceProtocol.INTERFACE_PROTOCOL_GRPC,
        contractId: "jobs.v1.worker",
        port: 5_051
      },
      {
        interfaceId: "api_http",
        componentId: "api",
        protocol: InterfaceProtocol.INTERFACE_PROTOCOL_HTTP,
        contractId: "apps.v1.http",
        port: 8_080
      }
    ],
    dependencies: [
      {
        name: "Task queue",
        dependencyId: "queue",
        componentId: "worker",
        dependencyType: "service:queue",
        options: {
          canonicalJson: Buffer.from(
            "{\"delivery\":\"at-least-once\"}",
            "utf8")
        }
      },
      {
        name: "Primary database",
        dependencyId: "database",
        componentId: "api",
        dependencyType: "postgresql",
        options: {
          canonicalJson: Buffer.from(
            "{\"extensions\":[\"pg_trgm\"],\"version\":17}",
            "utf8")
        }
      }
    ],
    exposures: [
      {
        exposureId: "worker",
        interfaceId: "worker_grpc"
      },
      {
        exposureId: "web",
        interfaceId: "api_http"
      }
    ]
  };
}
