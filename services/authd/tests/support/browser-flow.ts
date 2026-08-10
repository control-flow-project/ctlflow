import {
  setTimeout as delay
} from "node:timers/promises";
import {
  getAuthdTestSuite
} from "../suite/get-authd-test-suite.js";
import {
  readHeader,
  readHeaders,
  requestAuthd,
  type AuthdHttpResponse
} from "./request-authd.js";

const host = "auth.example.test";
const origin = "https://auth.example.test";

export interface BegunAuthentication {
  readonly response: AuthdHttpResponse;
  readonly authorizationLocation: string;
  readonly stateCookie: string;
}

export interface CompletedAuthentication {
  readonly begin: BegunAuthentication;
  readonly providerLocation: string;
  readonly callback: AuthdHttpResponse;
}

export async function beginAuthentication(
  returnTo?: string,
  stateCookie?: string,
  workspaceId?: string
): Promise<BegunAuthentication> {
  const parameters = new URLSearchParams({
    tenant_id: "acme",
    provider_id: "oidc"
  });
  if (returnTo !== undefined) {
    parameters.set("return_to", returnTo);
  }
  if (workspaceId !== undefined) {
    parameters.set("workspace_id", workspaceId);
  }
  const body = parameters.toString();
  let response: AuthdHttpResponse;
  for (;;) {
    response = await requestAuthd({
      method: "POST",
      path: "/auth/v1/begin",
      headers: [
        ["Host", host],
        ["Origin", origin],
        ["Content-Type", "application/x-www-form-urlencoded"],
        ["Content-Length", String(Buffer.byteLength(body))],
        ...(stateCookie === undefined
          ? []
          : [["Cookie", stateCookie] as const])
      ],
      body
    });
    if (response.statusCode !== 429) {
      break;
    }
    await delay(550);
  }
  if (response.statusCode !== 303) {
    throw new Error(
      `Begin failed with ${String(response.statusCode)}`);
  }
  const authorizationLocation = readHeader(response, "location");
  const state = readHeaders(response, "set-cookie")
    .find((value) =>
      value.startsWith("__Host-ctlflow-auth-state="));
  if (authorizationLocation === undefined || state === undefined) {
    throw new Error("Begin response is missing redirect state");
  }
  return {
    response,
    authorizationLocation,
    stateCookie: state.split(";", 1)[0]!
  };
}

export async function completeAuthentication(
  returnTo?: string,
  existingSessionCookie?: string,
  workspaceId?: string
): Promise<CompletedAuthentication> {
  const suite = getAuthdTestSuite();
  const begin = await beginAuthentication(
    returnTo,
    undefined,
    workspaceId);
  const authorization = await suite.provider.authorize(
    begin.authorizationLocation);
  if (authorization.statusCode !== 303
      || authorization.location.length === 0) {
    throw new Error("Controlled provider did not redirect");
  }
  const providerLocation = authorization.location;
  const callbackUrl = new URL(providerLocation);
  const callback = await requestAuthd({
    method: "GET",
    path: `${callbackUrl.pathname}${callbackUrl.search}`,
    headers: [
      ["Host", host],
      [
        "Cookie",
        existingSessionCookie === undefined
          ? begin.stateCookie
          : `${begin.stateCookie}; ${existingSessionCookie}`
      ]
    ]
  });
  return { begin, providerLocation, callback };
}

export function sessionCookie(
  response: AuthdHttpResponse
): string | undefined {
  const value = readHeaders(response, "set-cookie")
    .find((cookie) =>
      cookie.startsWith("__Host-ctlflow-session="));
  return value?.split(";", 1)[0];
}

export function stateCookie(
  response: AuthdHttpResponse
): string | undefined {
  const value = readHeaders(response, "set-cookie")
    .find((cookie) =>
      cookie.startsWith("__Host-ctlflow-auth-state="));
  return value?.split(";", 1)[0];
}

export function browserPostHeaders(
  body: string,
  cookie?: string
): readonly (readonly [string, string])[] {
  return [
    ["Host", host],
    ["Origin", origin],
    ["Content-Type", "application/x-www-form-urlencoded"],
    ["Content-Length", String(Buffer.byteLength(body))],
    ...(cookie === undefined
      ? []
      : [["Cookie", cookie] as const])
  ];
}
