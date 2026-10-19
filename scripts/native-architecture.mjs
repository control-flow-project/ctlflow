import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const products = new Set(['crossfire', 'fleetd', 'fleet']);
const layers = new Set(['apps', 'packages', 'tests', 'build']);
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function localPath(root, file) {
  const path = relative(root, file);
  assert(path && !path.startsWith(`..${sep}`) && !isAbsolute(path), 'A native owner must remain inside its checkout');
  return path.split(sep).join('/');
}

export function nativeOwner(root, manifest, language) {
  const path = localPath(root, manifest);
  const [services, product, target, layer, directory] = path.split('/');
  assert.equal(services, 'services', 'Native products belong to service roots');
  assert(products.has(product), 'Native product ownership must match the three shared products');
  assert.equal(target, language, 'Native source belongs to its selected target');
  assert(layers.has(layer) && directory, 'Native owners require an application, package, test or build boundary');
  const role = language === 'rust' ? directory : directory
    .replace(/^(Crossfire|Fleetd|Fleet)\./u, '')
    .replace(/([a-z0-9])([A-Z])/gu, '$1-$2').replaceAll('.', '-').toLowerCase();
  assert(!(layer === 'packages' && role === 'database'), 'Connections, schema mappings and transactions belong to the SQLite adapter, not another database runtime');
  assert(!(layer === 'apps' && /^(web|ui|manage)$/u.test(role)), 'Native targets must use the one shared React UI');
  return { product, language, layer, role, path };
}

export function validateNativeGraph(nodes) {
  const owners = new Map(nodes.map(node => [node.manifest, node]));
  const identities = new Set();
  for (const node of nodes) {
    const identity = `${node.product}/${node.layer}/${node.role}`;
    assert(!identities.has(identity), 'A target cannot have duplicate owners for the same responsibility');
    identities.add(identity);
    for (const edge of node.edges) {
      if (edge.kind === 'dev' || edge.kind === 'build') continue;
      const dependency = owners.get(edge.manifest);
      if (edge.manifest) assert(dependency, 'Declared native dependencies must resolve to a selected workspace owner');
      if (dependency && !['tests', 'build'].includes(node.layer)) {
        assert.notEqual(dependency.layer, 'apps', 'Applications cannot become reusable dependencies');
        assert.notEqual(dependency.layer, 'tests', 'Test support must never be a production dependency');
        assert.notEqual(dependency.layer, 'build', 'Build-time compiler dependencies must be explicitly build-only');
      }
      if (node.layer !== 'packages') continue;
      if (node.role === 'domain') {
        const primitive = node.language === 'rust' && !edge.manifest && ['serde', 'serde_json', 'tokio', 'tokio-util'].includes(edge.library);
        assert(primitive || dependency?.layer === 'packages' && ['kernel', 'domain', 'agent-core'].includes(dependency.role), 'Domain rules may depend only on declared pure library owners or explicit native value/concurrency primitives');
      }
      if (node.role === 'kernel') assert(!dependency, 'The kernel cannot depend on another product layer');
      if (node.role === 'contracts' && dependency) {
        assert(dependency.layer === 'packages' && (['kernel', 'domain', 'agent-core'].includes(dependency.role)
          || node.product !== 'crossfire' && dependency.product === 'crossfire' && dependency.role === 'contracts'), 'Contracts may reuse pure shared types and canonical Crossfire wire primitives, never concrete adapters');
      }
    }
  }
  return nodes.map(({ product, language, layer, role, path }) => ({ product, language, layer, role, path }));
}

export function rustGraph(metadata, root) {
  return metadata.packages.map(item => ({
    ...nativeOwner(root, item.manifest_path, 'rust'), manifest: item.manifest_path,
    edges: item.dependencies.map(dependency => ({
      kind: dependency.kind ?? 'runtime', manifest: dependency.path ? join(dependency.path, 'Cargo.toml') : null, library: dependency.path ? null : dependency.name,
    })),
  }));
}

function projectFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (['bin', 'obj', 'node_modules', 'target'].includes(entry.name)) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? projectFiles(path) : path.endsWith('.csproj') ? [path] : [];
  });
}

export function csharpProjectEdges(root, manifest, source) {
  const groups = [...source.matchAll(/<ItemGroup([^>]*)>([\s\S]*?)<\/ItemGroup>/gu)];
  return groups.flatMap(([, group, items]) => [...items.matchAll(/<ProjectReference\s+Include="([^"]+)"([^>]*)\/?\s*>/gu)].map(([, path, attributes]) => {
    const target = resolve(dirname(manifest), path.replaceAll('\\', '/'));
    const dependency = nativeOwner(root, target, 'csharp');
    const build = dependency.layer === 'build';
    if (build && nativeOwner(root, manifest, 'csharp').layer !== 'build') {
      const analyzer = /\bOutputItemType="Analyzer"/u.test(attributes) && /\bReferenceOutputAssembly="false"/u.test(attributes);
      const efDesign = dependency.role === 'ef-compiler' && /Condition="'\$\(PublishAot\)' != 'true'"/u.test(group)
        && groups.some(([, condition, content]) => /Condition="'\$\(PublishAot\)' == 'true'"/u.test(condition) && /<Compile Remove="DesignServices.cs"\s*\/>/u.test(content));
      assert(analyzer || efDesign, 'Native output must exclude build-only compiler dependencies');
    }
    return { manifest: target, kind: build ? 'build' : 'runtime' };
  }));
}

export function csharpGraph(root) {
  return projectFiles(join(root, 'services')).map(manifest => ({
    ...nativeOwner(root, manifest, 'csharp'), manifest,
    edges: csharpProjectEdges(root, manifest, readFileSync(manifest, 'utf8')),
  }));
}

export function compareStructure(rust, csharp) {
  const key = item => `${item.product}/${item.layer}/${item.role}`;
  const first = new Set(rust.map(key)), second = new Set(csharp.map(key));
  return {
    shared: [...first].filter(item => second.has(item)).sort(),
    rustOnly: [...first].filter(item => !second.has(item)).sort(),
    csharpOnly: [...second].filter(item => !first.has(item)).sort(),
  };
}

function main() {
  const arguments_ = process.argv.slice(2);
  assert(arguments_.length === 0 || (arguments_.length === 2 && arguments_[0] === '--csharp-root' && isAbsolute(arguments_[1])), 'Use optional --csharp-root /absolute/checkout');
  const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--no-deps', '--locked', '--format-version', '1'], { cwd: repository, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 30_000 }));
  const rust = validateNativeGraph(rustGraph(metadata, repository));
  for (const item of metadata.packages.filter(item => nativeOwner(repository, item.manifest_path, 'rust').role === 'domain')) {
    const source = join(dirname(item.manifest_path), 'src');
    for (const file of readdirSync(source, {recursive:true}).filter(file => file.endsWith('.rs'))) verifyDomainPrimitives(readFileSync(join(source,file),'utf8'));
  }
  const csharp = validateNativeGraph(csharpGraph(arguments_[1] ?? repository));
  process.stdout.write(JSON.stringify({ status: 'passed', rustOwners: rust.length, csharpOwners: csharp.length, ...compareStructure(rust, csharp), scope: 'ownership and dependency structure; not capability completeness' }) + '\n');
}
export function verifyDomainPrimitives(source) {
  assert(!/\b(?:tokio|tokio_util|std)\s*::\s*(?:fs|net|process|signal|io)\b/u.test(source), 'Domain concurrency primitives must not introduce concrete filesystem, transport or process operations');
  for (const [, imports] of source.matchAll(/\buse\s+(?:tokio|tokio_util|std)\s*::([\s\S]*?);/gu)) assert(!/\b(?:fs|net|process|signal|io)\b/u.test(imports), 'Grouped domain imports must not introduce concrete filesystem, transport or process operations');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
