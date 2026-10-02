import { useState } from 'react';
import type { WakeSchedule } from '@crossfire/contracts/wake-up';
import { Field } from '../ui.js';

const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const zones = ['UTC', ...Intl.supportedValuesOf('timeZone')];
export function scheduleLabel(schedule: WakeSchedule): string {
  if (schedule.kind === 'interval') {
    for (const [unit, seconds] of [['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]] as const) {
      if (schedule.seconds % seconds === 0) { const count = schedule.seconds / seconds; return `Every ${count} ${unit}${count === 1 ? '' : 's'}`; }
    }
  }
  if (schedule.kind === 'cron') {
    const weekly = /^(\d{1,2}) (\d{1,2}) \* \* ([0-6](?:,[0-6])*)$/u.exec(schedule.expression);
    if (weekly) {
      const selected = weekly[3]!;
      const label = selected === '0,1,2,3,4,5,6' ? 'Every day' : selected === '1,2,3,4,5' ? 'Weekdays' : selected === '0,6' ? 'Weekends'
        : selected.split(',').map(day => days[Number(day)]!.slice(0, 3)).join(', ');
      return label + ' · ' + weekly[2]!.padStart(2, '0') + ':' + weekly[1]!.padStart(2, '0') + ' · ' + schedule.timeZone;
    }
    return schedule.expression + ' · ' + schedule.timeZone;
  }
  return '';
}
export function ScheduleEditor({ value, onChange }: { value: WakeSchedule; onChange: (value: WakeSchedule) => void }) {
  const weekly = value.kind === 'cron' ? /^(\d{1,2}) (\d{1,2}) \* \* ([0-6](?:,[0-6])*)$/u.exec(value.expression) : null;
  const [mode, setMode] = useState<'interval' | 'weekly' | 'cron'>(value.kind === 'interval' ? 'interval' : weekly ? 'weekly' : 'cron');
  const [time, setTime] = useState(weekly ? weekly[2]!.padStart(2, '0') + ':' + weekly[1]!.padStart(2, '0') : '09:00');
  const [weekdays, setWeekdays] = useState<number[]>(weekly ? weekly[3]!.split(',').map(Number) : [1, 2, 3, 4, 5]);
  const [unit, setUnit] = useState(value.kind === 'interval' && value.seconds % 86400 === 0 ? 86400 : value.kind === 'interval' && value.seconds % 3600 === 0 ? 3600 : value.kind === 'interval' && value.seconds % 60 === 0 ? 60 : 1);
  const zone = value.kind === 'cron' ? value.timeZone : Intl.DateTimeFormat().resolvedOptions().timeZone;
  function calendar(selected: number[], at: string, timeZone: string) {
    const [hour, minute] = at.split(':').map(Number);
    onChange({ kind: 'cron', expression: `${minute} ${hour} * * ${[...selected].sort().join(',')}`, timeZone });
  }
  return <div className="schedule-editor"><Field label="Schedule">{id => <select id={id} value={mode} onChange={event => {
    const selected = event.target.value as typeof mode; setMode(selected);
    if (selected === 'interval') { setUnit(3600); onChange({ kind: 'interval', seconds: 3600 }); }
    else if (selected === 'weekly') calendar(weekdays, time, zone);
    else if (value.kind !== 'cron') onChange({ kind: 'cron', expression: '0 9 * * 1-5', timeZone: zone });
  }}><option value="interval">Every interval</option><option value="weekly">Weekdays &amp; time</option><option value="cron">Advanced (cron)</option></select>}</Field>
  {mode === 'interval' && value.kind === 'interval' && <div className="schedule-row"><Field label="Every">{id => <input id={id} type="number" required min={1} max={Math.floor(31_536_000 / unit)} value={value.seconds / unit} onChange={event => onChange({ kind: 'interval', seconds: Number(event.target.value) * unit })}/>}</Field>
    <Field label="Unit">{id => <select id={id} value={unit} onChange={event => { const next = Number(event.target.value); setUnit(next); onChange({ kind: 'interval', seconds: Math.max(1, Math.round(value.seconds / unit)) * next }); }}><option value={1}>Seconds</option><option value={60}>Minutes</option><option value={3600}>Hours</option><option value={86400}>Days</option></select>}</Field></div>}
  {mode === 'weekly' && <><fieldset className="weekday-picker"><legend>Days</legend><div className="actions"><button type="button" onClick={() => { const selected = [0, 1, 2, 3, 4, 5, 6]; setWeekdays(selected); calendar(selected, time, zone); }}>Every day</button><button type="button" onClick={() => { const selected = [1, 2, 3, 4, 5]; setWeekdays(selected); calendar(selected, time, zone); }}>Weekdays</button><button type="button" onClick={() => { const selected = [0, 6]; setWeekdays(selected); calendar(selected, time, zone); }}>Weekends</button></div><div>{days.map((day, index) => <label className="check" key={day}><input type="checkbox" checked={weekdays.includes(index)} onChange={event => {
    const selected = event.target.checked ? [...weekdays, index] : weekdays.filter(day => day !== index); setWeekdays(selected); calendar(selected, time, zone);
  }}/>{day.slice(0, 3)}</label>)}</div></fieldset><Field label="Time">{id => <input id={id} type="time" required value={time} onChange={event => { setTime(event.target.value); calendar(weekdays, event.target.value, zone); }}/>}</Field></>}
  {mode === 'cron' && value.kind === 'cron' && <><Field label="Cron expression">{id => <input id={id} required maxLength={200} spellCheck={false} className="mono" value={value.expression} onChange={event => onChange({ ...value, expression: event.target.value })}/>}</Field>
    <p className="support">Five fields: minute, hour, day of month, month, day of week. Lists, ranges and steps are supported. For example: <code>0 1 * * 0,3,4</code> runs Sunday, Wednesday and Thursday at 01:00.</p></>}
  {value.kind === 'cron' && <Field label="Time zone">{id => <><input id={id} list={id + '-zones'} required maxLength={100} value={value.timeZone} onChange={event => onChange({ ...value, timeZone: event.target.value })}/><datalist id={id + '-zones'}>{zones.map(zone => <option key={zone} value={zone}/>)}</datalist></>}</Field>}
  <p className="support">{mode === 'interval' ? 'The first wake-up is one full interval after saving.' : 'Runs at the selected local times in this time zone.'} Busy or offline agents receive one wake-up when ready, not a backlog.</p>
  {mode === 'weekly' && (weekdays.length > 0 ? <p className="schedule-preview"><strong>Schedule:</strong> {scheduleLabel(value)}</p>
    : <p className="alert" role="alert">Choose at least one day for this schedule.</p>)}</div>;
}
