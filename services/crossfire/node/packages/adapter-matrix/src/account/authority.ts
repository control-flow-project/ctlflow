import { createHmac, createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { failure, success, type Result } from "@ctlflow/crossfire-kernel/result";
import { object, text, userId } from "@ctlflow/crossfire-contracts/validation";
import { API, segment } from '@ctlflow/crossfire-contracts/matrix';
import { nativeOk, nativeRequest, type Native } from "../http.js";
export type Config = { matrixOrigin: string; serverName: string; jwtSecret: string; registrationSecret: string; serviceMatrixId: string };
import { account, type Account } from "@ctlflow/crossfire-contracts/client";

export type Credentials = Account;
export type Authority = ReturnType<typeof authority>;

function credentials(value: unknown, expected: string): Result<Credentials> {
  const parsed = object(value);
  if (!parsed.ok) return parsed;
  const input = parsed.value;
  const result = account({ user_id: input.user_id, access_token: input.access_token, device_id: input.device_id });
  if (input.user_id !== expected || !result.ok) {
    return failure("native", "Unexpected native account credentials");
  }
  return result;
}

export function authority(config: Config) {
  const lifetime = new AbortController();
  const server: Native = { base: config.matrixOrigin, signal: lifetime.signal };
  const sessions = new Map<string, string>();
  const operations = new Map<string, Promise<void>>();
  async function exclusive<T>(id: string, operation: () => Promise<Result<T>>): Promise<Result<T>> {
    const previous = operations.get(id) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    operations.set(id, current);
    await previous;
    try {
      if (lifetime.signal.aborted) return failure("native", "Native authority stopped");
      return await operation();
    }
    finally {
      release();
      if (operations.get(id) === current) operations.delete(id);
    }
  }
  async function asUser(id: string): Promise<Result<Native>> {
    if (!userId(id) || !id.endsWith(":" + config.serverName)) return failure("invalid", "Invalid local control identity");
    const cached = sessions.get(id);
    if (cached) {
      const checked = await nativeRequest({ ...server, token: cached }, "GET", API + "/account/whoami");
      if (!checked.ok) return checked;
      if (checked.value.status === 200 && checked.value.body.user_id === id) return success({ ...server, token: cached });
      if (checked.value.status !== 401) return failure("native", "Native control identity could not be verified");
      sessions.delete(id);
    }
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const unsigned = encode({ alg: "HS256", typ: "JWT" }) + "." + encode({ sub: id, exp: Math.floor(Date.now() / 1000) + 60 });
    const jwt = unsigned + "." + createHmac("sha256", config.jwtSecret).update(unsigned).digest("base64url");
    const response = await nativeOk(server, "POST", API + "/login", {
      type: "m.login.token", token: jwt, device_id: "CROSSFIRE_MANAGEMENT", initial_device_display_name: "crossfire management",
    });
    if (!response.ok) return response;
    const result = credentials(response.value, id);
    if (!result.ok) return result;
    sessions.set(id, result.value.access_token);
    return success({ ...server, token: result.value.access_token });
  }

  async function identify(token: string): Promise<Result<string>> {
    const response = await nativeRequest({ ...server, token }, "GET", API + "/account/whoami");
    if (!response.ok) return response;
    if (response.value.status !== 200 || !userId(response.value.body.user_id)
      || !response.value.body.user_id.endsWith(":" + config.serverName)) return failure("unauthorized", "Invalid native identity");
    return success(response.value.body.user_id);
  }

  async function profileName(id: string): Promise<Result<string | null>> {
    if (!userId(id)) return failure("invalid", "Invalid native profile identity");
    const response = await nativeOk(server, "GET", API + "/profile/" + segment(id) + "/displayname");
    if (!response.ok) return response;
    const name = response.value.displayname;
    return name === undefined || name === null ? success(null) : text(name, 255)
      ? success(name) : failure("native", "Invalid native profile display name");
  }

  async function register(id: string, password: string, device: string): Promise<Result<Credentials>> {
    if (!userId(id) || !id.endsWith(":" + config.serverName) || !text(password, 1024) || !text(device, 100)) {
      return failure("invalid", "Invalid native account provisioning input");
    }
    const input = { username: id.slice(1, id.indexOf(":")), password, device_id: device, inhibit_login: false };
    let response = await nativeRequest(server, "POST", API + "/register", input);
    for (let attempt = 0; response.ok && response.value.status === 401 && attempt < 4; attempt++) {
      const challenge = response.value.body;
      if (!text(challenge.session, 255) || !Array.isArray(challenge.flows)) return failure("native", "Invalid native registration challenge");
      const completed = Array.isArray(challenge.completed) ? challenge.completed : [];
      const stages = challenge.flows.flatMap(flow => {
        const parsed = object(flow);
        return parsed.ok && Array.isArray(parsed.value.stages) ? parsed.value.stages : [];
      });
      const stage = stages.find(value => !completed.some(item => item === value));
      if (stage !== "m.login.registration_token" && stage !== "m.login.dummy") return failure("native", "Unsupported native registration challenge");
      response = await nativeRequest(server, "POST", API + "/register", {
        ...input, auth: { type: stage, session: challenge.session,
          ...(stage === "m.login.registration_token" ? { token: config.registrationSecret } : {}) },
      });
    }
    if (!response.ok) return response;
    if (response.value.status === 400 && response.value.body.errcode === "M_USER_IN_USE") {
      response = await nativeRequest(server, "POST", API + "/login", {
        type: "m.login.password", identifier: { type: "m.id.user", user: id }, password, device_id: device,
      });
      if (!response.ok) return response;
    }
    if (response.value.status !== 200) return failure("native", "Account provisioning is not complete");
    return credentials(response.value.body, id);
  }

  async function deactivated(id: string): Promise<Result<boolean>> {
    const result = await nativeRequest(server, "POST", API + "/login", {
      type: "m.login.password", identifier: { type: "m.id.user", user: id }, password: "crossfire-deactivation-probe",
    });
    if (!result.ok) return result;
    if (result.value.status === 403 && result.value.body.errcode === "M_USER_DEACTIVATED") return success(true);
    if (result.value.status === 403 && result.value.body.errcode === "M_FORBIDDEN") return success(false);
    if (result.value.status === 200) {
      const authenticated = credentials(result.value.body, id);
      if (!authenticated.ok) return authenticated;
      const loggedOut = await nativeOk({ ...server, token: authenticated.value.access_token }, "POST", API + "/logout", {});
      return loggedOut.ok ? success(false) : loggedOut;
    }
    return failure("native", "Native account deactivation could not be verified");
  }

  async function exists(id: string): Promise<Result<boolean>> {
    const result = await nativeRequest(server, "GET", API + "/register/available?username=" + segment(id.slice(1, id.indexOf(":"))));
    if (!result.ok) return result;
    if (result.value.status === 200 && result.value.body.available === true) return success(false);
    if (result.value.status === 400 && result.value.body.errcode === "M_USER_IN_USE") return success(true);
    return failure("native", "Native account existence could not be verified");
  }

  async function remove(id: string): Promise<Result<void>> {
    if (!userId(id) || !id.endsWith(":" + config.serverName) || id === config.serviceMatrixId || id === "@conduit:" + config.serverName) {
      return failure("forbidden", "Protected or invalid native account");
    }
    const checked = await deactivated(id);
    if (!checked.ok) return checked;
    if (checked.value) return success(undefined);
    const administrator = await asUser(config.serviceMatrixId);
    if (!administrator.ok) return administrator;
    const room = await nativeOk(administrator.value, "GET", API + "/directory/room/" + segment("#admins:" + config.serverName));
    if (!room.ok) return room;
    if (!text(room.value.room_id, 255)) return failure("native", "Native administration room is unavailable");
    const transaction = createHash("sha256").update("deactivate:" + id).digest("hex");
    const sent = await nativeOk(administrator.value, "PUT", API + "/rooms/" + segment(room.value.room_id) + "/send/m.room.message/" + transaction, {
      msgtype: "m.text", body: "@conduit:" + config.serverName + ": deactivate-user --leave-rooms " + id,
    });
    if (!sent.ok) return sent;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const confirmed = await deactivated(id);
      if (!confirmed.ok) return confirmed;
      if (confirmed.value) { sessions.delete(id); return success(undefined); }
      try { await delay(200, undefined, { signal: lifetime.signal }); }
      catch { return failure("native", "Native authority stopped before deactivation was confirmed"); }
    }
    return failure("native", "Native account deactivation remains unconfirmed");
  }
  const provision = (id: string, password: string, device = "CROSSFIRE_AGENT") => exclusive(id, () => register(id, password, device));
  const deactivate = (id: string) => exclusive(id, () => remove(id));
  const discard = (id: string) => exclusive(id, async () => {
    const present = await exists(id);
    return present.ok ? present.value ? remove(id) : success(undefined) : present;
  });
  function close(): void {
    lifetime.abort(new Error("Crossfire native authority stopped"));
    sessions.clear();
  }
  return { asUser, identify, profileName, provision, deactivate, discard, exists, close };
}
