import { fields, text, userId } from "@crossfire/contracts/validation";
import { failure, success, type Result } from "@crossfire/kernel/result";
import { endpoint } from '@crossfire/contracts/origin';

export type Config = {
  instance: string; serverName: string; publicOrigin: string; matrixOrigin: string;
  administrator: string; jwtSecret: string; registrationSecret: string;
};

export function serviceUser(config: Config): string {
  return "@crossfire-" + config.instance + ":" + config.serverName;
}

export function config(value: unknown): Result<Config> {
  const parsed = fields(value, ["instance", "serverName", "publicOrigin", "matrixOrigin", "administrator", "jwtSecret", "registrationSecret"]);
  if (!parsed.ok) return parsed;
  const input = parsed.value;
  if (!text(input.instance, 40) || !/^[a-z][a-z0-9-]*$/u.test(input.instance)
    || !text(input.serverName, 200) || !/^[a-z0-9.-]+(?::[0-9]+)?$/u.test(input.serverName)
    || !userId(input.administrator) || !input.administrator.endsWith(":" + input.serverName)
    || !text(input.jwtSecret, 200) || input.jwtSecret.length < 32
    || !text(input.registrationSecret, 200) || input.registrationSecret.length < 32
    || typeof input.publicOrigin !== "string" || typeof input.matrixOrigin !== "string") return failure("invalid", "Invalid server configuration");
  const publicOrigin = endpoint(input.publicOrigin);
  const matrixOrigin = endpoint(input.matrixOrigin);
  if (!publicOrigin.ok) return publicOrigin;
  if (!matrixOrigin.ok) return matrixOrigin;
  return success({ instance: input.instance, serverName: input.serverName, publicOrigin: publicOrigin.value,
    matrixOrigin: matrixOrigin.value, administrator: input.administrator, jwtSecret: input.jwtSecret,
    registrationSecret: input.registrationSecret });
}
