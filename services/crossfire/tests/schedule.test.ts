import assert from 'node:assert/strict';
import test from 'node:test';
import { createScheduleCalculator } from '@crossfire/adapter-schedule/create-calculator';
import { wakeSchedule } from '@crossfire/contracts/wake-up';
import { value } from './support/application.js';

test('one scheduling adapter calculates intervals and the requested weekly calendar schedules', () => {
  const schedule = createScheduleCalculator();
  assert.equal(value(schedule.next({ kind: 'interval', seconds: 30 }, 1000)), 31000);
  assert.equal(new Date(value(schedule.next({ kind: 'cron', expression: '0 22 * * 3', timeZone: 'Asia/Kolkata' }, Date.parse('2026-10-06T18:00:00Z')))).toISOString(), '2026-10-07T16:30:00.000Z');
  let previous = Date.parse('2026-10-05T00:00:00Z');
  const expected = ['2026-10-07T01:00:00.000Z', '2026-10-08T01:00:00.000Z', '2026-10-11T01:00:00.000Z'];
  for (const next of expected) {
    previous = value(schedule.next({ kind: 'cron', expression: '0 1 * * 0,3,4', timeZone: 'UTC' }, previous));
    assert.equal(new Date(previous).toISOString(), next);
  }
  assert.equal(new Date(value(schedule.next({ kind: 'cron', expression: '*/15 8-10 * * MON-THU', timeZone: 'UTC' }, Date.parse('2026-10-05T08:01:00Z')))).toISOString(), '2026-10-05T08:15:00.000Z');
});
test('calendar scheduling advances through daylight-saving gaps once and avoids duplicate repeated-hour wakes', () => {
  const schedule = createScheduleCalculator(), zone = 'America/New_York';
  const spring = value(schedule.next({ kind: 'cron', expression: '30 2 * * *', timeZone: zone }, Date.parse('2026-03-08T06:00:00Z')));
  assert.equal(new Date(spring).toISOString(), '2026-03-08T07:30:00.000Z');
  assert.equal(new Date(value(schedule.next({ kind: 'cron', expression: '30 2 * * *', timeZone: zone }, spring))).toISOString(), '2026-03-09T06:30:00.000Z');
  const fall = value(schedule.next({ kind: 'cron', expression: '30 1 * * *', timeZone: zone }, Date.parse('2026-11-01T04:00:00Z')));
  assert.equal(new Date(fall).toISOString(), '2026-11-01T05:30:00.000Z');
  assert.equal(new Date(value(schedule.next({ kind: 'cron', expression: '30 1 * * *', timeZone: zone }, fall))).toISOString(), '2026-11-02T06:30:00.000Z');
});
test('schedule boundaries reject ambiguous shapes, missing time zones and invalid or randomized cron', () => {
  const schedule = createScheduleCalculator();
  for (const input of [{ kind: 'interval', seconds: 0 }, { kind: 'interval', seconds: 1.5 }, { kind: 'interval', seconds: 31536001 },
    { kind: 'cron', expression: '0 0 * * *' }, { kind: 'cron', expression: '0 0 * * *', timeZone: 'UTC', seconds: 1 }]) assert.equal(wakeSchedule(input).ok, false);
  for (const expression of ['* * * * * *', 'H * * * *', '77 * * * *', '0 0 31 2 *', '0 0 * *']) {
    assert.equal(schedule.next({ kind: 'cron', expression, timeZone: 'UTC' }, Date.now()).ok, false, expression);
  }
  assert.equal(schedule.next({ kind: 'cron', expression: '* * * * *', timeZone: 'Not/AZone' }, Date.now()).ok, false);
});
