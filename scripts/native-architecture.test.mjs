import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { nativeOwner, validateNativeGraph, rustGraph, compareStructure, csharpProjectEdges, verifyDomainPrimitives } from './native-architecture.mjs';

const root = '/test/checkout';
test('C# SDK, EF compiler packages and container stages select the same exact release', () => {
  const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
  const { sdk } = JSON.parse(read('global.json'));
  assert.equal(sdk.rollForward, 'disable');
  assert.equal(sdk.allowPrerelease, true);
  const release = /^(\d+\.\d+)\.100-(rc\.\d+)\.(\d+\.\d+)$/u.exec(sdk.version);
  assert(release, 'The selected SDK must identify its exact release-candidate build');
  const runtime = release[1] + '.0-' + release[2] + '.' + release[3];
  const packages = new Map([...read('Directory.Packages.props').matchAll(/<PackageVersion Include="([^"]+)" Version="([^"]+)"/gu)]
    .map(([, name, version]) => [name, version]));
  for (const name of ['Microsoft.EntityFrameworkCore.Sqlite', 'Microsoft.EntityFrameworkCore.Design',
    'Microsoft.EntityFrameworkCore.Tasks', 'Microsoft.EntityFrameworkCore.Relational', 'Microsoft.Data.Sqlite'])
    assert.equal(packages.get(name), runtime, name);
  const docker = read('services/crossfire/csharp/Dockerfile');
  for (const [image, version] of [['sdk', release[1] + '.100-' + release[2]],
    ['aspnet', release[1] + '.0-' + release[2]], ['runtime-deps', release[1] + '.0-' + release[2]]]) {
    const reference = 'mcr.microsoft.com/dotnet/' + image + ':' + version + '@sha256:';
    assert(docker.includes(reference), image + ' must select the coordinated release');
    assert.match(docker.slice(docker.indexOf(reference) + reference.length), /^[a-f0-9]{64} AS /u);
  }
  assert(read('services/crossfire/csharp/build/Crossfire.EfCompiler/README.md').includes('`v' + runtime + '`'),
    'The reviewed build-source provenance must match the EF packages');
});

test('native JSON values and asynchronous coordination are primitives, not transport or storage adapters', () => {
  for (const library of ['serde', 'serde_json', 'tokio', 'tokio-util']) assert.equal(validateNativeGraph([owner('domain', {edges:[{kind:'runtime',manifest:null,library}]})]).length,1);
  for (const library of ['reqwest', 'diesel', 'unknown']) assert.throws(() => validateNativeGraph([owner('domain', {edges:[{kind:'runtime',manifest:null,library}]})]), /pure library owners/u);
  verifyDomainPrimitives('use tokio::sync::Semaphore; tokio::task::JoinSet::new();');
  for (const owner of ['tokio::fs', 'tokio::net', 'tokio_util::io', 'std::process', 'std::io']) assert.throws(() => verifyDomainPrimitives('use '+owner+'::Owned;'), /concrete filesystem/u);
  assert.throws(() => verifyDomainPrimitives('use tokio::{sync::Mutex, net::TcpStream};'), /concrete filesystem/u);
});
function owner(role, { layer = 'packages', edges = [] } = {}) {
  const manifest = `${root}/services/crossfire/rust/${layer}/${role}/Cargo.toml`;
  return { ...nativeOwner(root, manifest, 'rust'), manifest, edges };
}

test('native ownership is service-local and CSharp names express equivalent boundaries', () => {
  const rust = owner('adapter-sqlite');
  const csharp = nativeOwner(root, `${root}/services/crossfire/csharp/packages/Crossfire.AdapterSqlite/Crossfire.AdapterSqlite.csproj`, 'csharp');
  assert.equal(rust.role, csharp.role);
  assert.equal(rust.product, csharp.product);
  assert.equal(rust.layer, csharp.layer);
  assert.throws(() => nativeOwner(root, '/elsewhere/services/crossfire/rust/packages/domain/Cargo.toml', 'rust'), /inside its checkout/u);
  assert.throws(() => nativeOwner(root, `${root}/packages/domain/Cargo.toml`, 'rust'), /service roots/u);
  assert.throws(() => owner('database'), /SQLite adapter/u);
  assert.throws(() => owner('web', { layer: 'apps' }), /shared React/u);
});

test('domain and contracts reject concrete adapters and unresolved owners', () => {
  const kernel = owner('kernel'), adapter = owner('adapter-sqlite');
  const domain = owner('domain', { edges: [{ kind: 'runtime', manifest: kernel.manifest }] });
  assert.equal(validateNativeGraph([kernel, domain, adapter]).length, 3);
  const corrupted = { ...domain, edges: [{ kind: 'runtime', manifest: adapter.manifest }] };
  assert.throws(() => validateNativeGraph([kernel, corrupted, adapter]), /pure library owners/u);
  assert.throws(() => validateNativeGraph([kernel, { ...domain, edges: [{ kind: 'runtime', manifest: null }] }]), /pure library owners/u);
  assert.throws(() => validateNativeGraph([owner('contracts', { edges: [{ kind: 'runtime', manifest: adapter.manifest }] }), adapter]), /concrete adapters/u);
  assert.throws(() => validateNativeGraph([domain]), /resolve to a selected workspace/u);
});

