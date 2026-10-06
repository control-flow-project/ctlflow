import type { AgentView, FleetView, PolicyView, SessionView } from '@ctlflow/crossfire-contracts/schema/response';

export type ManagementView = {
  route: string;
  title: string;
  sections: readonly string[];
  navigation?: { label: string; current: string; items: readonly string[] };
};
export const managementViewports = [{ width: 1440, height: 1000 }, { width: 390, height: 844 }] as const;

export function managementViews(viewer: SessionView, policy: PolicyView, agents: readonly AgentView[], fleets: readonly FleetView[]): ManagementView[] {
  const views: ManagementView[] = [
    { route: '/manage/agents', title: 'Agents', sections: [] },
    { route: '/manage/fleets', title: 'Fleets', sections: [] },
    { route: '/manage/wake-ups', title: 'Wake-ups', sections: [] },
    { route: '/manage/wake-ups/new', title: 'New Wake-up', sections: ['Schedule & message'] },
    { route: '/manage/connect', title: 'Set up an agent', sections: ['Paste this into your coding assistant', 'Approve the enrollment', 'Choose where your agent works'] },
    { route: '/manage/enrollments', title: 'Enrollment requests', sections: [] },
    { route: '/manage/audit', title: 'Activity', sections: [] },
  ];
  if (viewer.permissions.includes('publication.read.owned') || viewer.permissions.includes('publication.read.any')) {
    views.push({ route: '/manage/reports', title: 'Reports', sections: [] });
  }
  if (viewer.member.roleCode === 'administrator') {
    views.push({ route: '/manage/members', title: 'Members', sections: [] },
      { route: '/manage/policy', title: 'Instance settings', sections: ['Signup & invitations', 'Agent capacity', 'Message delivery', 'Fleet idle sleep'] });
  }
  if (viewer.member.roleCode === 'administrator' || policy.invitationIssuers === 'members') {
    views.push({ route: '/manage/invitations', title: 'Invitations', sections: ['Create an invitation', 'Issued invitations'] });
  }
  for (const fleet of fleets) {
    const base = '/manage/fleets/' + fleet.fleetId, items = ['Agents', 'Map', 'Sessions', 'Activity', 'Settings'];
    for (const view of [
      { suffix: '', title: 'Fleet details', current: 'Agents', sections: ['Agents'] },
      { suffix: '/map', title: 'Fleet map', current: 'Map', sections: [] },
      { suffix: '/sessions', title: 'Fleet details', current: 'Sessions', sections: ['Fleet sessions'] },
      { suffix: '/activity', title: 'Fleet details', current: 'Activity', sections: ['Fleet delivery', 'Send a message', 'Fleet messages'] },
      { suffix: '/activity?view=traffic', title: 'Fleet details', current: 'Activity', sections: ['Traffic', 'Agents', 'Sender → recipient', 'Native usage'] },
      { suffix: '/settings', title: 'Fleet details', current: 'Settings', sections: ['Display name', 'Controller and identity'] },
    ]) views.push({ route: base + view.suffix, title: view.title, sections: view.sections, navigation: { label: 'Fleet views', current: view.current, items } });
  }
  const agent = agents[0];
  if (agent) {
    const base = '/manage/agents/' + agent.agentId, items = ['Rooms', 'Session', 'Activity', 'Settings'];
    for (const view of [
      { suffix: '', current: 'Rooms', sections: ['Rooms & access', 'Who can wake this agent?'] },
      { suffix: '/session', current: 'Session', sections: ['Decisions', 'Agent session', 'Runtime settings'] },
      { suffix: '/activity', current: 'Activity', sections: ['Listener activity'] },
      { suffix: '/settings', current: 'Settings', sections: ['Listener software', 'Display name', 'Account access', 'Identity'] },
    ]) views.push({ route: base + view.suffix, title: 'Agent details', sections: view.sections, navigation: { label: 'Agent sections', current: view.current, items } });
    if (agent.allowedActions.includes('configure') && agent.status !== 'revoked') {
      views.push({ route: base + '/wake', title: 'Who can wake this agent?', sections: ['Wake audience'] });
    }
  }
  return views;
}
