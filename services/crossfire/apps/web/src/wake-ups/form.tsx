import { useState } from 'react';
import type { WakeRuleDetails, WakeSchedule } from '@ctlflow/crossfire-contracts/wake-up';
import { useSession } from '../session.js';
import { call, operations, useAction } from '../api.js';
import { Alert, Field, Panel, Help } from '../ui.js';
import { ScheduleEditor } from './schedule.js';
import { WakeTargets } from './targets.js';
import { useEditable, EditConflict } from '../use-editable.js';

export function WakeForm({ rule }: { rule?: WakeRuleDetails }) {
  const viewer = useSession(), action = useAction();
  const [ruleId] = useState(rule?.ruleId ?? crypto.randomUUID());
  const edit = useEditable(ruleId, rule?.revision ?? null, { name: rule?.name ?? '', message: rule?.message ?? '',
    schedule: rule?.schedule ?? { kind: 'interval', seconds: 3600 } as WakeSchedule, enabled: rule?.enabled ?? true, agentIds: rule?.agents.map(agent => agent.agentId) ?? [] });
  const { name, message, schedule, enabled, agentIds } = edit.value;
  return <form onSubmit={event => {
    event.preventDefault(); if (edit.conflict) return; const input = { name, message, schedule, enabled, agentIds };
    void action.run(() => rule && edit.version !== null ? call(operations.changeWakeRule, { ruleId }, { ...input, expectedRevision: edit.version }, viewer.csrfSecret)
      : call(operations.createWakeRule, {}, { ruleId, ...input }, viewer.csrfSecret), saved => location.assign('/manage/wake-ups/' + saved.ruleId));
  }}><fieldset disabled={action.pending}><Panel title="Schedule & message"><div className="wake-form-grid"><div className="bounded-form">
    <Field label="Name">{id => <input id={id} required maxLength={100} value={name} onChange={event => edit.setValue(previous => ({ ...previous, name: event.target.value }))}/>}</Field>
    <ScheduleEditor key={edit.version} value={schedule} onChange={schedule => edit.setValue(previous => ({ ...previous, schedule }))}/><label className="check"><input type="checkbox" checked={enabled} onChange={event => edit.setValue(previous => ({ ...previous, enabled: event.target.checked }))}/>Enabled</label>
  </div><div><Field label="Wake-up message">{id => <textarea id={id} required rows={9} value={message} onChange={event => edit.setValue(previous => ({ ...previous, message: event.target.value }))}/>}</Field><p className="support">Delivered by the fleet controller to each assigned agent’s managed conversation. Describe what it should do; this message does not grant extra permissions or resume a manually stopped session.</p></div></div></Panel>
    <WakeTargets selected={agentIds} onChange={agentIds => edit.setValue(previous => ({ ...previous, agentIds }))} attached={rule?.agents ?? []}/>
    <EditConflict {...edit}/><Alert>{action.error}</Alert><div className="actions"><button className="primary" disabled={action.pending || edit.conflict}>{rule ? 'Save Wake-up' : 'Create Wake-up'}</button><a href="/manage/wake-ups">Cancel</a>
    {rule && <button className="danger" type="button" disabled={action.pending || edit.conflict} onClick={() => {
      if (edit.version !== null && confirm('Delete “' + rule.name + '”? This stops future scheduled inputs; already accepted work continues.')) void action.run(() => call(operations.deleteWakeRule,
        { ruleId }, { expectedRevision: edit.version }, viewer.csrfSecret), () => location.assign('/manage/wake-ups'));
    }}>Delete Wake-up</button>}</div></fieldset>
    <Help title="When does a Wake-up run?"><p>Only connected listeners deliver scheduled input. Busy agents wait until idle; missed occurrences coalesce into one wake-up. Owner pauses, account suspension and fleet deactivation stop delivery. Chat wake-up rules, including an empty selected audience, do not block these explicitly configured schedules.</p><p>Calendar times follow the selected time zone. During a one-hour daylight-saving gap, 02:30 runs at 03:30; a repeated local time runs once at its first occurrence.</p><p>Saving changes restarts the next deadline and cancels input not yet accepted. Deleting or disabling a rule cannot undo work already accepted by the model.</p></Help>
  </form>;
}