test('applications, fixtures and compilers cannot leak into runtime dependencies', () => {
  const application = owner('server', { layer: 'apps' }), support = owner('support', { layer: 'tests' }), build = owner('generator', { layer: 'build' });
  for (const dependency of [application, support, build]) {
    assert.throws(() => validateNativeGraph([owner('adapter-http', { edges: [{ kind: 'runtime', manifest: dependency.manifest }] }), dependency]));
    assert.equal(validateNativeGraph([owner('adapter-http', { edges: [{ kind: 'dev', manifest: dependency.manifest }] }), dependency]).length, 2);
  }
  assert.equal(validateNativeGraph([owner('server-acceptance', { layer: 'tests', edges: [{ kind: 'runtime', manifest: application.manifest }] }), application]).length, 2);
  assert.throws(() => validateNativeGraph([owner('kernel'), owner('kernel')]), /duplicate owners/u);
});

test('Cargo metadata preserves build and test edge classification and selected owners', () => {
  const kernel = owner('kernel'), support = owner('support', { layer: 'tests' });
  const metadata = { packages: [
    { manifest_path: kernel.manifest, dependencies: [] },
    { manifest_path: `${root}/services/crossfire/rust/packages/adapter-http/Cargo.toml`, dependencies: [
      { kind: null, path: kernel.manifest.replace('/Cargo.toml', '') },
      { kind: 'dev', path: support.manifest.replace('/Cargo.toml', '') },
    ] },
    { manifest_path: support.manifest, dependencies: [] },
  ] };
  assert.equal(validateNativeGraph(rustGraph(metadata, root)).length, 3);
});

test('comparison distinguishes shared structure from missing and target-specific owners', () => {
  const rust = [owner('kernel'), owner('contracts')];
  const csharp = [owner('kernel'), owner('server', { layer: 'apps' })].map(value => ({ ...value, language: 'csharp' }));
  assert.deepEqual(compareStructure(rust, csharp), {
    shared: ['crossfire/packages/kernel'], rustOnly: ['crossfire/packages/contracts'], csharpOnly: ['crossfire/apps/server'],
  });
});

test('EF design compilation remains target-specific and excluded from the native executable', () => {
  const manifest = `${root}/services/crossfire/csharp/packages/Crossfire.AdapterSqlite/Crossfire.AdapterSqlite.csproj`;
  const reference = '<ProjectReference Include="../../build/Crossfire.EfCompiler/Crossfire.EfCompiler.csproj" />';
  const design = `<ItemGroup Condition="'$(PublishAot)' != 'true'">${reference}</ItemGroup>`;
  const remove = '<ItemGroup Condition="\'$(PublishAot)\' == \'true\'"><Compile Remove="DesignServices.cs" /></ItemGroup>';
  assert.equal(csharpProjectEdges(root, manifest, design + remove)[0].kind, 'build');
  const host = `${root}/services/crossfire/csharp/build/Crossfire.EfHost/Crossfire.EfHost.csproj`;
  assert.equal(csharpProjectEdges(root, host, '<ItemGroup><ProjectReference Include="../Crossfire.EfCompiler/Crossfire.EfCompiler.csproj" /></ItemGroup>')[0].kind, 'build');
  assert.throws(() => csharpProjectEdges(root, manifest, `<ItemGroup>${reference}</ItemGroup>`), /exclude build-only/u);
  assert.throws(() => csharpProjectEdges(root, manifest, design), /exclude build-only/u);
});

test('fleet domain reuse uses declared pure cross-service packages, never implementations', () => {
  const port = owner('agent-core');
  const manifest = `${root}/services/fleetd/rust/packages/domain/Cargo.toml`;
  const domain = { ...nativeOwner(root, manifest, 'rust'), manifest, edges: [{ kind: 'runtime', manifest: port.manifest }] };
  assert.equal(validateNativeGraph([domain, port]).length, 2);
  const adapter = owner('adapter-codex');
  assert.throws(() => validateNativeGraph([{ ...domain, edges: [{ kind: 'runtime', manifest: adapter.manifest }] }, adapter]), /pure library owners/u);
  const wire = owner('contracts');
  assert.throws(() => validateNativeGraph([{ ...domain, edges: [{ kind: 'runtime', manifest: wire.manifest }] }, wire]), /pure library owners/u);
});

test('fleet wire contracts reuse canonical Crossfire contracts without reversing service ownership', () => {
  const common = owner('contracts');
  const manifest = `${root}/services/fleetd/rust/packages/contracts/Cargo.toml`;
  const fleet = { ...nativeOwner(root, manifest, 'rust'), manifest, edges: [{ kind: 'runtime', manifest: common.manifest }] };
  assert.equal(validateNativeGraph([common, fleet]).length, 2);
  assert.throws(() => validateNativeGraph([{ ...common, edges: [{ kind: 'runtime', manifest }] }, { ...fleet, edges: [] }]), /canonical Crossfire wire primitives/u);
  const concrete = owner('adapter-sqlite');
  assert.throws(() => validateNativeGraph([{ ...fleet, edges: [{ kind: 'runtime', manifest: concrete.manifest }] }, concrete]), /concrete adapters/u);
});
