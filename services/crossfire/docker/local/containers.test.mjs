import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chromium, expect } from '@playwright/test';
import { nativeProvider } from '@ctlflow/crossfire-test-support/native-provider';
import { installedFleet } from '../../dist/tests/support/public-fleet.js';
import { withDockerTestResources } from '../../../../scripts/docker-test-resources.mjs';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));
const composeFile = fileURLToPath(new URL('compose.yaml', import.meta.url));
const origin = 'http://127.0.0.1:8080', content = 'http://localhost:8082';

async function observe(check, message, timeout = 90000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error(message);
}

test('local Docker server and host fleet retain exact histories, stop intent and browser isolation', { timeout: 480000 }, async scope => {
  for (const variable of ['CROSSFIRE_RUNTIME_IMAGE', 'CROSSFIRE_MIGRATION_IMAGE']) {
    assert.match(process.env[variable] ?? '', /^sha256:[a-f0-9]{64}$/u, variable + ' must identify an exact prebuilt image');
  }
  assert(['node', 'csharp-managed', 'csharp-nativeaot', 'rust'].includes(process.env.CROSSFIRE_RUNTIME_BACKEND), 'Select the exact runtime backend for the shared Docker assertions');
  process.umask(0o077);
  mkdirSync(join(repository, '.temp'), { recursive: true });
  const directory = mkdtempSync(join(repository, '.temp/local-host-fleet-'));
  scope.after(() => rmSync(directory, { recursive: true, force: true }));
  const home = join(directory, 'home'), project = join(directory, 'project'), controller = join(directory, 'controller');
  const nativeHome = join(home, '.codex');
  mkdirSync(nativeHome, { recursive: true }); mkdirSync(project);
  execFileSync('git', ['init', '--quiet', project]);
  const executable = await installedFleet(scope);
  const provider = await nativeProvider(scope, nativeHome);
  writeFileSync(join(nativeHome, 'auth.json'), '{}', { mode: 0o600 });
  const binaryDirectory = join(directory, 'bin'); mkdirSync(binaryDirectory);
  const binary = process.env.CROSSFIRE_TEST_CODEX ?? execFileSync('which', ['codex'], { encoding: 'utf8' }).trim();
  symlinkSync(binary, join(binaryDirectory, 'codex'));
  const hostEnvironment = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), CODEX_HOME: nativeHome,
    PATH: binaryDirectory + ':' + process.env.PATH };
  delete hostEnvironment.CODEX_THREAD_ID;
  await withDockerTestResources(async cgroupParent => {
    const name = 'ctlflow-local-test-' + randomUUID().slice(0, 8);
    const environment = { ...process.env, CTLFLOW_CGROUP_PARENT: cgroupParent };
    const composeArguments = ['compose', '--project-name', name, '-f', composeFile];
    const children = new Set();
    function command(executable, arguments_, options = {}) {
      const child = spawn(executable, arguments_, { cwd: options.cwd ?? repository, env: options.env ?? environment, stdio: ['pipe', 'pipe', 'pipe'] });
      children.add(child);
      let output = '', errors = '';
      child.stdout.on('data', bytes => { output = (output + bytes.toString()).slice(-2 * 1024 * 1024); });
      child.stderr.on('data', bytes => { errors = (errors + bytes.toString()).slice(-65536); });
      const timer = setTimeout(() => child.kill('SIGTERM'), options.timeout ?? 180000);
      const ended = new Promise((resolve, reject) => {
        child.once('error', error => { clearTimeout(timer); children.delete(child); reject(error); });
        child.once('close', code => {
          clearTimeout(timer); children.delete(child);
          code === 0 ? resolve(output) : reject(new Error('Command failed (' + code + '): ' + errors));
        });
      });
      child.stdin.on('error', () => {});
      child.stdin.end(options.input ?? '');
      return { ended, output: () => output };
    }
    const compose = arguments_ => command('docker', [...composeArguments, ...arguments_]).ended;
    const fleetCommand = arguments_ => command(process.execPath, [executable, '--root', controller, ...arguments_], { env: hostEnvironment, cwd: project });
    const fleet = arguments_ => fleetCommand(arguments_).ended;
    const json = text => JSON.parse(text);
    const authentication = () => {
      const path = join(home, '.config/ctlflow/fleetd.json'), bytes = readFileSync(path), information = statSync(path);
      return { digest: createHash('sha256').update(bytes).digest('hex'), mode: information.mode & 0o777, uid: information.uid };
    };
    let browser;
    try {
      await scope.test('the selected runtime and common Knex images agree on backend and release identity', async () => {
        const runtime = json(await command('docker', ['image', 'inspect', environment.CROSSFIRE_RUNTIME_IMAGE]).ended)[0];
        const migrations = json(await command('docker', ['image', 'inspect', environment.CROSSFIRE_MIGRATION_IMAGE]).ended)[0];
        assert.equal(runtime.Config.Labels['org.crossfire.backend'], environment.CROSSFIRE_RUNTIME_BACKEND);
        assert.equal(migrations.Config.Labels['org.crossfire.backend'], 'migrations');
        for (const label of ['org.crossfire.source', 'org.opencontainers.image.version', 'org.crossfire.package']) {
          assert.equal(runtime.Config.Labels[label], migrations.Config.Labels[label]);
        }
      });
      await compose(['--profile', 'maintenance', 'run', '--rm', 'initialize']);
      await assert.rejects(compose(['--profile', 'maintenance', 'run', '--rm', 'initialize']), /Command failed/u);
      await compose(['--profile', 'maintenance', 'run', '--rm', 'migrate']);
      await compose(['up', '-d', '--no-build', '--wait', '--wait-timeout', '180']);
      const bootstrap = json(await compose(['--profile', 'maintenance', 'run', '--rm', '--no-deps', '--entrypoint', 'node', 'initialize',
        '-e', 'process.stdout.write(require("node:fs").readFileSync("/runtime/bootstrap.json","utf8"))']));
      await scope.test('only the server container runs and private backends or host state are not published', async () => {
        assert.deepEqual(json(await compose(['ps', '--format', 'json'])).Service, 'crossfire');
        const identifier = (await compose(['ps', '-q', 'crossfire'])).trim();
        const state = json(await command('docker', ['container', 'inspect', identifier]).ended)[0];
        assert.deepEqual(Object.entries(state.NetworkSettings.Ports).filter(([, bindings]) => bindings?.length).map(([port]) => port).sort(), ['8080/tcp', '8082/tcp']);
        assert.equal(state.Mounts.some(mount => mount.Type === 'bind' || mount.Destination === '/home/node'), false);
        assert.equal((await fetch(origin + '/api/health')).status, 200);
      });
      let page;
      let context;
      await scope.test('real Element and management login work through the same public origin', async () => {
        browser = await chromium.launch({ executablePath: process.env.CROSSFIRE_BROWSER ?? '/usr/bin/google-chrome', headless: true });
        context = await browser.newContext(); page = await context.newPage();
        await page.goto(origin + '/manage/');
        await page.getByLabel('Matrix username').fill('@admin:local.test');
        await page.getByLabel('Password', { exact: true }).fill(bootstrap.administratorPassword);
        await page.getByRole('button', { name: 'Sign in', exact: true }).click();
        await expect(page.getByRole('link', { name: 'Fleets', exact: true }).first()).toBeVisible();
        await page.evaluate(() => { document.cookie = 'local_scope_probe=private; SameSite=Strict; Path=/'; localStorage.setItem('local_scope_probe', 'private'); });
        assert.equal((await page.request.get(origin + '/_matrix/client/versions')).status(), 200);
        assert.equal((await page.request.get(origin + '/')).status(), 200);
      });
      async function api(path, body) {
        return page.evaluate(async ({ path, body }) => {
          const session = await fetch('/api/sessions/current').then(response => response.json());
          const response = await fetch(path, body === undefined ? {} : { method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Crossfire-CSRF': session.data.csrfSecret }, body: JSON.stringify(body) });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error.message);
          return result.data;
        }, { path, body });
      }
      const files = {
        [join(project, 'runtime.toml')]: [
          'fleet = "example"', '[coordination]', 'adapter = "crossfire"',
          'server = "http://127.0.0.1:8080"', 'owner = "@admin:local.test"',
          '[[instances]]', 'key = "alpha"', 'name = "example-alpha"',
          'definition = "assistant"', 'workarea = "agents/assistant/workarea/alpha"',
          '[[instances]]', 'key = "bravo"', 'name = "example-bravo"',
          'definition = "assistant"', 'workarea = "agents/assistant/workarea/bravo"', '',
        ].join('\n'),
        [join(project, 'agents/assistant/agent.toml')]: [
          'name = "Local fixture"', 'runtime = "codex"', '[runtime_options]',
          'approval_policy = "never"', 'sandbox_mode = "danger-full-access"', '',
        ].join('\n'),
        [join(project, 'agents/assistant/AGENTS.md')]: 'Inert host fleet verification. No external requests are authorized.',
      };
      for (const [path, contents] of Object.entries(files)) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, contents); }
      await scope.test('ordinary host setup waits for owner approval and starts separate native histories', async () => {
        const setup = fleetCommand(['setup', '--config', join(project, 'runtime.toml')]);
        void setup.ended.catch(() => {});
        let request;
        await observe(async () => { request = (await api('/api/enrollments')).find(item => item.fleetKey === 'example' && item.status === 'pending'); return Boolean(request); }, 'Host setup did not request owner approval');
        assert(!setup.output().includes('"status": "ready"'));
        assert.equal(provider.requests.length, 0, 'Installation and native preflight do not call a model');
        await api('/api/enrollments/' + request.enrollmentId + '/decision', {
          expectedRevision: request.revision, decision: 'approve', verificationCode: request.verificationCode,
        });
        assert((await setup.ended).includes('"status": "ready"'));
        assert.equal(authentication().mode, 0o600); assert.equal(authentication().uid, process.getuid());
      });
      await scope.test('an actual host agent publication cannot read main-origin cookies or storage', async () => {
        const report = join(directory, 'report'); mkdirSync(report);
        writeFileSync(join(report, 'index.html'), '<!doctype html><title>Local publication</title><h1>Local publication</h1>');
        const workspace = join(project, 'agents/assistant/workarea/alpha');
        const publication = json(await command(process.execPath, [join(workspace, '.crossfire/client.mjs'), '--project', workspace,
          '--profile', 'alpha', 'report', 'publish', '--directory', report, '--title', 'Local publication'], { env: hostEnvironment }).ended);
        assert.equal(new URL(publication.url).origin, content);
        const published = await context.newPage();
        try {
          const response = await published.goto(publication.url); assert.equal(response.status(), 200);
          await expect(published.getByRole('heading', { name: 'Local publication' })).toBeVisible();
          assert.match(response.headers()['content-security-policy'], /^sandbox allow-scripts;/u);
          const separate = await published.evaluate(() => {
            function denied(read) {
              try { read(); return false; }
              catch (error) { return error instanceof DOMException && error.name === 'SecurityError'; }
            }
            return { cookies: denied(() => document.cookie), storage: denied(() => localStorage.getItem('local_scope_probe')) };
          });
          assert.deepEqual(separate, { cookies: true, storage: true });
          assert.equal((await context.cookies(publication.url)).some(cookie => cookie.name === 'local_scope_probe'), false);
          assert.equal((await published.request.get(content + '/api/sessions/current')).status(), 404);
        } finally { await published.close(); }
      });
      const contexts = async key => json(await fleet(['agent', 'contexts', 'example', key]));
      const before = { alpha: await contexts('alpha'), bravo: await contexts('bravo') }, credential = authentication();
      assert.equal(before.alpha.length, 1); assert.equal(before.bravo.length, 1);
      assert.notEqual(before.alpha[0].sessionId, before.bravo[0].sessionId);
      await fleet(['agent', 'stop', 'example', 'bravo']);
      await scope.test('restarting the host controller retains exact histories, credentials and deliberate stops', async () => {
        await fleet(['daemon', 'restart']);
        await observe(async () => {
          const view = json(await fleet(['show', 'example']));
          return view.instances.find(item => item.instance.key === 'alpha')?.desiredActive === true
            && view.instances.find(item => item.instance.key === 'alpha')?.phase === 'sleeping'
            && view.instances.find(item => item.instance.key === 'bravo')?.phase === 'stopped';
        }, 'Host desired/stop state did not recover');
        assert.deepEqual(await contexts('alpha'), before.alpha); assert.deepEqual(await contexts('bravo'), before.bravo);
        assert.deepEqual(authentication(), credential);
        assert.equal(provider.requests.length, 0, 'Idle history restoration sends no synthetic model assignment');
      });
    } finally {
      try { await fleet(['daemon', 'stop']); }
      finally {
        try { await browser?.close(); }
        finally {
          try { await compose(['down', '--volumes', '--remove-orphans']); }
          finally { for (const child of children) child.kill('SIGTERM'); }
        }
      }
    }
  });
});
