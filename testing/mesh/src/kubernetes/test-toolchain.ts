export interface TestToolchain {
  readonly minikube: {
    readonly version: string;
    readonly linuxAmd64Sha256: string;
  };
  readonly kubernetesVersion: string;
  readonly profile: string;
  readonly driver: "docker";
  readonly containerRuntime: "containerd";
  readonly cpus: number;
  readonly memoryMiB: number;
}
