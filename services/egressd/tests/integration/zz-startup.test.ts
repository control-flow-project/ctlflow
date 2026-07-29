import assert from "node:assert/strict";
import {
  writeFile
} from "node:fs/promises";
import {
  test
} from "node:test";
import {
  createBindingDocument
} from "../support/create-binding-document.js";
import {
  createStartupEnvironment
} from "../support/create-startup-environment.js";
import {
  runEgressdUntilFailure
} from "../support/run-egressd-until-failure.js";
import {
  writeStartupFiles
} from "../support/write-startup-files.js";
import {
  getEgressdTestSuite
} from "../suite/get-egressd-test-suite.js";

const validSecrets = {
  schema_version: 1,
  values: [{
    name: "provider-key",
    value: "test-secret-material"
  }]
};

test("fails startup for every incompatible binding class", async () => {
  const suite = getEgressdTestSuite();
  const base = createBindingDocument(
    suite.origin.endpoint,
    suite.kubernetes.namespace,
    suite.callerServiceAccount);
  const cases: readonly StartupCase[] = [
    { name: "invalid JSON", binding: "{" },
    { name: "non-object document", binding: "[]\n" },
    {
      name: "duplicate property",
      binding: stringify(base).replace(
        '"schema_version": 1,',
        '"schema_version": 1, "schema_version": 1,')
    },
    {
      name: "unknown property",
      binding: mutate(base, (value) => {
        value.unknown = true;
      })
    },
    {
      name: "missing property",
      binding: mutate(base, (value) => {
        delete value.binding_id;
      })
    },
    {
      name: "schema version",
      binding: mutate(base, (value) => {
        value.schema_version = 2;
      })
    },
    {
      name: "document size",
      binding: `${" ".repeat(1024 * 1024)}\n`
    },
    {
      name: "binding identifier",
      binding: mutate(base, (value) => {
        value.binding_id = "Invalid";
      })
    },
    {
      name: "binding identifier bound",
      binding: mutate(base, (value) => {
        value.binding_id = `a${"b".repeat(64)}`;
      })
    },
    {
      name: "caller identity",
      binding: mutate(base, (value) => {
        nested(value, "caller").service_account = "Invalid";
      })
    },
    {
      name: "caller namespace",
      binding: mutate(base, (value) => {
        nested(value, "caller").namespace = "-invalid";
      })
    },
    {
      name: "origin",
      binding: mutate(base, (value) => {
        value.origin = "http://origin.invalid";
      })
    },
    {
      name: "noncanonical origin",
      binding: mutate(base, (value) => {
        value.origin = String(value.origin).replace(
          "https://",
          "https://UPPER.");
      })
    },
    {
      name: "origin path",
      binding: mutate(base, (value) => {
        value.origin = `${String(value.origin).replace(/\/$/u, "")}/path`;
      })
    },
    {
      name: "empty rules",
      binding: mutate(base, (value) => {
        value.rules = [];
      })
    },
    {
      name: "too many rules",
      binding: mutate(base, (value) => {
        const first = rules(value)[0]!;
        value.rules = Array.from({ length: 257 }, (_, index) => ({
          ...first,
          rule_id: `rule_${String(index)}`
        }));
      })
    },
    {
      name: "duplicate rule identifier",
      binding: mutate(base, (value) => {
        rules(value)[1]!.rule_id = rules(value)[0]!.rule_id;
      })
    },
    {
      name: "unknown rule property",
      binding: mutate(base, (value) => {
        rules(value)[0]!.unknown = true;
      })
    },
    {
      name: "missing rule property",
      binding: mutate(base, (value) => {
        delete rules(value)[0]!.forward_trace_context;
      })
    },
    {
      name: "rule identifier",
      binding: mutate(base, (value) => {
        rules(value)[0]!.rule_id = "Invalid";
      })
    },
    {
      name: "empty methods",
      binding: mutate(base, (value) => {
        rules(value)[0]!.methods = [];
      })
    },
    {
      name: "unknown method",
      binding: mutate(base, (value) => {
        rules(value)[0]!.methods = ["CONNECT"];
      })
    },
    {
      name: "match kind",
      binding: mutate(base, (value) => {
        nested(rules(value)[0]!, "match").kind = "glob";
      })
    },
    {
      name: "ambiguous method and path",
      binding: mutate(base, (value) => {
        const duplicate = structuredClone(rules(value)[0]!);
        duplicate.rule_id = "ambiguous";
        rules(value).push(duplicate);
      })
    },
    {
      name: "protected forwarded header",
      binding: mutate(base, (value) => {
        rules(value)[0]!.forward_request_headers =
          ["proxy-authorization"];
      })
    },
    {
      name: "hop-by-hop response header",
      binding: mutate(base, (value) => {
        rules(value)[0]!.forward_response_headers = ["connection"];
      })
    },
    {
      name: "protected replacement header",
      binding: mutate(base, (value) => {
        rules(value)[0]!.set_request_headers = [{
          name: "host",
          value: { literal: "invalid" }
        }];
      })
    },
    {
      name: "absent secret",
      binding: mutate(base, (value) => {
        rules(value)[0]!.set_request_headers = [{
          name: "x-secret",
          value: { secret_name: "absent" }
        }];
      })
    },
    {
      name: "duplicate method",
      binding: mutate(base, (value) => {
        rules(value)[0]!.methods = ["GET", "GET"];
      })
    },
    {
      name: "duplicate forwarded header",
      binding: mutate(base, (value) => {
        rules(value)[0]!.forward_request_headers = ["accept", "accept"];
      })
    },
    {
      name: "forwarded header bound",
      binding: mutate(base, (value) => {
        rules(value)[0]!.forward_request_headers = Array.from(
          { length: 129 },
          (_, index) => `x-header-${String(index)}`);
      })
    },
    {
      name: "header name",
      binding: mutate(base, (value) => {
        rules(value)[0]!.forward_request_headers = ["X-Upper"];
      })
    },
    {
      name: "duplicate replacement header",
      binding: mutate(base, (value) => {
        rules(value)[0]!.set_request_headers = [{
          name: "x-value",
          value: { literal: "first" }
        }, {
          name: "x-value",
          value: { literal: "second" }
        }];
      })
    },
    {
      name: "replacement header bound",
      binding: mutate(base, (value) => {
        rules(value)[0]!.set_request_headers = Array.from(
          { length: 129 },
          (_, index) => ({
            name: `x-set-${String(index)}`,
            value: { literal: "value" }
          }));
      })
    },
    {
      name: "replacement value shape",
      binding: mutate(base, (value) => {
        rules(value)[0]!.set_request_headers = [{
          name: "x-value",
          value: {
            literal: "value",
            secret_name: "provider-key"
          }
        }];
      })
    },
    {
      name: "replacement literal",
      binding: mutate(base, (value) => {
        rules(value)[0]!.set_request_headers = [{
          name: "x-value",
          value: { literal: "line\nbreak" }
        }];
      })
    },
    {
      name: "unsafe rule path",
      binding: mutate(base, (value) => {
        nested(rules(value)[0]!, "match").path = "/unsafe/../path";
      })
    },
    {
      name: "trailing rule path",
      binding: mutate(base, (value) => {
        nested(rules(value)[0]!, "match").path = "/unsafe/";
      })
    },
    {
      name: "upstream rule path",
      binding: mutate(base, (value) => {
        rules(value)[0]!.upstream_path_prefix = "/unsafe%2fpath";
      })
    },
    {
      name: "request body bound",
      binding: mutate(base, (value) => {
        rules(value)[0]!.maximum_request_body_bytes = 0;
      })
    },
    {
      name: "response body bound",
      binding: mutate(base, (value) => {
        rules(value)[0]!.maximum_response_body_bytes = 67_108_865;
      })
    },
    {
      name: "trace flag",
      binding: mutate(base, (value) => {
        rules(value)[0]!.forward_trace_context = "false";
      })
    }
  ];
  await forEachBounded(cases, async (invalid) =>
    await assertStartupFailure(
      suite,
      invalid.binding,
      stringify(validSecrets),
      invalid.name));
});

