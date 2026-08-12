import { createApiManifest as createServiceApiManifest } from "../../../../tooling/protobuf/create-api-manifest.mjs";

export async function createApiManifest(repositoryRoot, serviceRoot) {
  return await createServiceApiManifest({
    repositoryRoot,
    serviceRoot,
    serviceName: "pkgd"
  });
}
