import { useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { WAKE_POLICIES, WAKE_LABELS, wakePolicy } from '@ctlflow/crossfire-contracts/wake';
import type { AgentView } from '@ctlflow/crossfire-contracts/schema/response';
import type { OutputOf } from '@ctlflow/crossfire-contracts/rest/operation';
import { call, operations, useAction, useResource } from './api.js';
import { useSession } from './session.js';
import { useEditable, EditConflict } from './use-editable.js';
import { Alert, Field, Help, Loaded, Panel } from './ui.js';
import { Dialog } from './dialog.js';
import { WakePicker, WakeSenderTable, type WakeSenders } from './wake-picker.js';

type Policy = OutputOf<typeof operations.wakePolicy>;
function WakeEditor({ agent, initial, onCancel, onSaved, onRefresh }: { agent: AgentView; initial: Policy; onCancel(): void; onSaved(): void; onRefresh(): void }) {
  const viewer = useSession(), action = useAction();
  const searchFocus = useRef<HTMLInputElement>(null);
  const edit = useEditable(agent.agentId + '/wake', initial.revision, { mode: initial.mode, senders: initial.senders });
  const { mode, senders } = edit.value;
  const setSenders: Dispatch<SetStateAction<WakeSenders>> = change => edit.setValue(previous => ({ ...previous,
    senders: typeof change === 'function' ? change(previous.senders) : change }));
  const disabled = !agent.allowedActions.includes('configure') || agent.status === 'revoked';
  async function save() {
    if (edit.conflict || disabled) return;
    await action.run(async () => {
      const result = await call(operations.changeWakePolicy, { agentId: agent.agentId }, { expectedRevision: edit.version, mode,
        senders: mode === 'everyone' ? [] : senders.map(sender => ({ principalId: sender.identity.principalId, includeAgents: sender.includeAgents })) }, viewer.csrfSecret);
      if (!result.ok && result.error.code === 'conflict') onRefresh();
      return result;
    }, onSaved);
  }
  return <Dialog title="Who can wake this agent?" description="Choose people, their agents, or a broader audience. This changes wake authority, not room access."
    busy={action.pending} initialFocus={searchFocus} onCancel={onCancel} footer={<><span className="support">{mode === 'everyone' ? 'All active identities' : senders.length + ' selected entries'}</span>
      <div className="actions"><button type="button" disabled={action.pending} onClick={onCancel}>Cancel</button><button type="submit" form="wake-editor" className="primary" disabled={disabled || action.pending || !edit.changed || edit.conflict}>{action.pending ? 'Saving…' : 'Save wake-up policy'}</button></div></>}>
    <form id="wake-editor" onSubmit={event => { event.preventDefault(); void save(); }}><fieldset disabled={disabled || action.pending}>
      <Field label="Audience">{id => <select id={id} value={mode} onChange={event => { const next = event.target.value; if (wakePolicy(next)) edit.setValue(previous => ({ ...previous, mode: next })); }}>
        {WAKE_POLICIES.map(policy => <option key={policy} value={policy}>{WAKE_LABELS[policy]}</option>)}</select>}</Field>
      {mode !== 'everyone' ? <><p className="support">{mode === 'humans' ? 'All active people can wake this agent. Add any extra agents or ownership groups below.' : 'Only the selected entries can wake this agent. The owner is not an implicit exception.'}</p>
        <WakePicker agentId={agent.agentId} senders={senders} setSenders={setSenders} searchRef={searchFocus}/></> : <p className="support">Every active registered person and agent can trigger chat delivery. The receiving agent always excludes itself.</p>}
      <EditConflict {...edit}/><Alert>{edit.changed && !edit.conflict ? action.error : ''}</Alert>
    </fieldset></form>
  </Dialog>;
}

function WakeView({ agent, initial, refresh }: { agent: AgentView; initial: Policy; refresh(): void }) {
  const [editing, setEditing] = useState(false), disabled = !agent.allowedActions.includes('configure') || agent.status === 'revoked';
  return <><div className="wake-policy-summary"><div><strong>{WAKE_LABELS[initial.mode]}</strong><p className="support">{initial.mode === 'selected' ? 'Only these entries trigger delivery.' : initial.mode === 'humans' ? 'All active people, plus the selections below.' : 'All active registered people and agents.'}</p></div>
    <button type="button" disabled={disabled} onClick={() => setEditing(true)}>Choose who can wake</button></div>
    {initial.mode !== 'everyone' && <WakeSenderTable senders={initial.senders}/>}
    <Help title="How wake authority works"><p>Selected people can include their currently owned agents. Entries combine; the owner is allowed only when included. Inactive accounts cannot wake an agent.</p>
      <p>Room membership, reply permissions and muted delivery remain separate. An allowed message delivers pending context together; other chat waits. Scheduled Wake-ups and exact approval decisions are independent.</p>
      <p>Explicitly addressed, blocked messages receive a short owner-named notice at most once per sender every ten minutes. Eligible human mentions can interrupt; agent messages cannot.</p></Help>
    {editing && <WakeEditor agent={agent} initial={initial} onRefresh={refresh} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); refresh(); }}/>}</>;
}

export function AgentWake({ agent }: { agent: AgentView }) {
  const resource = useResource(operations.wakePolicy, { agentId: agent.agentId });
  return <Panel title="Who can wake this agent?" description="Choose who triggers automatic delivery. Other messages wait as context.">
    <Loaded {...resource} retry={resource.refresh}>{result => <WakeView agent={agent} initial={result.data} refresh={resource.refresh}/>}</Loaded>
  </Panel>;
}