test("fails startup for every incompatible secret document class",
  async () => {
    const suite = getEgressdTestSuite();
    const binding = stringify(createBindingDocument(
      suite.origin.endpoint,
      suite.kubernetes.namespace,
      suite.callerServiceAccount));
    const cases = [
      ["invalid JSON", "{"],
      ["non-object document", "[]\n"],
      [
        "duplicate property",
        stringify(validSecrets).replace(
          '"schema_version": 1,',
          '"schema_version": 1, "schema_version": 1,')
      ],
      [
        "unknown property",
        mutate(validSecrets, (value) => {
          value.unknown = true;
        })
      ],
      [
        "missing property",
        mutate(validSecrets, (value) => {
          delete value.values;
        })
      ],
      [
        "schema version",
        mutate(validSecrets, (value) => {
          value.schema_version = 2;
        })
      ],
      [
        "duplicate secret",
        mutate(validSecrets, (value) => {
          const values = value.values as Record<string, unknown>[];
          values.push(structuredClone(values[0]!));
        })
      ],
      [
        "secret count bound",
        mutate(validSecrets, (value) => {
          value.values = Array.from(
            { length: 257 },
            (_, index) => ({
              name: `secret-${String(index)}`,
              value: "value"
            }));
        })
      ],
      [
        "secret item property",
        mutate(validSecrets, (value) => {
          const values = value.values as Record<string, unknown>[];
          values[0]!.unknown = true;
        })
      ],
      [
        "secret name",
        mutate(validSecrets, (value) => {
          const values = value.values as Record<string, unknown>[];
          values[0]!.name = "Invalid";
        })
      ],
      [
        "secret value",
        mutate(validSecrets, (value) => {
          const values = value.values as Record<string, unknown>[];
          values[0]!.value = "";
        })
      ],
      [
        "secret value bound",
        mutate(validSecrets, (value) => {
          const values = value.values as Record<string, unknown>[];
          values[0]!.value = "x".repeat(8_193);
        })
      ],
      [
        "secret value control",
        mutate(validSecrets, (value) => {
          const values = value.values as Record<string, unknown>[];
          values[0]!.value = "line\nbreak";
        })
      ]
    ] as const;
    await forEachBounded(cases, async ([name, secrets]) =>
      await assertStartupFailure(suite, binding, secrets, name));
  });

