import {
  InterfaceProtocol,
  type App,
  type AppScope,
  type PackageServiceClient
} from "../../generated/v1/pkgd.js";
import {
  callUnary
} from "../call-unary.js";
import {
  testWorkloadImage
} from "../images/test-workload-image.js";

export interface DeclareTestAppOptions {
  readonly appId: string;
  readonly placementId: string;
  readonly scope: AppScope;
  readonly artifact?: {
    readonly repository: string;
    readonly manifestDigest: string;
  };
  // Product operations declared by the package's "service" component.
  readonly serviceOperations?: readonly string[];
  readonly generation?: bigint;
}

interface TestArtifact {
  readonly repository: string;
  readonly manifestDigest: string;
}

export interface DeclareTestPackageOptions {
  readonly packageId: string;
  readonly generation?: bigint | undefined;
  readonly artifact?: TestArtifact | undefined;
  readonly serviceOperations?: readonly string[] | undefined;
}

export async function declareTestPackage(
  client: PackageServiceClient,
  options: DeclareTestPackageOptions
): Promise<void> {
  const packageId = options.packageId;
  const generation = options.generation ?? 1n;
  await callUnary((done) => client.declarePackage({
    packageId,
    generation,
    // Each generation carries its own version.
    version: `${String(generation)}.0.0`,
    provenance: {
      sourceUri: `https://packages.example/${packageId}`,
      sourceDigest: `sha256:${"a".repeat(64)}`
    },
    components: [
      component(
        "service",
        options.artifact,
        options.serviceOperations),
      component("web", options.artifact),
      component("finite", options.artifact),
      component("dependent", options.artifact)
    ],
    interfaces: [{
      interfaceId: "http",
      componentId: "web",
      protocol: InterfaceProtocol.INTERFACE_PROTOCOL_HTTP,
      contractId: "test.http.v1",
      port: 8_080
    }],
    dependencies: [{
      name: "Primary database",
      dependencyId: "database",
      componentId: "dependent",
      dependencyType: "postgresql",
      options: {
        canonicalJson: Buffer.from(
          "{\"engine\":\"postgresql\"}",
          "utf8")
      }
    }],
    exposures: [{
      exposureId: "web",
      interfaceId: "http"
    }]
  }, done));
}

export async function declareTestApp(
  client: PackageServiceClient,
  options: DeclareTestAppOptions
): Promise<App> {
  const packageId = `package.${options.appId.replaceAll("_", ".")}`;
  await declareTestPackage(client, {
    packageId,
    generation: options.generation,
    artifact: options.artifact,
    serviceOperations: options.serviceOperations
  });
  return await callUnary<App>((done) => client.createApp({
    appId: options.appId,
    scope: options.scope,
    placementId: options.placementId,
    packageId,
    desiredPackageGeneration: options.generation ?? 1n
  }, done));
}

function component(
  componentId: string,
  artifact: TestArtifact = testWorkloadImage,
  declaredOperations: readonly string[] = []
): {
  readonly componentId: string;
  readonly artifact: {
    readonly repository: string;
    readonly manifestDigest: string;
  };
  readonly declaredOperations: string[];
} {
  return {
    componentId,
    artifact,
    declaredOperations: [...declaredOperations]
  };
}
