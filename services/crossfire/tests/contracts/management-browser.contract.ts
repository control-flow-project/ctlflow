import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { contractHttp } from '@ctlflow/crossfire-test-support/contract-http';
import { integer, list, observe, record, text } from '@ctlflow/crossfire-test-support/contract-process';
import { operations } from '@ctlflow/crossfire-contracts/rest/operations';
import type { ContractStack } from './fixture.js';

export async function managementBrowserFixture(fixture: ContractStack) {
  const person = await fixture.member('browser-person'), agent = await fixture.agent('browser-analyst');
  const native = await contractHttp(fixture.native.base, 'POST', '/_matrix/client/v3/createRoom', { name: 'Browser contract room' }, { Authorization: 'Bearer ' + fixture.owner.nativeToken }); assert.equal(native.status, 200);
  const roomId = text(record(native.body).room_id), runId = randomUUID(), sessionId = randomUUID();
  const current = await fixture.data(operations.agent, { agentId: agent.id });
  await fixture.operation(operations.setGrant, { agentId: agent.id, roomId }, { expectedRevision: integer(current.revision), expectedGeneration: null, accessMode: 'reply', powerLevel: null, muted: false });
  await observe(async () => { const view = await fixture.data(operations.grant, { agentId: agent.id, roomId }); return view.application !== null && record(view.application).membership === 'join'; }, 'Browser fixture room is actually joined');
  await fixture.operation(operations.reportFleetConnection, { fleetId: agent.fleetId, connectionId: agent.connectionId }, { stopped: false }, agent.credential);
  await fixture.operation(operations.reportListener, { agentId: agent.id, runId }, { release: fixture.release.release.manifest.release, messagesDelivered: 0, stopped: false, statistics: null,
    controller: { fleetId: agent.fleetId, connectionId: agent.connectionId, credential: agent.credential } }, agent.token);
  await fixture.operation(operations.reportRuntime, { agentId: agent.id, runId }, { sessionId, roomId: null, runtime: 'codex', state: 'waiting-answer', observedAt: Date.now(), lastActivityAt: Date.now(), historyAvailable: true,
    historyMode: 'shared', maxInputBytes: 65536, settings: [{ name: 'model', configured: 'fixture', effective: 'fixture' }], errorMessage: null }, agent.token);
  return { person, agent, roomId, runId, sessionId };
}

