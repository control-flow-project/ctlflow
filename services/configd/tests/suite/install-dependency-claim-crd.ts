import type {
  TestKubernetes
} from "@ctlflow/test-mesh";

const manifest = `apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: dependencyclaims.execution.ctlflow.io
spec:
  group: execution.ctlflow.io
  names:
    kind: DependencyClaim
    plural: dependencyclaims
    singular: dependencyclaim
  scope: Namespaced
  versions:
    - name: v1
      served: true
      storage: true
      schema:
        openAPIV3Schema:
          type: object
          properties:
            spec:
              type: object
              required:
                - claimRevision
                - placementId
                - workloadId
                - provisionerSubject
              properties:
                claimRevision:
                  type: integer
                  format: int64
                  minimum: 1
                placementId:
                  type: string
                workloadId:
                  type: string
                provisionerSubject:
                  type: string
`;

export async function installDependencyClaimCrd(
  kubernetes: TestKubernetes
): Promise<void> {
  await kubernetes.runKubectl(["apply", "-f", "-"], manifest);
  await kubernetes.runKubectl([
    "wait",
    "--for=condition=Established",
    "crd/dependencyclaims.execution.ctlflow.io",
    "--timeout=30s"
  ]);
}
