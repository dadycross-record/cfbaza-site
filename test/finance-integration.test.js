'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const zlib=require('node:zlib');
const H=require('../lib/http');
const V=require('../lib/views');
const {open}=require('../lib/db');
const {createFinance}=require('../lib/finance');
const F=require('../lib/finance-core');
const backup=require('../lib/backup');

test('finance and employee workflow with a real SQLite database',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cfbaza-finance-'));
  const oldData=process.env.DATA_DIR,oldDatabase=process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  process.env.DATA_DIR=directory;
  const db=open();
  const parser={...H,parseForm:async req=>({fields:req.fields||{}})};
  const finance=createFinance(db,parser,V);
  const date=F.todayIrkutsk();
  const messages=[];
  function ctx(page,fields=null,staff=null){
    return {
      path:page,session:{csrf:'csrf-test',...(staff?{staffId:staff.id,staffVersion:staff.auth_version,staffSince:Date.now()}: {})},
      url:{search:'',searchParams:{get:()=>null}},
      req:{method:fields?'POST':'GET',fields:fields?{csrf:'csrf-test',...fields}:{}},
      res:{setHeader:()=>{}},
      flash:(type,msg)=>messages.push([type,msg]),
      takeFlash:()=>messages.splice(0),
      redirect:loc=>loc,
      html:html=>html,
      text:body=>body
    };
  }
  async function manager(page,fields){
    return finance.manage(ctx(page),{fields},()=>{});
  }
  async function staffAction(user,page,fields){
    return finance.handleStaff(ctx(page,fields,user));
  }
  try{
    await db.exec(db.schema);
    await finance.init();
    await manager('/admin/finance/staff',{action:'add_staff',name:'Тестовый сотрудник',email:'unit@example.org',password:'CorrectHorseBattery123',trainer:'1',administrator:'1'});
    const user=await db.get("SELECT * FROM staff_users WHERE email='unit@example.org'");
    assert.ok(user?.id);
    assert.equal(H.checkPassword('CorrectHorseBattery123',user.password_hash),true);
    await manager('/admin/finance/staff',{action:'save_rates',employee_id:String(user.id),rate_training_low:'200',rate_training_high:'300',rate_cleaning_hour:'160',rate_general:'800',rate_vacuum:'100',rate_equipment:'250'});
    await manager('/admin/finance/work',{action:'manager_work',employee_id:String(user.id),entry_date:date,kind:'training',attendance:'9',comment:'08:00 Группа 1'});
    await manager('/admin/finance/work',{action:'manager_work',employee_id:String(user.id),entry_date:date,kind:'training',attendance:'10',comment:'09:00 Группа 2'});
    let work=await db.all("SELECT * FROM staff_work WHERE kind='training' ORDER BY id");
    assert.deepEqual(work.map(x=>Number(x.amount_cents)),[20000,30000]);
    await manager('/admin/finance/work',{action:'manager_work',employee_id:String(user.id),entry_date:date,kind:'training',attendance:'10',comment:'09:00 Группа 2'});
    work=await db.all("SELECT * FROM staff_work WHERE kind='training' ORDER BY id");
    assert.equal(work.length,2,'duplicate training must be rejected');

    // Cash transactions cannot be posted until the manager's cashier opened a shift.
    await staffAction(user,'/staff/revenue',{action:'staff_transaction',entry_date:date,direction:'income',category:'membership',method:'cash',amount:'1500',comment:''});
    assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM finance_transactions')).n),0);

    await staffAction(user,'/staff/cash',{action:'staff_cash_open',entry_date:date,opening:'1000',note:''});
    const opening=await db.get('SELECT * FROM cash_shifts LIMIT 1');
    assert.equal(Number(opening.opening_cents),100000);

    await staffAction(user,'/staff/revenue',{action:'staff_transaction',entry_date:date,direction:'income',category:'membership',method:'cash',amount:'1500',comment:''});
    await staffAction(user,'/staff/revenue',{action:'staff_transaction',entry_date:date,direction:'income',category:'coffee',method:'terminal',amount:'150',comment:''});
    await staffAction(user,'/staff/revenue',{action:'staff_transaction',entry_date:date,direction:'expense',category:'unexpected',method:'cash',amount:'200',comment:'Срочная закупка'});
    await staffAction(user,'/staff/revenue',{action:'staff_transaction',entry_date:date,direction:'expense',category:'unexpected',method:'cash',amount:'250',comment:''});
    assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM finance_transactions')).n),3,'expenses without comments must be rejected');

    await staffAction(user,'/staff/cash',{action:'staff_cash_close',entry_date:date,closing:'2300',withdrawn:'0',note:''});
    const close=await db.get('SELECT * FROM cash_shifts LIMIT 1');
    assert.equal(Number(close.expected_cents),230000);
    assert.equal(Number(close.difference_cents),0);
    assert.equal(close.status,'pending');

    // Rate changes cannot rewrite old work amounts.
    await manager('/admin/finance/staff',{action:'save_rates',employee_id:String(user.id),rate_training_low:'999',rate_training_high:'999',rate_cleaning_hour:'160',rate_general:'800',rate_vacuum:'100',rate_equipment:'250'});
    assert.deepEqual((await db.all("SELECT amount_cents FROM staff_work WHERE kind='training' ORDER BY id")).map(x=>Number(x.amount_cents)),[20000,30000]);

    await manager('/admin/finance/templates',{action:'add_template',name:'Электричество',category:'utility'});
    const tpl=await db.get('SELECT * FROM finance_templates LIMIT 1');
    await manager('/admin/finance/templates',{action:'template_month',id:String(tpl.id),period:date.slice(0,7),amount:'4500.75'});
    let tx=await db.get('SELECT * FROM finance_transactions WHERE template_id=$1',[tpl.id]);
    assert.equal(Number(tx.amount_cents),450075);
    await manager('/admin/finance/templates',{action:'template_month',id:String(tpl.id),period:date.slice(0,7),amount:'4700.75'});
    tx=await db.get('SELECT * FROM finance_transactions WHERE template_id=$1',[tpl.id]);
    assert.equal(Number(tx.amount_cents),470075);
    assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM finance_transactions WHERE template_id=$1',[tpl.id])).n),1);

    const saved=zlib.gunzipSync(await backup.snapshot(db));
    const dump=JSON.parse(saved.toString('utf8'));
    assert.equal(dump.version,1);
    assert.equal(dump.finance_schema,1);
    assert.ok(Array.isArray(dump.tables.cash_shifts));
    assert.ok(Array.isArray(dump.tables.staff_work));
    assert.ok(Array.isArray(dump.tables.finance_transactions));
    assert.doesNotThrow(()=>backup.validate(dump));
    assert.ok(Number((await db.get('SELECT COUNT(*) AS n FROM finance_audit')).n)>0);
  }finally{
    await db.close();
    if(oldData===undefined)delete process.env.DATA_DIR;else process.env.DATA_DIR=oldData;
    if(oldDatabase===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=oldDatabase;
    fs.rmSync(directory,{recursive:true,force:true});
  }
});
