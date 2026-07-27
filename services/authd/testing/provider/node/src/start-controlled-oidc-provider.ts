import {
  generateKeyPairSync,
  randomUUID,
  type JsonWebKey
} from "node:crypto";
import {
  mkdir,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import {
  buildNodeTestImage,
  createTestServiceTls,
  startNodeTestService,
  type TestKubernetes
} from "@ctlflow/test-mesh";
import type {
  ControlledOidcProvider
} from "./controlled-oidc-provider.js";
import type {
  OidcProviderEvidence
} from "./oidc-provider-evidence.js";
import type {
  OidcProviderMode
} from "./oidc-provider-mode.js";
import {
  requestAuthorization
} from "./request-authorization.js";
import {
  requestProviderControl
} from "./request-provider-control.js";

const serviceName = "oidc-provider";
const servicePort = 8443;
const controlPort = 8080;
const clientId = "ctlflow-browser";
const clientSecret = "provider-client-secret";
const keyId = "provider-signing-key";

export interface StartControlledOidcProviderOptions {
  readonly repositoryRoot: string;
  readonly kubernetes: TestKubernetes;
  readonly callbackUri: string;
}

export async function startControlledOidcProvider(
  options: StartControlledOidcProviderOptions
): Promise<ControlledOidcProvider> {
  const storageDirectory = path.join(
    "dependencies",
    `oidc-${randomUUID()}`);
  const directory = path.join(
    options.kubernetes.storage.hostRoot,
    storageDirectory);
  await mkdir(directory, { recursive: true });
  const dnsNames = [
    serviceName,
    `${serviceName}.${options.kubernetes.namespace}`,
    `${serviceName}.${options.kubernetes.namespace}.svc`
  ];
  const tls = await createTestServiceTls(
    options.repositoryRoot,
    directory,
    serviceName,
    dnsNames);
  const signing = generateKeyPairSync("rsa", {
    modulusLength: 2_048,
    publicExponent: 65_537
  });
  const privateKeyPath = path.join(directory, "oidc-signing.pem");
  await writeFile(
    privateKeyPath,
    signing.privateKey.export({
      type: "pkcs8",
      format: "pem"
    }),
    { mode: 0o600 });
  const publicKey = signing.publicKey.export({
    format: "jwk"
  });
  assertPublicKey(publicKey);

  const origin =
    `https://${serviceName}.${options.kubernetes.namespace}.svc:`
    + String(servicePort);
  const image = await buildNodeTestImage({
    repositoryRoot: options.repositoryRoot,
    kubernetes: options.kubernetes,
    imageName: serviceName,
    containerfilePath: path.join(
      options.repositoryRoot,
      "services/authd/testing/provider/node/Containerfile"),
    sourcePaths: [
      path.join(
        options.repositoryRoot,
        "tooling/clean-directories.mjs"),
      path.join(options.repositoryRoot, "testing/mesh"),
      path.join(
        options.repositoryRoot,
        "services/auditd/package.json"),
      path.join(
        options.repositoryRoot,
        "services/authd/package.json"),
      path.join(
        options.repositoryRoot,
        "services/egressd/package.json"),
      path.join(
        options.repositoryRoot,
        "services/identityd/package.json"),
      path.join(options.repositoryRoot, "services/authd/testing")
    ]
  });
  const service = await startNodeTestService({
    kubernetes: options.kubernetes,
    name: serviceName,
    image,
    storageDirectory,
    servicePort,
    controlPort,
    serviceScheme: "https",
    environment: {
      CTLFLOW_TEST_OIDC_HTTPS_PORT: String(servicePort),
      CTLFLOW_TEST_OIDC_CONTROL_PORT: String(controlPort),
      CTLFLOW_TEST_OIDC_TLS_CERTIFICATE_PATH:
        `/ctlflow-context/${path.basename(tls.certificatePath)}`,
      CTLFLOW_TEST_OIDC_TLS_PRIVATE_KEY_PATH:
        `/ctlflow-context/${path.basename(tls.privateKeyPath)}`,
      CTLFLOW_TEST_OIDC_SIGNING_PRIVATE_KEY_PATH:
        `/ctlflow-context/${path.basename(privateKeyPath)}`,
      CTLFLOW_TEST_OIDC_ORIGIN: origin,
      CTLFLOW_TEST_OIDC_CALLBACK_URI: options.callbackUri,
      CTLFLOW_TEST_OIDC_CLIENT_ID: clientId,
      CTLFLOW_TEST_OIDC_CLIENT_SECRET: clientSecret,
      CTLFLOW_TEST_OIDC_KEY_ID: keyId
    }
  });

  return {
    issuer: `${origin}/issuer`,
    authorizationEndpoint: `${origin}/authorize`,
    tokenEndpoint: `${origin}/token`,
    userInfoEndpoint: `${origin}/userinfo`,
    clientId,
    clientSecret,
    keyId,
    publicKey,
    certificateAuthorityPath: tls.certificateAuthorityPath,
    serverName: tls.serverName,
    authorize: async (location) =>
      await requestAuthorization(
        service.localEndpoint,
        location,
        origin,
        tls.serverName,
        tls.certificateAuthorityPath),
    setMode: async (mode: OidcProviderMode) => {
      await requestProviderControl<void>(
        service.controlEndpoint,
        "/mode",
        { method: "PUT", body: { mode } });
    },
    clearEvidence: async () => {
      await requestProviderControl<void>(
        service.controlEndpoint,
        "/evidence",
        { method: "DELETE" });
    },
    readEvidence: async () =>
      await requestProviderControl<OidcProviderEvidence>(
        service.controlEndpoint,
        "/evidence"),
    stop: service.stop
  };
}

function assertPublicKey(
  value: JsonWebKey
): asserts value is JsonWebKey & {
  readonly kty: "RSA";
  readonly n: string;
  readonly e: string;
} {
  if (value.kty !== "RSA"
      || typeof value.n !== "string"
      || typeof value.e !== "string") {
    throw new Error("Generated OIDC public key is invalid");
  }
}
