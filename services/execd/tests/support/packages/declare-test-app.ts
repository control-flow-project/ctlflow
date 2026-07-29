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
}

interface TestArtifact {
  readonly repository: string;
  readonly manifestDigest: string;
}

export async function declareTestApp(
  client: PackageServiceClient,
  options: DeclareTestAppOptions
): Promise<App> {
  const packageId = `package.${options.appId.replaceAll("_", ".")}`;
  await callUnary((done) => client.declarePackage({
    packageId,
    generation: 1n,
    version: "1.0.0",
    provenance: {
      sourceUri: `https://packages.example/${packageId}`,
      sourceDigest: `sha256:${"a".repeat(64)}`
    },
    components: [
      component("service", options.artifact),
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
  return await callUnary<App>((done) => client.createApp({
    appId: options.appId,
    scope: options.scope,
    placementId: options.placementId,
    packageId,
    desiredPackageGeneration: 1n
  }, done));
}

function component(
  componentId: string,
  artifact: TestArtifact = testWorkloadImage
): {
  readonly componentId: string;
  readonly artifact: {
    readonly repository: string;
    readonly manifestDigest: string;
  };
} {
  return {
    componentId,
    artifact
  };
}
