import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'rust-package-build-')), source = join(directory, 'source'), binaries = join(directory, 'binaries');
  mkdirSync(source); mkdirSync(binaries);
  for (const name of ['.dockerignore', '.npmrc', 'LICENSE', 'package-lock.json', 'tsconfig.base.json', 'global.json', 'Directory.Build.props', 'Directory.Build.targets', 'Directory.Packages.props', 'Ctlflow.CSharp.slnx', 'Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml']) writeFileSync(join(source, name), name + '\n');
  writeFileSync(join(source, 'package.json'), JSON.stringify({ version: '0.1.20' }));
  mkdirSync(join(source, 'scripts')); mkdirSync(join(source, 'services/crossfire/dist'), { recursive: true });
  writeFileSync(join(source, 'services/crossfire/dist/container-package-tool.mjs'), '// opaque trusted build tool fixture\n');
  writeFileSync(join(binaries, 'npm'), '#!' + process.execPath + '\nimport {appendFileSync} from "node:fs";appendFileSync(process.env.FIXTURE_CALLS,JSON.stringify(["npm",...process.argv.slice(2)])+"\\n");process.exit(process.env.FIXTURE_AUDIT_FAILURE ? 17 : 0);\n', { mode: 0o700 });
  writeFileSync(join(binaries, 'docker'), '#!' + process.execPath + '\n' + `
import {readFileSync,writeFileSync,appendFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {dirname,join} from 'node:path';
const args=process.argv.slice(2),path=process.env.FIXTURE_IMAGES;
let images={};try{images=JSON.parse(readFileSync(path,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
appendFileSync(process.env.FIXTURE_CALLS,JSON.stringify(['docker',...args])+'\\n');
const value=flag=>args[args.indexOf(flag)+1];
if(args[0]==='build'){
  const tag=value('--tag'),Id='sha256:'+createHash('sha256').update(tag).digest('hex'),Labels={};
  for(let index=0;index<args.length;index++)if(args[index]==='--label'){const input=args[++index],split=input.indexOf('=');Labels[input.slice(0,split)]=input.slice(split+1);}
  images[tag]={Id,Os:'linux',Architecture:'amd64',Config:{Labels}};images[Id]=images[tag];
  writeFileSync(path,JSON.stringify(images));
}else if(args[0]==='image'&&args[1]==='inspect'){
  const selected=images[args.at(-1)];if(!selected)process.exit(1);
  console.log(args.includes('--format')?selected.Id:JSON.stringify([selected]));
}else if(args[0]==='tag'){
  images[args[2]]=images[args[1]];writeFileSync(path,JSON.stringify(images));
}else if(args[0]==='save'){
  const output=value('--output'),directory=mkdtempSync(join(dirname(output),'metadata-'));
  mkdirSync(join(directory,'blobs/sha256'),{recursive:true});
  const blob=input=>{const bytes=JSON.stringify(input),digest=createHash('sha256').update(bytes).digest('hex');writeFileSync(join(directory,'blobs/sha256',digest),bytes);return 'sha256:'+digest;};
  const manifest=[],descriptors=[];
  for(const reference of args.slice(-2)){
    const config=blob({os:'linux',architecture:'amd64',config:images[reference].Config});
    const digest=blob({schemaVersion:2,config:{digest:config}});
    manifest.push({Config:'blobs/sha256/'+config.slice(7),RepoTags:[reference],Layers:[]});
    descriptors.push({digest,mediaType:'application/vnd.oci.image.manifest.v1+json'});
  }
  writeFileSync(join(directory,'manifest.json'),JSON.stringify(manifest));
  writeFileSync(join(directory,'index.json'),JSON.stringify({schemaVersion:2,manifests:descriptors}));
  execFileSync('/usr/bin/tar',['-C',directory,'-cf',output,'manifest.json','index.json','blobs']);
  rmSync(directory,{recursive:true});
}
else throw Error('Unexpected fixture Docker call');
`, { mode: 0o700 });
  const calls = join(directory, 'calls.jsonl');
  const environment = { ...process.env, PATH: binaries + ':' + process.env.PATH, FIXTURE_CALLS: calls, FIXTURE_IMAGES: join(directory, 'images.json') };
  return { directory, source, calls, environment };
}
test('Rust image builder reuses the canonical package format, common images, audit and explicit native backend', () => {
  const selected = fixture();
  try {
    const output = join(selected.directory, 'rust');
    execFileSync(process.execPath, ['--input-type=module', '-e', `import {buildRustContainerPackage} from ${JSON.stringify(new URL('../services/crossfire/rust/scripts/container-packages.mjs', import.meta.url).href)};await buildRustContainerPackage(${JSON.stringify(selected.source)},${JSON.stringify(output)},'verification.slice');`], { cwd: root, env: selected.environment, timeout: 30000, maxBuffer: 65536 });
    const manifest = JSON.parse(readFileSync(join(output, 'release.json'), 'utf8'));
    assert.equal(manifest.backend, 'rust'); assert.equal(manifest.platform, 'linux/amd64');
    assert.equal(manifest.version, '0.1.20'); assert.equal(manifest.schemaVersion, 2); assert.notEqual(manifest.runtime.reference, manifest.migration.reference);
    assert.match(manifest.sourceDigest, /^[a-f0-9]{64}$/u);
    const calls = readFileSync(selected.calls, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(calls[0], ['npm', 'audit', '--package-lock-only', '--omit=dev', '--audit-level=moderate']);
    const builds = calls.filter(args => args[1] === 'build');
    assert.deepEqual(builds.map(args => args[args.indexOf('--target') + 1]), ['assets', 'migrations', 'production']);
    assert(builds[2].includes(join(selected.source, 'services/crossfire/rust/Dockerfile')));
    for (const args of builds) assert(args.includes('verification.slice') && args.includes('linux/amd64'));
    const images = JSON.parse(readFileSync(selected.environment.FIXTURE_IMAGES, 'utf8'));
    assert.equal(images[manifest.runtime.reference].Config.Labels['org.crossfire.backend'], 'rust');
    assert.equal(images[manifest.migration.reference].Config.Labels['org.crossfire.backend'], 'migrations');
    assert.equal(images[manifest.runtime.reference].Config.Labels['org.crossfire.source'], images[manifest.migration.reference].Config.Labels['org.crossfire.source']);
    assert.equal(readFileSync(join(output, 'package-tool.mjs'), 'utf8'), readFileSync(join(selected.source, 'services/crossfire/dist/container-package-tool.mjs'), 'utf8'));
  } finally { rmSync(selected.directory, { recursive: true, force: true }); }
});
test('the coordinated producer includes Rust alongside all upstream targets and publishes only complete staging', () => {
  const selected = fixture();
  try {
    const output = join(selected.directory, 'packages');
    execFileSync(process.execPath, ['--input-type=module', '-e', `import {buildContainerPackages} from ${JSON.stringify(new URL('./container-packages.mjs', import.meta.url).href)};await buildContainerPackages(${JSON.stringify(selected.source)},${JSON.stringify(output)},'verification.slice');`], { cwd: root, env: selected.environment, timeout: 30000, maxBuffer: 65536 });
    assert.deepEqual(readdirSync(output).sort(), ['csharp-managed', 'csharp-nativeaot', 'node', 'rust']);
    const values = readdirSync(output).map(name => JSON.parse(readFileSync(join(output, name, 'release.json'), 'utf8')));
    assert.equal(new Set(values.map(value => JSON.stringify(value.migration))).size, 1, 'Every backend uses the same exact Knex image objects');
    assert.equal(new Set(values.map(value => value.sourceDigest)).size, 1, 'One coordinated input identity');
    assert.equal(readdirSync(selected.directory).some(name => name.startsWith('.crossfire-')), false);
    const refused = join(selected.directory, 'refused');
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `import {buildContainerPackages} from ${JSON.stringify(new URL('./container-packages.mjs', import.meta.url).href)};await buildContainerPackages(${JSON.stringify(selected.source)},${JSON.stringify(refused)});`], { cwd: root, env: { ...selected.environment, FIXTURE_AUDIT_FAILURE: '1' }, timeout: 30000, encoding: 'utf8' });
    assert.notEqual(result.status, 0); assert.equal(readdirSync(selected.directory).includes('refused'), false);
    assert.equal(readdirSync(selected.directory).some(name => name.startsWith('.crossfire-')), false);
  } finally { rmSync(selected.directory, { recursive: true, force: true }); }
});
