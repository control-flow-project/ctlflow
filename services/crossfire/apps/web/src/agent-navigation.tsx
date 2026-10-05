import { ViewNavigation } from './ui.js';
export type AgentSection = 'rooms' | 'session' | 'activity' | 'settings';
export function AgentNavigation({ id, section }: { id: string; section: AgentSection }) {
  const base = '/manage/agents/' + id;
  return <ViewNavigation label="Agent sections" items={[
    { label: 'Rooms', href: base, current: section === 'rooms' },
    { label: 'Session', href: base + '/session', current: section === 'session' },
    { label: 'Activity', href: base + '/activity', current: section === 'activity' },
    { label: 'Settings', href: base + '/settings', current: section === 'settings' },
  ]}/>;
}