test("fails startup for malformed trust and bootstrap settings",
  async () => {
    const suite = getEgressdTestSuite();
    const binding = stringify(createBindingDocument(
      suite.origin.endpoint,
      suite.kubernetes.namespace,
      suite.callerServiceAccount));
    const files = await writeStartupFiles(
      suite,
      binding,
      stringify(validSecrets));
    await writeFile(files.workloadJwksPath, "{}", "utf8");
    let environment = await createStartupEnvironment(suite, files);
    let diagnostics = await runEgressdUntilFailure(
      suite.egressd.executablePath,
      environment);
    assert.equal(diagnostics.includes("test-secret-material"), false);

    const trustFiles = await writeStartupFiles(
      suite,
      binding,
      stringify(validSecrets));
    await writeFile(
      trustFiles.upstreamCertificateAuthorityPath,
      "not a certificate",
      "utf8");
    environment = await createStartupEnvironment(suite, trustFiles);
    diagnostics = await runEgressdUntilFailure(
      suite.egressd.executablePath,
      environment);
    assert.equal(diagnostics.includes("test-secret-material"), false);

    const bootstrapCases = [
      {
        name: "listener scheme",
        change: () => ({
          CTLFLOW_PRIVATE_URL: "https://127.0.0.1:8081"
        })
      },
      {
        name: "listener collision",
        change: (values) => ({
          CTLFLOW_PROBE_URL: values.CTLFLOW_PRIVATE_URL ?? ""
        })
      },
      {
        name: "binding file",
        change: () => ({
          CTLFLOW_EGRESS_BINDING_PATH: "binding.json"
        })
      },
      {
        name: "workload issuer",
        change: () => ({
          CTLFLOW_WORKLOAD_TOKEN_ISSUER: "relative"
        })
      },
      {
        name: "workload audience",
        change: () => ({
          CTLFLOW_WORKLOAD_TOKEN_AUDIENCE: "invalid audience"
        })
      },
      {
        name: "workload lifetime",
        change: () => ({
          CTLFLOW_WORKLOAD_TOKEN_MAX_LIFETIME_SECONDS: "3601"
        })
      },
      {
        name: "upstream timeout",
        change: () => ({
          CTLFLOW_UPSTREAM_TIMEOUT_MILLISECONDS: "300001"
        })
      },
      {
        name: "telemetry endpoint",
        change: () => ({
          OTEL_EXPORTER_OTLP_ENDPOINT: "ftp://invalid"
        })
      }
    ] satisfies readonly BootstrapCase[];
    await forEachBounded(bootstrapCases, async (invalid) => {
      const nextFiles = await writeStartupFiles(
        suite,
        binding,
        stringify(validSecrets));
      const validEnvironment =
        await createStartupEnvironment(suite, nextFiles);
      const nextDiagnostics = await runEgressdUntilFailure(
        suite.egressd.executablePath,
        {
          ...validEnvironment,
          ...invalid.change(validEnvironment)
        });
      assert.equal(
        nextDiagnostics.includes("test-secret-material"),
        false,
        invalid.name);
    });
  });

interface StartupCase {
  readonly name: string;
  readonly binding: string;
}

interface BootstrapCase {
  readonly name: string;
  readonly change: (
    environment: Readonly<Record<string, string>>
  ) => Readonly<Record<string, string>>;
}

async function assertStartupFailure(
  suite: ReturnType<typeof getEgressdTestSuite>,
  binding: string,
  secrets: string,
  name: string
): Promise<void> {
  const files = await writeStartupFiles(suite, binding, secrets);
  const environment = await createStartupEnvironment(suite, files);
  const diagnostics = await runEgressdUntilFailure(
    suite.egressd.executablePath,
    environment);
  assert.equal(
    diagnostics.includes("test-secret-material"),
    false,
    name);
  assert.equal(
    diagnostics.includes(suite.caller.callerToken),
    false,
    name);
}

function mutate(
  value: object,
  change: (copy: Record<string, unknown>) => void
): string {
  const copy = structuredClone(value) as Record<string, unknown>;
  change(copy);
  return stringify(copy);
}

function stringify(value: object): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function nested(
  value: Record<string, unknown>,
  name: string
): Record<string, unknown> {
  return value[name] as Record<string, unknown>;
}

function rules(
  value: Record<string, unknown>
): Record<string, unknown>[] {
  return value.rules as Record<string, unknown>[];
}

async function forEachBounded<T>(
  values: readonly T[],
  operation: (value: T) => Promise<void>
): Promise<void> {
  const width = 4;
  for (let index = 0; index < values.length; index += width) {
    await Promise.all(values
      .slice(index, index + width)
      .map(operation));
  }
}
