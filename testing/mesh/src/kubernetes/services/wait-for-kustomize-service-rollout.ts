import type {
  KustomizeServiceOptions
} from "./kustomize-service.js";
import {
  waitForKubernetesStatefulSet
} from "../wait-for-kubernetes-stateful-set.js";

export async function waitForKustomizeServiceRollout(
  options: KustomizeServiceOptions
): Promise<void> {
  await waitForKubernetesStatefulSet(
    options.kubernetes,
    options.name);
}
