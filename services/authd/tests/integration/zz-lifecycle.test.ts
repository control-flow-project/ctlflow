import assert from "node:assert/strict";
import {
  mkdir,
  readFile,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import {
  test
} from "node:test";
import {
  getAuthdTestSuite
} from "../suite/get-authd-test-suite.js";
import {
  requestAuthd
} from "../support/request-authd.js";
import {
  runAuthdUntilFailure
} from "../support/run-authd-until-failure.js";

test("invalid projected configuration fails startup and readiness",
  async () => {
    const suite = getAuthdTestSuite();
    const providerText = await readFile(
      suite.files.providerConfigPath,
      "utf8");
    const secretText = await readFile(
      suite.files.providerSecretPath,
      "utf8");
    const directory = path.join(
      suite.repositoryRoot,
      ".temp",
      "authd-invalid-projections");
    await mkdir(directory, { recursive: true });
    const providerPath = path.join(directory, "providers.json");
    const secretPath = path.join(directory, "credentials.json");
    const providerDocument =
      JSON.parse(providerText) as ProviderProjectionDocument;
    const secretDocument =
      JSON.parse(secretText) as SecretProjectionDocument;

    for (const testCase of invalidProviderCases()) {
      const document = structuredClone(providerDocument);
      testCase.mutate(document);
      await writeFile(
        providerPath,
        `${JSON.stringify(document)}\n`,
        "utf8");
      await writeFile(
        secretPath,
        secretText,
        "utf8");
      assert.match(
        await failStartup(
          suite.authd.executablePath,
          providerPath,
          secretPath),
        testCase.error);
    }

    await writeFile(providerPath, providerText, "utf8");
    await writeFile(
      secretPath,
      providerText.replace(
        /"public_origin"/u,
        '"public_origin":"duplicate","public_origin"'),
      "utf8");
    assert.match(
      await failStartup(
        suite.authd.executablePath,
        secretPath,
        suite.files.providerSecretPath),
      /duplicate member/iu);

    const invalidSecret = structuredClone(secretDocument);
    invalidSecret.unexpected = true;
    await writeFile(providerPath, providerText, "utf8");
    await writeFile(
      secretPath,
      `${JSON.stringify(invalidSecret)}\n`,
      "utf8");
    assert.match(
      await failStartup(
        suite.authd.executablePath,
        providerPath,
        secretPath),
      /member inventory/iu);

    const ready = await requestAuthd({
      method: "GET",
      path: "/readyz",
      probe: true
    });
    assert.equal(ready.statusCode, 204);
  });

interface ProviderProjectionDocument {
  schema_version: number;
  public_origin: string;
  providers: ProviderDocument[];
}

interface ProviderDocument {
  authorization_endpoint: string;
  credential_ref: string;
  egress_binding: string;
  verification_keys: VerificationKeyDocument[];
}

interface VerificationKeyDocument {
  alg: string;
}

interface SecretProjectionDocument {
  schema_version: number;
  credentials: unknown[];
  unexpected?: boolean;
}

interface InvalidProviderCase {
  readonly error: RegExp;
  readonly mutate: (document: ProviderProjectionDocument) => void;
}

function invalidProviderCases(): readonly InvalidProviderCase[] {
  return [
    {
      error: /schema version/iu,
      mutate: (document) => {
        document.schema_version = 2;
      }
    },
    {
      error: /public origin|provider URI/iu,
      mutate: (document) => {
        document.public_origin = "http://auth.example.test";
      }
    },
    {
      error: /provider inventory/iu,
      mutate: (document) => {
        document.providers = [];
      }
    },
    {
      error: /Egress binding/iu,
      mutate: (document) => {
        document.providers[0]!.egress_binding = "Invalid_binding";
      }
    },
    {
      error: /Provider URI/iu,
      mutate: (document) => {
        document.providers[0]!.authorization_endpoint += "?";
      }
    },
    {
      error: /verification-key metadata/iu,
      mutate: (document) => {
        document.providers[0]!.verification_keys[0]!.alg = "ES256";
      }
    },
    {
      error: /credential is missing/iu,
      mutate: (document) => {
        document.providers[0]!.credential_ref = "missing";
      }
    }
  ];
}

async function failStartup(
  executablePath: string,
  providerPath: string,
  secretPath: string
): Promise<string> {
  return await runAuthdUntilFailure(executablePath, {
    CTLFLOW_PUBLIC_URL: "http://127.0.0.1:18081",
    CTLFLOW_PROBE_URL: "http://127.0.0.1:18080",
    CTLFLOW_PROVIDER_CONFIG_PATH: providerPath,
    CTLFLOW_PROVIDER_SECRET_PATH: secretPath
  });
}