type BrowserState = Awaited<ReturnType<typeof managementBrowserFixture>>;
export async function managementBrowserContracts(page: Page, fixture: ContractStack, state: BrowserState, width: number): Promise<void> {
  const { agent, person, roomId, runId, sessionId } = state, params = { agentId: agent.id };
  for (const [path, heading] of [['agents', 'Agents'], ['fleets', 'Fleets'], ['wake-ups', 'Wake-ups'], ['reports', 'Reports'], ['enrollments', 'Enrollment requests'], ['connect', 'Set up an agent'], ['audit', 'Activity'], ['members', 'Members'], ['invitations', 'Invitations'], ['policy', 'Instance settings'],
    ['agents/' + agent.id, 'Agent details'], ['agents/' + agent.id + '/session', 'Agent details'], ['agents/' + agent.id + '/activity', 'Agent details'], ['agents/' + agent.id + '/settings', 'Agent details'],
    ['fleets/' + agent.fleetId, 'Fleet details'], ['fleets/' + agent.fleetId + '/sessions', 'Fleet details'], ['fleets/' + agent.fleetId + '/activity', 'Fleet details'], ['fleets/' + agent.fleetId + '/settings', 'Fleet details'], ['fleets/' + agent.fleetId + '/map', 'Fleet map'], ['enrollments/' + agent.enrollmentId, 'Review enrollment']] as const) {
    await page.goto(fixture.origin + '/manage/' + path); await expect(page.getByRole('heading', { level: 1, name: heading, exact: true })).toBeVisible();
    assert(await page.evaluate<boolean>('document.documentElement.scrollWidth <= innerWidth'), path + ' remains inside its viewport');
  }
  await page.goto(fixture.origin + '/manage/agents/' + agent.id + '/wake'); await page.reload();
  const editor = page.locator('#wake-editor'); await expect(editor).toBeVisible(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await editor.getByLabel('Search people or Matrix IDs').fill(person.matrixUserId);
  await editor.getByLabel('Allow ' + person.matrixUserId, { exact: true }).check();
  await editor.getByLabel('Wake scope for ' + person.matrixUserId).selectOption('group');
  await editor.getByRole('link', { name: 'Cancel', exact: true }).click();
  await page.getByRole('link', { name: 'Choose who can wake', exact: true }).click();
  await editor.getByLabel('Search people or Matrix IDs').fill(person.matrixUserId); await expect(editor.getByLabel('Allow ' + person.matrixUserId, { exact: true })).not.toBeChecked();
  await editor.getByLabel('Allow ' + person.matrixUserId, { exact: true }).check();
  await editor.getByLabel('Wake scope for ' + person.matrixUserId).selectOption('group');
  await editor.getByRole('button', { name: 'Save wake-up policy', exact: true }).click(); await expect(page).toHaveURL(fixture.origin + '/manage/agents/' + agent.id);
  const saved = await fixture.data(operations.wakePolicy, params); assert(list(saved.senders).some(value => record(record(value).identity).matrixUserId === person.matrixUserId && record(value).includeAgents === true));
  await page.getByRole('link', { name: 'Choose who can wake', exact: true }).click(); await editor.getByLabel('Wake scope for ' + person.matrixUserId).selectOption('person');
  await fixture.operation(operations.changeWakePolicy, params, { expectedRevision: integer(saved.revision), mode: 'humans', senders: [] });
  await editor.getByRole('button', { name: 'Save wake-up policy', exact: true }).click(); await expect(editor.getByRole('alert')).toContainText('These settings changed elsewhere');
  await editor.getByRole('button', { name: 'Discard edits & load latest' }).click(); await expect(editor.getByLabel('Audience', { exact: true })).toHaveValue('humans');
  await page.goto(fixture.origin + '/manage/agents/' + agent.id + '/rooms/' + encodeURIComponent(roomId)); await expect(page.getByRole('heading', { level: 1, name: 'Room access', exact: true })).toBeVisible();
  const delegation = page.getByLabel('Allow this agent to invite other registered agents'); await delegation.uncheck();
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Save invitation permission', exact: true }).click()]);
  await expect.poll(async () => (await fixture.data(operations.grantPermissions, { ...params, roomId })).permissions).toEqual([]);
  await delegation.check(); await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Save invitation permission', exact: true }).click()]);
  await expect.poll(async () => (await fixture.data(operations.grantPermissions, { ...params, roomId })).permissions).toEqual(['room.agent.invite']);
  await page.goto(fixture.origin + '/manage/wake-ups/new');
  await expect(page.getByRole('heading', { level: 1, name: 'New Wake-up', exact: true })).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill('Browser wake ' + width); await page.getByLabel('Wake-up message', { exact: true }).fill('Read the saved request before acting.');
  await page.getByLabel('Schedule', { exact: true }).selectOption('weekly'); await page.getByRole('button', { name: 'Weekdays', exact: true }).click();
  await page.getByLabel('Time', { exact: true }).fill('09:30'); await page.getByLabel('Time zone', { exact: true }).fill('Asia/Kolkata');
  await page.getByRole('checkbox', { name: new RegExp('^Attach ' + agent.name, 'u') }).check();
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Create Wake-up', exact: true }).click()]);
  const ruleId = new URL(page.url()).pathname.split('/').at(-1)!; const rule = await fixture.data(operations.wakeRule, { ruleId }); assert.deepEqual(rule.schedule, { kind: 'cron', expression: '30 9 * * 1,2,3,4,5', timeZone: 'Asia/Kolkata' });
  await page.getByLabel('Schedule', { exact: true }).selectOption('cron'); await page.getByLabel('Cron expression', { exact: true }).fill('0 22 * * WED'); await page.getByLabel('Enabled', { exact: true }).uncheck();
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Save Wake-up', exact: true }).click()]);
  await page.getByRole('button', { name: 'Delete Wake-up', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal((await fixture.data(operations.wakeRule, { ruleId })).enabled, false);
  await page.getByRole('button', { name: 'Delete Wake-up', exact: true }).click(); await Promise.all([page.waitForEvent('load'), page.getByRole('dialog').getByRole('button', { name: 'Delete Wake-up', exact: true }).click()]);
  const decisionId = randomUUID(); await fixture.operation(operations.createRuntimeDecision, params, { id: decisionId, runId, sessionId, runtime: 'codex', requestId: decisionId, turnId: 'browser-turn-' + width, itemId: 'browser-question-' + width,
    kind: 'question', action: 'Owner choice', review: 'Exact browser review <not HTML>', blocking: true, expiresAt: null, questions: [{ id: 'choice', title: 'Select explicitly', prompt: 'Continue?', secret: false, allowText: false, options: [{ id: 'no', label: 'No', description: 'Do not continue' }] }] }, agent.token);
  await page.goto(fixture.origin + '/manage/agents/' + agent.id + '/decisions/' + decisionId + '?choice=no');
  await expect(page.getByRole('radio', { name: 'No', exact: false })).not.toBeChecked(); await expect(page.getByRole('button', { name: 'Submit answer' })).toBeDisabled();
  assert.equal((await fixture.data(operations.pollRuntimeDecision, { ...params, decisionId }, undefined, agent.token)).status, 'pending');
  await page.getByRole('radio', { name: 'No', exact: false }).check(); await page.getByRole('button', { name: 'Submit answer' }).click();
  await expect(page.getByText('Answer submitted.', { exact: false })).toBeVisible();
  const answer = await fixture.data(operations.pollRuntimeDecision, { ...params, decisionId }, undefined, agent.token); assert.deepEqual(answer.answers, [{ questionId: 'choice', optionId: 'no', text: null }]);
  await fixture.operation(operations.receiptRuntimeDecision, { ...params, decisionId }, { status: 'responded' }, agent.token);
  await page.goto(fixture.origin + '/manage/agents/' + agent.id + '/settings');
  const trigger = page.getByRole('button', { name: 'Suspend agent', exact: true }); await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Suspend agent?', exact: true }); await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Tab'); assert(await page.evaluate<boolean>('document.querySelector("dialog").contains(document.activeElement)'));
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused(); assert.equal((await fixture.data(operations.agent, params)).status, 'active');
  const bytes = Buffer.from('<!doctype html><h1>Browser report</h1>'); const publication = await fixture.data(operations.createPublication, {}, { title: 'Browser report ' + width, files: [{ path: 'index.html', bytes: bytes.length, mediaType: 'text/html', sha256: createHash('sha256').update(bytes).digest('hex') }] }, agent.token);
  const publicationId = text(publication.id); await fixture.operation(operations.uploadPublicationFile, { publicationId, fileId: text(record(list(publication.files)[0]).id) }, bytes, agent.token);
  await fixture.operation(operations.commitPublication, { publicationId }, { expectedRevision: integer(publication.revision) }, agent.token);
  await page.goto(fixture.origin + '/manage/reports/' + publicationId + '/files'); await page.reload(); await expect(page.getByRole('table', { name: 'Report files' })).toContainText('index.html');
  await page.goto(fixture.origin + '/manage/reports/' + publicationId); await page.getByRole('button', { name: 'Delete report', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete report', exact: true }).click(); await expect.poll(async () => (await fixture.data(operations.publication, { publicationId })).state).toBe('deleted');
}
