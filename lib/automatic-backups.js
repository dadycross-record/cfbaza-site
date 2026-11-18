'use strict';
/* Automatic backups for CF BAZA.
   PostgreSQL/SQLite compatible storage outside the tables included in user snapshots. */
const backup=require('./backup');
const DAY=86400000;
const localParts=(date)=>{
 const local=new Date(date.getTime()+8*3600000);
 const y=local.getUTCFullYear(),m=local.getUTCMonth()+1,d=local.getUTCDate();
 const week=new Date(Date.UTC(y,m-1,d));week.setUTCDate(week.getUTCDate()+4-(week.getUTCDay()||7));
 const year=week.getUTCFullYear(),yearStart=new Date(Date.UTC(year,0,1));
 const wk=Math.ceil((((week-yearStart)/DAY)+1)/7);
 return {day:`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`,
  week:`${year}-W${String(wk).padStart(2,'0')}`,month:`${y}-${String(m).padStart(2,'0')}`};
};
async function init(db){
 await db.exec(`CREATE TABLE IF NOT EXISTS automatic_backups(
   kind TEXT NOT NULL, period TEXT NOT NULL, created_at TEXT NOT NULL,
   data BYTEA NOT NULL, PRIMARY KEY(kind,period)
 )`);
}
async function prune(db,now=new Date()){
 const cutoff={daily:new Date(now.getTime()-30*DAY).toISOString(),
  weekly:new Date(now.getTime()-12*7*DAY).toISOString(),
  monthly:new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-12,now.getUTCDate(),now.getUTCHours())).toISOString()};
 for(const kind of Object.keys(cutoff))
  await db.run('DELETE FROM automatic_backups WHERE kind=$1 AND created_at < $2',[kind,cutoff[kind]]);
}
let running=false;
async function run(db,now=new Date()){
 if(running)return;
 running=true;
 try{
  const periods=localParts(now);
  const kinds=[['daily',periods.day],['weekly',periods.week],['monthly',periods.month]];
  const missing=[];
  for(const [kind,period] of kinds){
   if(!await db.get('SELECT 1 AS found FROM automatic_backups WHERE kind=$1 AND period=$2',[kind,period]))missing.push([kind,period]);
  }
  if(missing.length){
   const snapshot=await backup.snapshot(db);
   const when=now.toISOString();
   for(const [kind,period] of missing)
    await db.run('INSERT INTO automatic_backups(kind,period,created_at,data) VALUES($1,$2,$3,$4) ON CONFLICT(kind,period) DO NOTHING',
      [kind,period,when,snapshot]);
   console.log('Automatic backups saved:',missing.map(x=>x.join(':')).join(', '));
  }
  await prune(db,now);
 }finally{running=false;}
}
async function summary(db){
 return db.all('SELECT kind,period,created_at FROM automatic_backups ORDER BY created_at DESC LIMIT 150');
}
module.exports={init,run,prune,summary,localParts};
