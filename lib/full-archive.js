'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const JSZip=require('jszip');
const ROOT=path.resolve(__dirname,'..');
const TOP=['server.js','package.json','package-lock.json','content.json','README.md','.gitignore'];
const DIRS=['lib','static','test','tools','views'];
const HIDDEN=new Set(['.git','node_modules','.github','.cache','coverage','dist','build','tmp','temp','uploads','data']);
const SENSITIVE=/^(?:\.env(?:\..*)?|\.npmrc|\.netrc|.*\.(?:pem|key|p12|pfx|sqlite|sqlite3|db|log))$/i;
function codeFiles(root=ROOT){
 const found=[];let total=0;
 function add(file,rel){
  const st=fs.lstatSync(file);
  if(st.isSymbolicLink())return;
  if(st.isDirectory()){
   if(HIDDEN.has(path.basename(file)))return;
   for(const name of fs.readdirSync(file).sort())add(path.join(file,name),rel?rel+'/'+name:name);
  }else if(st.isFile()&&!SENSITIVE.test(path.basename(file))){
   if(st.size>48*1024*1024)throw Error('Слишком большой файл: '+rel);
   total+=st.size;if(total>180*1024*1024)throw Error('Слишком большой размер исходного кода');
   found.push({name:'code/'+rel,data:fs.readFileSync(file)});
  }
 }
 for(const f of TOP){const full=path.join(root,f);if(fs.existsSync(full))add(full,f);}
 for(const f of DIRS){const full=path.join(root,f);if(fs.existsSync(full))add(full,f);}
 if(!found.some(f=>f.name==='code/server.js')||!found.some(f=>f.name==='code/lib/backup.js'))
  throw Error('Не найдены обязательные файлы приложения');
 return found;
}
async function fullArchive(database,opts={}){
 const zip=new JSZip(),files=codeFiles();
 zip.file('database/cfbaza-backup.json.gz',database);
 for(const f of files)zip.file(f.name,f.data);
 zip.file('README-backup.json',JSON.stringify({
  project:'CF-BAZA.RU',createdAt:new Date().toISOString(),
  databaseFile:'database/cfbaza-backup.json.gz',codeFolder:'code/',
  dbSha256:crypto.createHash('sha256').update(database).digest('hex'),
  sourceVersion:opts.sourceVersion||'deployed-version',codeFiles:files.length,
  notice:'Archive contains an application database snapshot and current deployed source files, not secrets from environment variables or Git history. Keep protected because backup contains private data.'
 },null,2)+'\n');
 return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:5}});
}
module.exports={fullArchive,codeFiles};
