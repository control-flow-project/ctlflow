export function sessionCookie(credential: string): string {
  return `__Host-ctlflow-session=${credential}`;
}
