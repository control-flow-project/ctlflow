export function validateHost(host: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*(?:@[a-zA-Z0-9][a-zA-Z0-9_.-]*)?$/u.test(host)) throw new Error('Use an SSH hostname or user@hostname from your SSH configuration');
}
