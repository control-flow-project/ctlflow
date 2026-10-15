import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, renameSync, rmSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pin=JSON.parse(readFileSync(new URL('../timezones.json',import.meta.url),'utf8'));
export async function prepareTimezones() {
  assert.equal(pin.version,process.versions.tz,'Native timezones match the selected common Node ICU');
  const root=fileURLToPath(new URL('../../../',import.meta.url)),parent=join(root,'.temp');mkdirSync(parent,{recursive:true,mode:0o700});
  const output=join(parent,'native-timezones-'+pin.version);
  if(existsSync(output)){assert.equal(readFileSync(join(output,'version'),'utf8').trim(),pin.version);assert.equal(readFileSync(join(output,'source.sha256'),'utf8').trim(),pin.sha256);return output;}
  const stage=mkdtempSync(join(parent,'tz-'));
  try {
    const response=await fetch(pin.url,{redirect:'error',signal:AbortSignal.timeout(30000)});assert(response.ok&&response.body,'Pinned IANA archive must be available');
    const chunks=[];let count=0;for await(const bytes of response.body){count+=bytes.length;assert(count<=8*1024*1024,'Bounded IANA archive');chunks.push(bytes);}
    const archive=Buffer.concat(chunks);assert.equal(createHash('sha256').update(archive).digest('hex'),pin.sha256,'Exact pinned IANA archive');writeFileSync(join(stage,'source.tar.gz'),archive);
    const source=join(stage,'source'),compiled=join(stage,'compiled');mkdirSync(source);mkdirSync(compiled);
    execFileSync('tar',['-xzf',join(stage,'source.tar.gz'),'--no-same-owner','--no-same-permissions','-C',source],{timeout:10000,stdio:'pipe'});
    assert.equal(readFileSync(join(source,'version'),'utf8').trim(),pin.version);
    execFileSync('zic',['-d',compiled,...['africa','antarctica','asia','australasia','europe','northamerica','southamerica','etcetera','factory','backward'].map(name=>join(source,name))],{timeout:30000,stdio:'pipe'});
    for(const name of ['version','LICENSE'])cpSync(join(source,name),join(compiled,name));writeFileSync(join(compiled,'source.sha256'),pin.sha256+'\n');
    assert(existsSync(join(compiled,'Asia/Calcutta'))&&existsSync(join(compiled,'Etc/UTC')),'Historical and canonical aliases are compiled');renameSync(compiled,output);return output;
  } finally {rmSync(stage,{recursive:true,force:true});}
}
