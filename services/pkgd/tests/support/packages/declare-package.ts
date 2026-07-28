import type {
  DeclarePackageRequest,
  Package
} from "../../generated/v1/pkgd.js";
import type {
  PkgdTestContext
} from "../create-pkgd-test-context.js";
import {
  callUnary
} from "../call-unary.js";

export async function declarePackage(
  context: PkgdTestContext,
  request: DeclarePackageRequest
): Promise<Package> {
  return await callUnary<Package>((done) =>
    context.client.declarePackage(request, done));
}
