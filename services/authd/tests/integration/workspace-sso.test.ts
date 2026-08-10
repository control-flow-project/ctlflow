import assert from "node:assert/strict";
import {
  test
} from "node:test";
import type {
  LoginProvider,
  WorkspaceLoginProviderAdmission
} from "@ctlflow/identityd/testing/production";
import {
  getAuthdTestSuite
} from "../suite/get-authd-test-suite.js";
import {
  assertNonDisclosingError
} from "../support/assert-browser-response.js";
import {
  beginAuthentication,
  browserPostHeaders,
  completeAuthentication
} from "../support/browser-flow.js";
import {
  providerRegistrationFixture
} from "../support/provider-registration-fixture.js";
import {
  requestAuthd
} from "../support/request-authd.js";

const atlasAdmission: WorkspaceLoginProviderAdmission = {
  tenantId: "acme",
  workspaceId: "atlas",
  providerId: "oidc"
};

test("accepts an admitted Workspace provider and keeps Tenant login independent",
  async () => {
    const suite = getAuthdTestSuite();
    const completed = await completeAuthentication(
      "/atlas",
      undefined,
      "atlas");
    assert.equal(completed.callback.statusCode, 303);

    await suite.identitySource.setWorkspaceLoginProviderAdmissions([]);
    try {
      assertNonDisclosingError(
        await requestBegin("atlas"),
        400);
      const tenant = await beginAuthentication("/tenant");
      assert.equal(tenant.response.statusCode, 303);
    } finally {
      await restoreAdmissions();
    }
  });

test("Begin rejects inactive providers and stale projected references",
  async () => {
    const suite = getAuthdTestSuite();
    await suite.identitySource.setLoginProviders([
      providerRecord({ state: "disabled", revision: 2 })
    ]);
    try {
      assertNonDisclosingError(await requestBegin("atlas"), 400);
    } finally {
      await restoreProvider();
    }

    await suite.identitySource.setLoginProviders([
      providerRecord({
        configurationVersionId: "authd-oidc-v2",
        revision: 3
      })
    ]);
    try {
      assertNonDisclosingError(await requestBegin("atlas"), 503);
    } finally {
      await restoreProvider();
    }
  });

test("Begin fails closed while Identityd is unavailable",
  async () => {
    const suite = getAuthdTestSuite();
    await suite.identitySource.setMode("unavailable");
    try {
      assertNonDisclosingError(await requestBegin("atlas"), 503);
    } finally {
      await suite.identitySource.setMode("available");
      await suite.authd.restart();
    }
  });

test("consumes every bounded Workspace admission page",
  async () => {
    const suite = getAuthdTestSuite();
    const providers = Array.from(
      { length: 100 },
      (_, index) => dummyProvider(index));
    await suite.identitySource.setLoginProviders(providers);
    await suite.identitySource.setWorkspaceLoginProviderAdmissions([
      ...providers.map((provider) => ({
        tenantId: provider.tenantId,
        workspaceId: "atlas",
        providerId: provider.providerId
      })),
      atlasAdmission
    ]);
    try {
      const begun = await beginAuthentication(
        "/atlas/paged",
        undefined,
        "atlas");
      assert.equal(begun.response.statusCode, 303);
    } finally {
      await restoreAdmissions();
    }
  });

test("Callback revalidates Workspace admission before Egressd",
  async () => {
    const suite = getAuthdTestSuite();
    await suite.provider.clearEvidence();
    const pending = await beginAuthentication(
      "/atlas/revoked",
      undefined,
      "atlas");
    const callback = await authorize(pending.authorizationLocation);
    await suite.identitySource.setWorkspaceLoginProviderAdmissions([]);
    try {
      assertNonDisclosingError(
        await requestCallback(callback, pending.stateCookie),
        401);
      await assertNoProviderExchange();
    } finally {
      await restoreAdmissions();
    }
  });

test("Callback revalidates provider state and projection references",
  async () => {
    const suite = getAuthdTestSuite();
    await suite.provider.clearEvidence();
    const disabled = await beginAuthentication(
      "/atlas/disabled",
      undefined,
      "atlas");
    const disabledCallback = await authorize(
      disabled.authorizationLocation);
    await suite.identitySource.setLoginProviders([
      providerRecord({ state: "disabled", revision: 4 })
    ]);
    try {
      assertNonDisclosingError(
        await requestCallback(
          disabledCallback,
          disabled.stateCookie),
        401);
      await assertNoProviderExchange();
    } finally {
      await restoreProvider();
    }

    await suite.provider.clearEvidence();
    const stale = await beginAuthentication(
      "/atlas/stale",
      undefined,
      "atlas");
    const staleCallback = await authorize(stale.authorizationLocation);
    await suite.identitySource.setLoginProviders([
      providerRecord({ secretVersionId: "authd-oidc-secret-v2", revision: 5 })
    ]);
    try {
      assertNonDisclosingError(
        await requestCallback(staleCallback, stale.stateCookie),
        503);
      await assertNoProviderExchange();
    } finally {
      await restoreProvider();
    }
  });

async function requestBegin(workspaceId: string) {
  const body = new URLSearchParams({
    tenant_id: "acme",
    workspace_id: workspaceId,
    provider_id: "oidc"
  }).toString();
  return requestAuthd({
    method: "POST",
    path: "/auth/v1/begin",
    headers: browserPostHeaders(body),
    body
  });
}

async function authorize(location: string): Promise<URL> {
  const suite = getAuthdTestSuite();
  const response = await suite.provider.authorize(location);
  assert.equal(response.statusCode, 303);
  return new URL(response.location);
}

async function requestCallback(
  callback: URL,
  stateCookie: string
) {
  return requestAuthd({
    method: "GET",
    path: `${callback.pathname}${callback.search}`,
    headers: [
      ["Host", "auth.example.test"],
      ["Cookie", stateCookie]
    ]
  });
}

async function assertNoProviderExchange(): Promise<void> {
  const evidence = await getAuthdTestSuite().provider.readEvidence();
  assert.equal(evidence.tokens.length, 0);
  assert.equal(evidence.userInfo.length, 0);
}

async function restoreProvider(): Promise<void> {
  await getAuthdTestSuite().identitySource.setLoginProviders([
    providerRecord()
  ]);
}

async function restoreAdmissions(): Promise<void> {
  await getAuthdTestSuite().identitySource
    .setWorkspaceLoginProviderAdmissions([atlasAdmission]);
}

function providerRecord(
  overrides: Partial<LoginProvider> = {}
): LoginProvider {
  return {
    ...providerRegistrationFixture,
    displayName: "Acme workforce",
    state: "active",
    revision: 1,
    ...overrides
  };
}

function dummyProvider(index: number): LoginProvider {
  const suffix = String(index).padStart(3, "0");
  return {
    tenantId: "acme",
    providerId: `a${suffix}`,
    displayName: `Provider ${suffix}`,
    configurationId: `config-${suffix}`,
    configurationVersionId: `config-${suffix}-v1`,
    secretId: `secret-${suffix}`,
    secretVersionId: `secret-${suffix}-v1`,
    state: "active",
    revision: 1
  };
}
