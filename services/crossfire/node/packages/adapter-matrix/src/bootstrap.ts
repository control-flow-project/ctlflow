import { serviceUser as identity, type MatrixConfiguration } from './config.js';
type Config = MatrixConfiguration & { instance: string; administrator: string };
const serviceUser = (config: Config) => identity(config.instance, config);
import { authority } from "./account/authority.js";
import { API, segment } from './protocol.js';
import { nativeOk } from './http.js';
import { failure, success, type Result } from "@ctlflow/crossfire-kernel/result";
import { fields, text } from "@ctlflow/crossfire-contracts/validation";

export type Bootstrap = { servicePassword: string; administratorPassword: string };

export function bootstrapSecrets(value: unknown): Result<Bootstrap> {
  const input = fields(value, ["servicePassword", "administratorPassword"]);
  if (!input.ok) return input;
  if (!text(input.value.servicePassword, 1024) || input.value.servicePassword.length < 32
    || !text(input.value.administratorPassword, 1024) || input.value.administratorPassword.length < 12) {
    return failure("invalid", "Invalid private bootstrap credentials");
  }
  return success(input.value as Bootstrap);
}

export async function bootstrap(config: Config, secrets: Bootstrap): Promise<Result<void>> {
  const native = authority({ ...config, serviceBackendUserId: serviceUser(config) });
  try {
  const service = await native.provision(serviceUser(config), secrets.servicePassword, "CROSSFIRE_CONTROL");
  if (!service.ok) return service;
  const serviceClient = { base: config.matrixOrigin, token: service.value.access_token };
  const directory = await nativeOk(serviceClient, "GET", API + "/directory/room/" + segment("#admins:" + config.serverName));
  if (!directory.ok) return directory;
  if (typeof directory.value.room_id !== "string") return failure("native", "Native administrator room is missing");
  const room = API + "/rooms/" + segment(directory.value.room_id);
  const members = await nativeOk(serviceClient, "GET", room + "/joined_members");
  if (!members.ok) return members;
  const joined = members.value.joined;
  if (!joined || typeof joined !== "object" || Array.isArray(joined) || !(serviceUser(config) in joined)) {
    return failure("native", "The private service identity must be the first native administrator; refusing adoption of another homeserver");
  }
  const present = await native.exists(config.administrator);
  if (!present.ok) return present;
  if (!present.value) {
    const administrator = await native.provision(config.administrator, secrets.administratorPassword, "CROSSFIRE_HUMAN");
    if (!administrator.ok) return administrator;
  }
  return success(undefined);
  } finally { native.close(); }
}
