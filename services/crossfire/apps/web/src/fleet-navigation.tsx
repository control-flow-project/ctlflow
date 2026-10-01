export function FleetNavigation({ id, map = false }: { id: string; map?: boolean }) {
  const base = '/manage/fleets/' + id;
  return <nav className="setup-tabs" aria-label="Fleet views">
    <a href={base} aria-current={!map ? 'page' : undefined}>Overview</a>
    <a href={base + '/map'} aria-current={map ? 'page' : undefined}>Connection map</a>
  </nav>;
}
