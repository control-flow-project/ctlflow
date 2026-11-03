import { chromium } from '@playwright/test';
import { join } from 'node:path';
import { privateDir } from '@ctlflow/crossfire-adapter-filesystem/index';
import { endpoint } from '@ctlflow/crossfire-contracts/origin';
import { publicationPath } from '@ctlflow/crossfire-domain/publication/validation';
import { failure, success } from '@ctlflow/crossfire-kernel/result';

export async function verifyContent(url: string, mainOrigin: string, executable: string, evidence: string, signal: AbortSignal) {
  const main = endpoint(mainOrigin); if (!main.ok) return main;
  let selected: URL;
  try {
    selected = new URL(url);
    const origin = endpoint(selected.origin), path = /^\/[A-Za-z0-9_-]{43}\/(.+)$/u.exec(selected.pathname);
    if (!origin.ok || selected.origin === main.value || selected.username || selected.password || selected.search || selected.hash
      || !path || !publicationPath(path[1]!).ok) return failure('invalid', 'Select an exact public report URL on a separate content origin');
  } catch { return failure('invalid', 'Invalid public report URL'); }
  const directory = privateDir(evidence);
  const response = await fetch(selected, { method: 'HEAD', redirect: 'error', signal });
  const policy = response.headers.get('content-security-policy') ?? '';
  if (response.status !== 200 || !/^text\/html\b/u.test(response.headers.get('content-type') ?? '')
    || !/(?:^|;)\s*sandbox allow-scripts\s*(?:;|$)/u.test(policy) || policy.includes('allow-same-origin')
    || response.headers.has('set-cookie') || response.headers.has('access-control-allow-credentials')
    || response.headers.get('access-control-allow-origin') !== '*' || response.headers.get('x-content-type-options') !== 'nosniff'
    || response.headers.get('referrer-policy') !== 'no-referrer' || response.headers.get('cache-control') !== 'no-store') {
    return failure('native', 'Public report security headers do not match the isolated content contract');
  }
  for (const path of ['/api/sessions/current', '/_matrix/client/versions', '/config.json', '/onboarding/setup']) {
    const denied = await fetch(selected.origin + path, { redirect: 'error', signal });
    await denied.body?.cancel();
    if (denied.status !== 404 || denied.headers.has('set-cookie')) return failure('native', 'The content host exposes an application endpoint');
  }
  const browser = await chromium.launch({ executablePath: executable, headless: true });
  const context = await browser.newContext();
  const abort = () => { void context.close().catch(() => {}); }; signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    const page = await context.newPage(); await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const proof = await page.evaluate<{ origin: string; cookie: boolean; storage: boolean; mainReadable: boolean }>(`(async () => {
      const blocked = operation => { try { operation(); return false; } catch(error) { return error.name === 'SecurityError'; } };
      let mainReadable = false;
      try { const response = await fetch(${JSON.stringify(main.value + '/api/sessions/current')}, {credentials:'include'}); await response.text(); mainReadable = true; } catch {}
      return {origin:window.origin, cookie:blocked(() => document.cookie), storage:blocked(() => localStorage.getItem('probe')), mainReadable};
    })()`);
    if (proof.origin !== 'null' || !proof.cookie || !proof.storage || proof.mainReadable) return failure('native', 'The browser report is not isolated from application identity/storage');
    await page.screenshot({ path: join(directory, 'public-report.png'), fullPage: true });
    return success({ url, mainOrigin: main.value, ...proof, applicationEndpoints: 'absent', evidence: directory, modelCalls: 0 });
  } catch { return failure('native', 'Public report browser verification failed; inspect private evidence'); }
  finally {
    signal.removeEventListener('abort', abort);
    try { await context.close(); } finally { await browser.close(); }
  }
}
