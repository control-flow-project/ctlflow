import assert from 'node:assert/strict';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function stageRustLicenses(metadata, destination) {
  const packages=new Map(metadata.packages.map(value=>[value.id,value])),nodes=new Map(metadata.resolve.nodes.map(value=>[value.id,value]));
  const roots=['crossfire-server','fleetd-daemon','fleet-cli','crossfire-adapter-process'];
  const pending=roots.map(name=>{const value=metadata.packages.find(value=>value.source===null&&value.name===name);assert(value,'Declared native product owner: '+name);return value.id;});
  const included=new Set();
  for(const id of pending){if(included.has(id))continue;included.add(id);for(const dependency of nodes.get(id)?.deps??[])if(dependency.dep_kinds.some(kind=>kind.kind!=='dev'))pending.push(dependency.pkg);}
  mkdirSync(destination,{recursive:true});const index=[];
  for(const id of [...included].sort()){
    const value=packages.get(id);assert(value,'Resolved native dependency');
    if(value.source===null)continue;
    assert(value.source.startsWith('registry+')&&value.license,'Pinned registry dependency has an explicit license: '+value.name);
    const directory=join(value.manifest_path,'..'),files=[];
    function collect(path,prefix=''){
      for(const name of readdirSync(path).sort()){
        const relative=prefix+name,file=join(path,name),information=lstatSync(file);
        if(information.isSymbolicLink())continue;
        if(information.isDirectory()&&/^licen[cs]es$/iu.test(name))collect(file,relative+'/');
        if(information.isFile()&&(/^(?:licen[cs]e|copying|notice)(?:[._-].*)?$/iu.test(name)||prefix))files.push([relative,file]);
      }
    }
    collect(directory);
    if(value.license_file){const file=value.license_file;assert(lstatSync(file).isFile());if(!files.some(([,path])=>path===file))files.push([basename(file),file]);}
    assert(files.length>0,'Retain actual upstream license text: '+value.name+' '+value.version);
    const selected=value.name+'-'+value.version;
    for(const [relative,file] of files){assert(lstatSync(file).size<=4*1024*1024,'Bounded license asset');const target=join(destination,selected,relative);mkdirSync(join(target,'..'),{recursive:true});copyFileSync(file,target);}
    index.push({name:value.name,version:value.version,license:value.license,source:value.source,files:files.map(([name])=>selected+'/'+name)});
  }
  writeFileSync(join(destination,'index.json'),JSON.stringify(index,null,2)+'\n');return index.length;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  assert(process.argv.length===6&&process.argv[2]==='--metadata'&&process.argv[4]==='--output','Use --metadata FILE --output DIRECTORY');
  assert(!existsSync(process.argv[5]),'License staging requires a new destination');
  console.log(stageRustLicenses(JSON.parse(readFileSync(process.argv[3],'utf8')),process.argv[5]));
}
