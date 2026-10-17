import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const generated = new Set(['.git', '.analysis', '.temp', 'node_modules', 'dist', 'bin', 'obj', 'target']);
export function documentationFiles(root) {
  function walk(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      if (generated.has(entry.name) || entry.isSymbolicLink()) return [];
      const file = join(directory, entry.name), path = relative(root, file).split('\\').join('/');
      if (entry.isDirectory()) return path === 't' || /^(?:docs\/(?:plans|proposals)|docs\/verification\/\d{8})\b/u.test(path) ? [] : walk(file);
      return entry.isFile() && entry.name.endsWith('.md') && !/^docs\/verification\/\d{8}/u.test(path) ? [file] : [];
    });
  }
  return walk(root);
}
export function documentationLinks(source) {
  const lines = source.split('\n'); let fence;
  return lines.flatMap((line, index) => {
    const marker = /^\s*(`{3,}|~{3,})/u.exec(line)?.[1];
    if (marker) { if (!fence) fence = marker[0]; else if (marker[0] === fence) fence = undefined; return []; }
    if (fence) return [];
    return [...line.matchAll(/\[[^\]\n]*\]\(<?([^\s)>]+)>?(?:\s+"[^"]*")?\)/gu)].map(match => ({ target: match[1], line: index + 1 }));
  });
}
export function documentationLanguage(source) {
  const promotional = /\b(?:seamless(?:ly)?|blazing(?:ly)? fast|lightning[- ]fast|world[- ]class|best[- ]in[- ]class|cutting[- ]edge|game[- ]chang(?:ing|er)|revolutionary|enterprise[- ]grade|production[- ]ready|effortless(?:ly)?|unparalleled|unleash(?:es)?|state[- ]of[- ]the[- ]art)\b/iu;
  let fence;
  return source.split('\n').flatMap((line, index) => {
    const marker = /^\s*(`{3,}|~{3,})/u.exec(line)?.[1];
    if (marker) { if (!fence) fence = marker[0]; else if (marker[0] === fence) fence = undefined; return []; }
    if (fence) return [];
    const match = promotional.exec(line);
    return match ? [{ line: index + 1, phrase: match[0] }] : [];
  });
}
export function verifyDocumentation(root) {
  const files = documentationFiles(root), failures = [];
  for (const file of files) {
    const source = new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(file));
    if (!file.endsWith('/AGENTS.md')) for (const { line, phrase } of documentationLanguage(source)) failures.push(relative(root, file) + ':' + line + ': promotional wording: ' + phrase);
    for (const { target, line } of documentationLinks(source)) {
    if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/iu.test(target)) continue;
    let destination;
    try { destination = resolve(dirname(file), decodeURIComponent(target.split(/[?#]/u)[0])); }
    catch { failures.push(relative(root, file) + ':' + line + ': invalid URL encoding: ' + target); continue; }
    const path = relative(root, destination);
    if (isAbsolute(path) || path === '..' || path.startsWith('../') || !existsSync(destination)
      || !(statSync(destination).isFile() || statSync(destination).isDirectory())) failures.push(relative(root, file) + ':' + line + ': missing repository target: ' + target);
    }
  }
  if (failures.length) throw new Error('Documentation checks failed:\n' + failures.join('\n'));
  console.log('Documentation verified: ' + files.length + ' current Markdown files; links and promotional-phrase check; dated historical records excluded.');
  return { files: files.length };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) verifyDocumentation(fileURLToPath(new URL('../', import.meta.url)));
