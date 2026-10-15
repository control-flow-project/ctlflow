import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { verifyContent } from '../tools/browser/content.js';
import { value } from './support/application.js';
import { nativeApplication } from './support/native-application.js';
import { httpFixture } from './support/http.js';
import { contentFixture, publishFixture, publicationHeaders } from './support/publication.js';
import { browserPublisher } from './support/browser-controller.js';
import { releaseFixture } from './release-fixture.js';

test('real published HTML runs modules, CSS, images and data with an opaque origin and no application credentials', { timeout: 180_000 }, async scope => {
  const release = await releaseFixture(), fixture = await nativeApplication(scope), agent = await fixture.agent(fixture.admin.actor, 'public-reporter');
  const api = await httpFixture(scope, fixture.application, release), content = await contentFixture(scope, fixture.application);
  await browserPublisher(scope, { origin: api.origin, agent, owner: fixture.admin.member.principal.matrixUserId,
    release: release.manifest.release });
  const report = await publishFixture(api.origin, agent.token, {
    'index.html': '<!doctype html><html><head><link rel="stylesheet" href="assets/style.css"></head><body><h1>Report</h1><img id="illustration" src="assets/pixel.png"><pre id="proof">waiting</pre><script type="module" src="assets/main.mjs"></script></body></html>',
    'assets/style.css': 'h1{color:rgb(10,20,30)}',
    'assets/pixel.png': Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX5kAAAAASUVORK5CYII=', 'base64'),
    'assets/value.mjs': 'export const value=42;',
    'data.json': '{"answer":42}',
    'assets/main.mjs': `import {value} from './value.mjs';
const result={origin:window.origin,value};
try { result.cookies=document.cookie; } catch(error) { result.cookies=error.name; }
try { localStorage.setItem('stolen','yes'); result.storage='allowed'; } catch(error) { result.storage=error.name; }
result.data=await (await fetch(new URL('../data.json',import.meta.url),{credentials:'omit'})).json();
document.querySelector('#proof').textContent=JSON.stringify(result);`,
    'diagram.svg': '<svg xmlns="http://www.w3.org/2000/svg"><script>document.documentElement.setAttribute("data-cookie",(()=>{try{return document.cookie}catch(error){return error.name}})())</script></svg>',
  });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true }); cleanup(scope, () => browser.close());
  const page = await browser.newPage();
  let diagnostics = 0;
  page.on('console', message => { if (message.type() === 'error' && diagnostics++ < 10) scope.diagnostic(message.text().slice(0, 1000)); });
  page.on('pageerror', error => { if (diagnostics++ < 10) scope.diagnostic(error.message.slice(0, 1000)); });
  await page.goto(report.url!);
  await expect(page.locator('#proof')).toContainText('"value":42');
  const proof = JSON.parse((await page.locator('#proof').textContent())!) as { origin: string; cookies: string; storage: string; data: { answer: number } };
  assert.deepEqual(proof, { origin: 'null', value: 42, cookies: 'SecurityError', storage: 'SecurityError', data: { answer: 42 } });
  await expect(page.locator('h1')).toHaveCSS('color', 'rgb(10, 20, 30)');
  await expect(page.locator('#illustration')).toHaveJSProperty('complete', true);
  await expect(page.locator('#illustration')).toHaveJSProperty('naturalWidth', 1);
  assert.equal((await page.request.get(content.origin + '/api/health')).status(), 404);
  const evidence = mkdtempSync(join(process.cwd(), '.temp/content-operator-'));
  const verified = value(await verifyContent(report.url!, api.origin, '/usr/bin/google-chrome', evidence, new AbortController().signal));
  assert.equal(verified.origin, 'null'); assert.equal(verified.modelCalls, 0);
  assert.equal((await verifyContent(api.origin + '/index.html', api.origin, '/usr/bin/google-chrome', evidence, new AbortController().signal)).ok, false);
  const svg = report.url!.replace('index.html', 'diagram.svg'); await page.goto(svg);
  await expect(page.locator('svg')).toHaveAttribute('data-cookie', 'SecurityError');
  const deleted = await api.request('/api/publications/' + report.id, 'DELETE', { expectedRevision: report.revision }, publicationHeaders(api.origin, fixture.admin)); assert.equal(deleted.status, 200);
  assert.equal((await page.request.get(report.url!)).status(), 404);
  assert.equal((await verifyContent(report.url!, api.origin, '/usr/bin/google-chrome', evidence, new AbortController().signal)).ok, false);
});
