import { ViewNavigation } from './ui.js';
export type FleetSection = 'agents' | 'sessions' | 'map' | 'activity' | 'settings';
export function FleetNavigation({ id, section }: { id: string; section: FleetSection }) {
  const base = '/manage/fleets/' + id;
  return <ViewNavigation label="Fleet views" items={[
    { label: 'Agents', href: base, current: section === 'agents' },
    { label: 'Map', href: base + '/map', current: section === 'map' },
    { label: 'Sessions', href: base + '/sessions', current: section === 'sessions' },
    { label: 'Activity', href: base + '/activity', current: section === 'activity' },
    { label: 'Settings', href: base + '/settings', current: section === 'settings' },
  ]}/>;
}
