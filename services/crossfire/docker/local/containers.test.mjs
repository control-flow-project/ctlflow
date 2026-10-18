import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chromium, expect } from '@playwright/test';
import { nativeModels } from '@ctlflow/crossfire-test-support/native-models';
import { withDockerTestResources } from '../../../../scripts/docker-test-resources.mjs';

const directory = fileURLToPath(new URL('../../../../', import.meta.url));
const composeFile = fileURLToPath(new URL('compose.yaml', import.meta.url));
const origin = 'http://127.0.0.1:8080', content = 'http://localhost:8082';
const controller = '/home/node/.ctlflow/controller';

async function observe(check, message, timeout = 90000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error(message);
}

test('local Docker retains exact fleet history, stop intent, credentials and browser isolation', { timeout: 480000 }, async scope => {
  for (const variable of ['CROSSFIRE_RUNTIME_IMAGE', 'CROSSFIRE_MIGRATION_IMAGE', 'CTLFLOW_FLEET_IMAGE']) {
    assert.match(process.env[variable] ?? '', /^sha256:[a-f0-9]{64}$/u, variable + ' must identify an exact prebuilt image');
  }
  assert(['node', 'csharp-managed', 'csharp-nativeaot', 'rust'].includes(process.env.CROSSFIRE_RUNTIME_BACKEND), 'Select the exact runtime backend for the shared Docker assertions');
  await withDockerTestResources(async cgroupParent => {
    const project = 'ctlflow-local-test-' + randomUUID().slice(0, 8);
    const environment = { ...process.env, CTLFLOW_CGROUP_PARENT: cgroupParent };
    const composeArguments = ['compose', '--project-name', project, '-f', composeFile];
    const children = new Set();
    function command(arguments_, input = '', timeout = 180000) {
      const child = spawn('docker', arguments_, { cwd: directory, env: environment, stdio: ['pipe', 'pipe', 'pipe'] });
      children.add(child);
      let output = '', errors = '';
      child.stdout.on('data', bytes => { output = (output + bytes.toString()).slice(-2 * 1024 * 1024); });
      child.stderr.on('data', bytes => { errors = (errors + bytes.toString()).slice(-65536); });
      const timer = setTimeout(() => child.kill('SIGTERM'), timeout);
      const ended = new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', code => {
          clearTimeout(timer); children.delete(child);
          code === 0 ? resolve(output) : reject(new Error('Docker command failed (' + code + '): ' + errors));
        });
      });
      child.stdin.on('error', () => {});
      child.stdin.end(input);
      return { ended, output: () => output };
    }
    const compose = (arguments_, input, timeout) => command([...composeArguments, ...arguments_], input, timeout).ended;
    const script = text => compose(['exec', '-T', 'fleetd', 'node', '--input-type=module'], text);
    const fleet = arguments_ => compose(['exec', '-T', 'fleetd', 'fleet', '--root', controller, ...arguments_]);
    const json = text => JSON.parse(text);
    let browser;
    try {
      await scope.test('the selected runtime and common Knex images agree on backend and release identity', async () => {
        const runtime = json(await command(['image', 'inspect', environment.CROSSFIRE_RUNTIME_IMAGE]).ended)[0];
        const migrations = json(await command(['image', 'inspect', environment.CROSSFIRE_MIGRATION_IMAGE]).ended)[0];
        assert.equal(runtime.Config.Labels['org.crossfire.backend'], environment.CROSSFIRE_RUNTIME_BACKEND);
        assert.equal(migrations.Config.Labels['org.crossfire.backend'], 'migrations');
        for (const label of ['org.crossfire.source', 'org.opencontainers.image.version', 'org.crossfire.package']) {
          assert.equal(runtime.Config.Labels[label], migrations.Config.Labels[label]);
        }
      });
      await compose(['--profile', 'maintenance', 'run', '--rm', 'initialize']);
      await assert.rejects(compose(['--profile', 'maintenance', 'run', '--rm', 'initialize']), /Docker command failed/u);
      await compose(['--profile', 'maintenance', 'run', '--rm', 'migrate']);
      await compose(['up', '-d', '--no-build', '--wait', '--wait-timeout', '180']);
      const bootstrap = json(await compose(['--profile', 'maintenance', 'run', '--rm', '--no-deps', '--entrypoint', 'node', 'initialize',
        '-e', 'process.stdout.write(require("node:fs").readFileSync("/runtime/bootstrap.json","utf8"))']));
      const native = await script('import{execFileSync}from"node:child_process";console.log(JSON.stringify({uid:process.getuid(),codex:execFileSync("codex",["--version"],{encoding:"utf8"}).trim(),pi:execFileSync("pi",["--version"],{encoding:"utf8"}).trim()}));');
      assert.deepEqual(json(native), { uid: 1000, codex: 'codex-cli 0.162.0', pi: '1.0.0' });
      const authState = () => script('import{readFileSync,statSync}from"node:fs";import{createHash}from"node:crypto";const path="/home/node/.config/ctlflow/fleetd.json";const bytes=readFileSync(path);console.log(JSON.stringify({digest:createHash("sha256").update(bytes).digest("hex"),mode:statSync(path).mode&511,uid:statSync(path).uid}));');
      const authentication = json(await authState());
      assert.equal(authentication.mode, 0o600); assert.equal(authentication.uid, 1000);
      assert.equal((await script('const response=await fetch("http://127.0.0.1:8080/api/health");if(!response.ok)throw new Error("Canonical origin unavailable");console.log(response.status);')).trim(), '200');
      await scope.test('native agents cannot reach private Conduit or management backends', async () => {
        await script('for(const host of["crossfire","127.0.0.1"])for(const port of[6167,8081]){let blocked=false;try{await fetch("http://"+host+":"+port+"/",{signal:AbortSignal.timeout(3000)})}catch{blocked=true}if(!blocked)throw new Error("Private backend is reachable: "+host+":"+port)}');
      });

      browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
      const context = await browser.newContext();
      const page = await context.newPage();
      await scope.test('real browser signs in on the canonical public origin', async () => {
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
      const models = { models: nativeModels().models.filter(model => model.slug === 'fixture-model') };
      const files = {
        '/home/node/.codex/auth.json': '{}',
        '/home/node/.codex/models.json': JSON.stringify(models),
        '/home/node/.codex/config.toml': [
          'model = "fixture-model"', 'model_reasoning_effort = "medium"',
          'model_catalog_json = "/home/node/.codex/models.json"', 'model_provider = "fixture"',
          '[model_providers.fixture]', 'name = "Inert local fixture"',
          'base_url = "http://127.0.0.1:19000/v1"', 'wire_api = "responses"',
          'requires_openai_auth = false', 'request_max_retries = 0', 'stream_max_retries = 0', '',
        ].join('\n'),
        '/home/node/workspaces/example/runtime.toml': [
          'fleet = "example"', '[coordination]', 'adapter = "crossfire"',
          'server = "http://127.0.0.1:8080"', 'owner = "@admin:local.test"',
          '[[instances]]', 'key = "alpha"', 'name = "example-alpha"',
          'definition = "assistant"', 'workarea = "agents/assistant/workarea/alpha"',
          '[[instances]]', 'key = "bravo"', 'name = "example-bravo"',
          'definition = "assistant"', 'workarea = "agents/assistant/workarea/bravo"', '',
        ].join('\n'),
        '/home/node/workspaces/example/agents/assistant/agent.toml': [
          'name = "Local fixture"', 'runtime = "codex"', '[runtime_options]',
          'approval_policy = "never"', 'sandbox_mode = "danger-full-access"', '',
        ].join('\n'),
        '/home/node/workspaces/example/agents/assistant/AGENTS.md':
          'Inert local container verification. No external requests are authorized.',
      };
      await script('import{mkdirSync,writeFileSync}from"node:fs";import{dirname}from"node:path";'
        + 'process.umask(63);const files=' + JSON.stringify(files)
        + ';for(const [path,contents]of Object.entries(files)){mkdirSync(dirname(path),{recursive:true});writeFileSync(path,contents);}');
      const providerSource = readFileSync(new URL('provider-fixture.mjs', import.meta.url), 'utf8');
      const startProvider = async () => {
        const provider = command([...composeArguments, 'exec', '-T', 'fleetd', 'node', '--input-type=module'], providerSource);
        void provider.ended.catch(() => {});
        await observe(() => provider.output().includes('Local inert provider ready'), 'Local provider did not start');
      };
      await startProvider();
      await scope.test('ordinary setup waits for owner approval and starts separate native histories', async () => {
        const setup = command([...composeArguments, 'exec', '-T', '--workdir', '/home/node/workspaces/example', 'fleetd', 'fleet', 'setup',
          '--root', controller, '--config', '/home/node/workspaces/example/runtime.toml']);
        void setup.ended.catch(() => {});
        let request;
        await observe(async () => { request = (await api('/api/enrollments')).find(item => item.fleetKey === 'example' && item.status === 'pending'); return Boolean(request); }, 'Setup did not request owner approval');
        assert(!setup.output().includes('"status": "ready"'));
        await api('/api/enrollments/' + request.enrollmentId + '/decision', {
          expectedRevision: request.revision, decision: 'approve', verificationCode: request.verificationCode,
        });
        assert((await setup.ended).includes('"status": "ready"'));
      });
      await scope.test('an actual agent publication cannot read main-origin cookies or storage', async () => {
        await script('import{mkdirSync,writeFileSync}from"node:fs";mkdirSync("/home/node/report",{recursive:true});'
          + 'writeFileSync("/home/node/report/index.html","<!doctype html><title>Local publication</title><h1>Local publication</h1>");');
        const workspace = '/home/node/workspaces/example/agents/assistant/workarea/alpha';
        const publication = json(await compose(['exec', '-T', 'fleetd', 'node', workspace + '/.crossfire/client.mjs',
          '--project', workspace, '--profile', 'alpha', 'report', 'publish', '--directory', '/home/node/report', '--title', 'Local publication']));
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
          const contentRequest = await published.request.get(content + '/api/sessions/current');
          assert.equal(contentRequest.status(), 404);
        } finally { await published.close(); }
      });
      const contexts = async key => json(await fleet(['agent', 'contexts', 'example', key]));
      const before = { alpha: await contexts('alpha'), bravo: await contexts('bravo') };
      assert.equal(before.alpha.length, 1); assert.equal(before.bravo.length, 1);
      assert.notEqual(before.alpha[0].sessionId, before.bravo[0].sessionId);
      await fleet(['agent', 'stop', 'example', 'bravo']);
      await scope.test('recreated fleet container retains exact contexts, current credential and explicit stop selection', async () => {
        await compose(['stop', 'fleetd']);
        await compose(['up', '-d', '--no-build', '--force-recreate', '--no-deps', 'fleetd']);
        await startProvider();
        await observe(async () => {
          const view = json(await fleet(['show', 'example']));
          return view.instances.find(item => item.instance.key === 'alpha')?.desiredActive === true
            && view.instances.find(item => item.instance.key === 'alpha')?.phase === 'sleeping'
            && view.instances.find(item => item.instance.key === 'bravo')?.phase === 'stopped';
        }, 'Saved desired/stop state did not recover');
        assert.deepEqual(await contexts('alpha'), before.alpha);
        assert.deepEqual(await contexts('bravo'), before.bravo);
        assert.deepEqual(json(await authState()), authentication);
      });
    } finally {
      try { await browser?.close(); }
      finally {
        try { await compose(['down', '--volumes', '--remove-orphans']); }
        finally { for (const child of children) child.kill('SIGTERM'); }
      }
    }
  });
});
