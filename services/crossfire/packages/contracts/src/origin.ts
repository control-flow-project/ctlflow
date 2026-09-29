import { failure, success, type Result } from '@crossfire/kernel/result';
export function endpoint(value: string): Result<string> {
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/"
      || (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["127.0.0.1", "[::1]", "localhost"].includes(parsed.hostname)))) {
      return failure("invalid", "Use HTTPS or a loopback HTTP origin without credentials");
    }
    return success(parsed.origin);
  } catch {
    return failure("invalid", "Invalid server origin");
  }
}
