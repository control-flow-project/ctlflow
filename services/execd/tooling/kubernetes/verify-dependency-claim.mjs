import {
  readFile
} from "node:fs/promises";
import path from "node:path";
import {
  fileURLToPath
} from "node:url";
import {
  parseAllDocuments
} from "yaml";

const serviceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..");
const contractPath = path.join(
  serviceRoot,
  "api/kubernetes/v1/dependency-claim-crd.yaml");
const documents = parseAllDocuments(await readFile(contractPath, "utf8"), {
  strict: true,
  uniqueKeys: true
});
for (const document of documents) {
  assert(
    document.errors.length === 0
      && document.warnings.length === 0,
    "DependencyClaim contract contains invalid YAML");
}
const resources = documents.map((document) =>
  document.toJS({ maxAliasCount: 0 }));
assertSame(
  resources.map((resource) => [
    resource.apiVersion,
    resource.kind,
    resource.metadata?.name ?? ""
  ]),
  [
    [
      "apiextensions.k8s.io/v1",
      "CustomResourceDefinition",
      "dependencyclaims.execution.ctlflow.io"
    ],
    [
      "admissionregistration.k8s.io/v1",
      "ValidatingAdmissionPolicy",
      "dependencyclaim-owner.execution.ctlflow.io"
    ],
    [
      "admissionregistration.k8s.io/v1",
      "ValidatingAdmissionPolicyBinding",
      "dependencyclaim-owner.execution.ctlflow.io"
    ]
  ],
  "DependencyClaim resource inventory");

const customResource = resources[0];
assert(
  customResource.spec?.group === "execution.ctlflow.io"
    && customResource.spec?.scope === "Namespaced"
    && customResource.spec?.names?.plural === "dependencyclaims"
    && customResource.spec?.names?.singular === "dependencyclaim"
    && customResource.spec?.names?.kind === "DependencyClaim",
  "DependencyClaim identity is invalid");
assertSame(
  customResource.spec?.versions?.map((version) => [
    version.name,
    version.served,
    version.storage,
    Boolean(version.subresources?.status)
  ]),
  [["v1", true, true, true]],
  "DependencyClaim version inventory");

const schema = customResource.spec.versions[0]
  .schema.openAPIV3Schema;
const spec = schema.properties?.spec;
const status = schema.properties?.status;
assertSame(
  spec?.required,
  [
    "claimId",
    "claimRevision",
    "placementId",
    "workloadId",
    "placementTarget",
    "componentId",
    "dependencyName",
    "dependencyType",
    "provisionerId",
    "provisionerSubject",
    "optionsCanonicalJson",
    "parameters"
  ],
  "DependencyClaim spec required-field inventory");
assertSame(
  status?.properties?.phase?.enum,
  ["pending", "ready", "rejected"],
  "DependencyClaim phase inventory");
assert(
  spec?.properties?.claimId?.pattern === "^dpc-[0-9a-f]{32}$"
    && spec?.properties?.parameters?.maxItems === 64
    && status?.properties?.ready?.properties?.configdTargets?.maxItems === 64,
  "DependencyClaim bounds are invalid");
assert(
  schema["x-kubernetes-validations"]?.some((validation) =>
    validation.rule.includes(
      "status.observedClaimRevision <= self.spec.claimRevision")),
  "DependencyClaim must reject future observed revisions");

const policy = resources[1];
assert(
  policy.spec?.failurePolicy === "Fail"
    && policy.spec?.matchConstraints?.resourceRules?.[0]?.apiGroups?.[0]
      === "execution.ctlflow.io"
    && policy.spec?.matchConstraints?.resourceRules?.[0]?.resources
      ?.includes("dependencyclaims/status"),
  "DependencyClaim admission policy scope is invalid");
assert(
  policy.spec?.validations?.some((validation) =>
    validation.expression.includes(
      "execution.ctlflow.io/owner-service")
      && validation.expression.includes("'execd'"))
    && policy.spec?.validations?.some((validation) =>
      validation.expression ===
        "object.metadata.name == object.spec.claimId"),
  "DependencyClaim admission policy does not enforce ownership");

const binding = resources[2];
assert(
  binding.spec?.policyName ===
    "dependencyclaim-owner.execution.ctlflow.io"
    && binding.spec?.validationActions?.length === 1
    && binding.spec.validationActions[0] === "Deny",
  "DependencyClaim admission policy binding is invalid");

const kubernetesSource = await readSources([
  "Kubernetes/BuildDependencyClaim.cs",
  "Kubernetes/InspectDependencyClaim.cs",
  "Kubernetes/KubernetesResourcePaths.cs",
  "Kubernetes/OwnershipAnnotations.cs"
]);
for (const token of [
  "execution.ctlflow.io",
  "dependencyclaims",
  "execution.ctlflow.io/owner-service",
  "execd"
]) {
  assert(
    kubernetesSource.includes(token),
    `Execd Kubernetes implementation is missing ${token}`);
}

process.stdout.write("execd DependencyClaim contract verified\n");

async function readSources(relativePaths) {
  return (await Promise.all(relativePaths.map(async (relativePath) =>
    await readFile(path.join(
      serviceRoot,
      "csharp/src/CtlFlow.Execution.Execd.Service",
      relativePath), "utf8")))).join("\n");
}

function assertSame(actual, expected, label) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label} mismatch: expected ${JSON.stringify(expected)}, `
      + `found ${JSON.stringify(actual)}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
