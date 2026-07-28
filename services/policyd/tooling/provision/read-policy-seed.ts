import {
  readFile,
  stat
} from "node:fs/promises";
import path from "node:path";
import type {
  PolicySeed
} from "./policy-seed.js";
import {
  validatePolicySeed
} from "./validate-policy-seed.js";

const maximumSeedBytes = 4 * 1024 * 1024;

export async function readPolicySeed(): Promise<PolicySeed> {
  const filePath = process.env.CTLFLOW_POLICY_SEED_PATH;
  if (filePath === undefined || !path.isAbsolute(filePath)) {
    throw new Error(
      "CTLFLOW_POLICY_SEED_PATH must be an absolute file path");
  }

  const details = await stat(filePath);
  if (!details.isFile() || details.size < 2
      || details.size > maximumSeedBytes) {
    throw new Error("Policyd policy seed has an invalid size");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error("Policyd policy seed is not valid JSON", {
      cause: error
    });
  }
  return validatePolicySeed(parsed);
}
