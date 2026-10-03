import { ViewNavigation } from './ui.js';
export type FleetSection = 'agents' | 'map' | 'delivery' | 'messages' | 'rooms' | 'settings' | 'statistics';
export function FleetNavigation({ id, section }: { id: string; section: FleetSection }) {
  const base = '/manage/fleets/' + id;
  return <ViewNavigation label="Fleet views" items={[
    { label: 'Agents', href: base, current: section === 'agents' },
    { label: 'Connection map', href: base + '/map', current: section === 'map' },
    { label: 'Delivery', href: base + '/delivery', current: section === 'delivery' },
    { label: 'Messages', href: base + '/messages', current: section === 'messages' },
    { label: 'Stats', href: base + '/statistics', current: section === 'statistics' },
    { label: 'Room plan', href: base + '/rooms', current: section === 'rooms' },
    { label: 'Settings', href: base + '/settings', current: section === 'settings' },
  ]}/>;
}
