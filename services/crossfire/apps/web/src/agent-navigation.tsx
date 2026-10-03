import { ViewNavigation } from './ui.js';
export type AgentSection = 'rooms' | 'wake' | 'activity' | 'runtime' | 'decisions' | 'software' | 'settings';
export function AgentNavigation({ id, section }: { id: string; section: AgentSection }) {
  const base = '/manage/agents/' + id;
  return <ViewNavigation label="Agent sections" items={[
    { label: 'Rooms', href: base, current: section === 'rooms' },
    { label: 'Wake-up rules', href: base + '/wake', current: section === 'wake' },
    { label: 'Activity', href: base + '/activity', current: section === 'activity' },
    { label: 'Runtime', href: base + '/runtime', current: section === 'runtime' },
    { label: 'Decisions', href: base + '/decisions', current: section === 'decisions' },
    { label: 'Software', href: base + '/software', current: section === 'software' },
    { label: 'Settings', href: base + '/settings', current: section === 'settings' },
  ]}/>;
}
