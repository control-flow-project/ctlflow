import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const output = process.argv[2] ?? join(project, 'dist');
if (process.argv.length > 3 || !isAbsolute(output)) throw new Error('Select one explicit absolute UI output directory');
mkdirSync(output, { recursive: true });
const result = await build({ entryPoints: { app: join(project, 'src/main.tsx') }, outdir: join(output, 'assets'), bundle: true,
  entryNames: '[name]-[hash]', metafile: true, platform: 'browser', format: 'esm', target: 'es2023', minify: true, jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' } });
const script = Object.entries(result.metafile.outputs).find(([path, metadata]) => path.endsWith('.js') && metadata.entryPoint);
if (!script?.[1].cssBundle) throw new Error('Management build must produce one script and stylesheet');
const html = readFileSync(join(project, 'index.html'), 'utf8')
  .replace('__CROSSFIRE_SCRIPT__', '/manage/assets/' + basename(script[0]))
  .replace('__CROSSFIRE_STYLE__', '/manage/assets/' + basename(script[1].cssBundle));
writeFileSync(join(output, 'index.html'), html);
copyFileSync(join(project, 'assets/element-translations.json'), join(output, 'assets/element-translations.json'));
