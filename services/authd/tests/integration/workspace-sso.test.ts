import assert from "node:assert/strict";
import {
  Metadata,
  status,
  type ServiceError
} from "@grpc/grpc-js";
import {
  test
} from "node:test";
import type {
  LoginProvider,
  WorkspaceLoginProviderAdmission
} from "@ctlflow/identityd/testing/production";
import type {
  TenancySnapshot,
  TenantdResourceState
} from "@ctlflow/tenantd/testing/production";
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
  readHeaders,
  requestAuthd
} from "../support/request-authd.js";
import {
  createTenantClient
} from "../support/tenancy/create-tenant-client.js";

const atlasAdmission: WorkspaceLoginProviderAdmission = {
  tenantId: "acme",
  workspaceId: "atlas",
  providerId: "oidc"
};

const activeTenancy: TenancySnapshot = {
  tenants: [{
    tenantId: "acme",
    address: "acme",
    displayName: "Acme",
    state: "active",
    revision: 1
  }],
  workspaces: [{
    workspaceId: "atlas",
    tenantId: "acme",
    address: "atlas",
    displayName: "Atlas",
    state: "active",
    revision: 1
  }]
};

test("does not admit Authd to Tenantd address resolution", async () => {
  const suite = getAuthdTestSuite();
  const client = await createTenantClient(suite.tenantd);
  const metadata = new Metadata();
  metadata.set(
    "authorization",
    `Bearer ${suite.authdWorkload.callerToken}`);
  try {
    await assert.rejects(
      new Promise<void>((resolve, reject) => {
        client.resolveTenant(
          { address: "acme" },
          metadata,
          (error) => {
            if (error === null) {
              resolve();
            } else {
              reject(error);
            }
          });
      }),
      (error: unknown): boolean =>
        typeof error === "object"
        && error !== null
        && "code" in error
        && (error as ServiceError).code === status.PERMISSION_DENIED);
  } finally {
    client.close();
  }
});

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

test("Begin requires active Tenant and Workspace lifecycle", async () => {
  const suite = getAuthdTestSuite();
  await suite.provider.clearEvidence();
  try {
    await suite.tenantd.replaceTenancy({
      tenants: [],
      workspaces: []
    });
    assertNonDisclosingError(await requestBegin(), 400);

    await suite.tenantd.replaceTenancy({
      tenants: activeTenancy.tenants,
      workspaces: []
    });
    assertNonDisclosingError(await requestBegin("atlas"), 400);

    for (const state of ["suspended", "deleted"] as const) {
      await suite.tenantd.replaceTenancy({
        tenants: [{ ...activeTenancy.tenants[0]!, state, revision: 2 }],
        workspaces: []
      });
      assertNonDisclosingError(
        await requestBegin(),
        400);
    }

    for (const state of ["suspended", "deleted"] as const) {
      await suite.tenantd.replaceTenancy(
        tenancyWithWorkspaceState(state));
      assertNonDisclosingError(await requestBegin("atlas"), 400);
    }

    await suite.tenantd.replaceTenancy({
      tenants: [
        activeTenancy.tenants[0]!,
        {
          tenantId: "beta",
          address: "beta",
          displayName: "Beta",
          state: "active",
          revision: 1
        }
      ],
      workspaces: [{
        ...activeTenancy.workspaces[0]!,
        tenantId: "beta",
        revision: 2
      }]
    });
    assertNonDisclosingError(await requestBegin("atlas"), 400);
    await assertNoProviderExchange();
  } finally {
    await restoreTenancy();
  }
});

test("Begin fails closed while Tenantd is unavailable", async () => {
  const suite = getAuthdTestSuite();
  await suite.tenantd.setMode("unavailable");
  try {
    assertNonDisclosingError(await requestBegin("atlas"), 503);
  } finally {
    await suite.tenantd.setMode("available");
    await suite.authd.restart();
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

test("Callback revalidates Tenantd lifecycle before Egressd", async () => {
  const suite = getAuthdTestSuite();
  for (const [name, tenancy] of invalidCallbackTenancies()) {
    await restoreTenancy();
    await suite.provider.clearEvidence();
    try {
      const pending = await beginAuthentication(
        `/atlas/${name}`,
        undefined,
        "atlas");
      const callback = await authorize(pending.authorizationLocation);
      await suite.tenantd.replaceTenancy(tenancy);
      const response = await requestCallback(callback, pending.stateCookie);
      assert.equal(response.statusCode, 401, name);
      assertNonDisclosingError(response, 401);
      assert.equal(
        readHeaders(response, "set-cookie").some((value) =>
          value.startsWith("__Host-ctlflow-session=")),
        false,
        `${name} must not create a Session cookie`);
      await assertNoProviderExchange();
    } finally {
      await restoreTenancy();
    }
  }
});

test("Callback fails closed while Tenantd is unavailable before Egressd",
  async () => {
    const suite = getAuthdTestSuite();
    await suite.provider.clearEvidence();
    const pending = await beginAuthentication(
      "/atlas/unavailable",
      undefined,
      "atlas");
    const callback = await authorize(pending.authorizationLocation);
    await suite.tenantd.setMode("unavailable");
    try {
      assertNonDisclosingError(
        await requestCallback(callback, pending.stateCookie),
        503);
      await assertNoProviderExchange();
    } finally {
      await suite.tenantd.setMode("available");
      await suite.authd.restart();
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

async function requestBegin(workspaceId?: string) {
  const parameters = new URLSearchParams({
    tenant_id: "acme",
    provider_id: "oidc"
  });
  if (workspaceId !== undefined) {
    parameters.set("workspace_id", workspaceId);
  }
  const body = parameters.toString();
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

async function restoreTenancy(): Promise<void> {
  await getAuthdTestSuite().tenantd.replaceTenancy(activeTenancy);
}

function tenancyWithWorkspaceState(
  state: TenantdResourceState
): TenancySnapshot {
  return {
    tenants: activeTenancy.tenants,
    workspaces: [{
      ...activeTenancy.workspaces[0]!,
      state,
      revision: 2
    }]
  };
}

function invalidCallbackTenancies(
): readonly (readonly [string, TenancySnapshot])[] {
  return [
    ["missing-tenant", { tenants: [], workspaces: [] }],
    ["suspended-tenant", {
      tenants: [{
        ...activeTenancy.tenants[0]!,
        state: "suspended",
        revision: 2
      }],
      workspaces: []
    }],
    ["deleted-tenant", {
      tenants: [{
        ...activeTenancy.tenants[0]!,
        state: "deleted",
        revision: 2
      }],
      workspaces: []
    }],
    ["missing-workspace", {
      tenants: activeTenancy.tenants,
      workspaces: []
    }],
    ["foreign-workspace", {
      tenants: [
        activeTenancy.tenants[0]!,
        {
          tenantId: "beta",
          address: "beta",
          displayName: "Beta",
          state: "active",
          revision: 1
        }
      ],
      workspaces: [{
        ...activeTenancy.workspaces[0]!,
        tenantId: "beta",
        revision: 2
      }]
    }],
    ["suspended-workspace", tenancyWithWorkspaceState("suspended")],
    ["deleted-workspace", tenancyWithWorkspaceState("deleted")]
  ];
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
