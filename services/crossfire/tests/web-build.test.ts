import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { buildWeb } from '../scripts/build-web.js';

test('management updates publish content-addressed assets without reusing stale browser URLs', async () => {
  mkdirSync(join(process.cwd(), '.temp'), { recursive: true });
  const root = mkdtempSync(join(process.cwd(), '.temp/web-build-'));
  const source = join(root, 'apps/web/src');
  mkdirSync(source, { recursive: true });
  copyFileSync(join(process.cwd(), 'apps/web/index.html'), join(root, 'apps/web/index.html'));
  const script = join(source, 'main.tsx');
  const stylesheet = join(source, 'style.css');
  writeFileSync(script, 'import "./style.css"; document.title = "First";');
  writeFileSync(stylesheet, 'body { color: black; }');
  async function compile(name: string) {
    const output = join(root, name);
    await buildWeb(root, output);
    const html = readFileSync(join(output, 'index.html'), 'utf8');
    const javascript = /src="(\/manage\/assets\/app-[A-Z0-9]+\.js)"/u.exec(html)?.[1];
    const css = /href="(\/manage\/assets\/app-[A-Z0-9]+\.css)"/u.exec(html)?.[1];
    assert(javascript && css);
    assert(!html.includes('__CROSSFIRE_'));
    for (const path of [javascript, css]) assert(existsSync(join(output, path.slice('/manage/'.length))));
    return { javascript, css };
  }
  const first = await compile('first');
  assert.deepEqual(await compile('identical'), first);
  writeFileSync(script, 'import "./style.css"; document.title = "Second";');
  const changedScript = await compile('changed-script');
  assert.notEqual(changedScript.javascript, first.javascript);
  assert.equal(changedScript.css, first.css);
  writeFileSync(stylesheet, 'body { color: blue; }');
  assert.notEqual((await compile('changed-style')).css, changedScript.css);
});
