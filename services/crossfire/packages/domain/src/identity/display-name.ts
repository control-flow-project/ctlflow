export function agentDisplayName(name: string, ownerName: string, override: string | null): string {
  return override ?? name + ' (' + ownerName + ')';
}
