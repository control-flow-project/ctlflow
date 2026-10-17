import assert from 'node:assert/strict';
import test from 'node:test';
import { timezoneCatalogue } from '../services/crossfire/scripts/timezones.mjs';

test('the pinned native catalogue resolves source zones and link chains without host timezone files', () => {
  assert.deepEqual(timezoneCatalogue('fixture', [
    '# Zone Ignored\nZone Etc/UTC 0 - UTC\nZone Asia/Kolkata 5:30 - IST\n\t5:30 - IST',
    'Link Asia/Kolkata Asia/Calcutta\nLink Asia/Calcutta Legacy/India',
  ]), { version: 'fixture', zones: [
    ['Asia/Calcutta', 'Asia/Kolkata'], ['Asia/Kolkata', 'Asia/Kolkata'],
    ['Etc/UTC', 'Etc/UTC'], ['Legacy/India', 'Asia/Kolkata'],
  ] });
});

test('ambiguous or incomplete timezone sources fail instead of using host data', () => {
  assert.throws(() => timezoneCatalogue('fixture', []), /canonical zones/u);
  assert.throws(() => timezoneCatalogue('fixture', ['Zone Etc/UTC 0 - UTC\nZone Etc/UTC 0 - UTC']), /Distinct IANA zone/u);
  assert.throws(() => timezoneCatalogue('fixture', ['Zone Etc/UTC 0 - UTC\nLink Etc/UTC Alias\nLink Etc/UTC Alias']), /Distinct IANA link/u);
  assert.throws(() => timezoneCatalogue('fixture', ['Link Unknown Alias\nZone Alias 0 - UTC']), /Distinct IANA zone/u);
  assert.throws(() => timezoneCatalogue('fixture', ['Zone Etc/UTC 0 - UTC\nLink Unknown Alias']), /Unknown IANA/u);
  assert.throws(() => timezoneCatalogue('fixture', ['Zone Etc/UTC 0 - UTC\nLink Second First\nLink First Second']), /IANA link cycle/u);
});
