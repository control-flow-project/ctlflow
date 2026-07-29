import {
  setTimeout as delay
} from "node:timers/promises";
import {
  requestEdged
} from "./request-edged.js";
import {
  sessionCookie
} from "./session-cookie.js";

export async function waitForIdentityRecovery(
  credential: string
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const response = await requestEdged({
      headers: [["Cookie", sessionCookie(credential)]]
    });
    if (response.statusCode === 200) {
      return;
    }
    await delay(100);
  }
  throw new Error("Edged did not recover its Identityd channel");
}
