'use strict';
// Internal CF BAZA finance and staff workspace. Never expose these handlers from public pages.
const crypto=require('crypto');
const F=require('./finance-core');
const {durableLimit,csvCell}=require('./security');

function createFinance(db,H,V){
  const e=x=>V.e(String(x??''));
  const now=()=>new Date(Date.now()+8*3600000).toISOString().slice(0,16).replace('T',' ');
  const today=()=>F.todayIrkutsk();
  const csrf=ctx=>'<input type="hidden" name="csrf" value="'+e(ctx.session.csrf)+'">';
  const action=(ctx,name)=>csrf(ctx)+'<input type="hidden" name="action" value="'+e(name)+'">';
  const money=F.formatMoney;
  const num=v=>Number(v||0);
  const dateText=s=>F.validDate(s)?s.split('-').reverse().join('.'):e(s);
  const input=(name,value='',type='text',required=false,extra='')=>'<input name="'+e(name)+'" type="'+e(type)+'" value="'+e(value)+'"'+(required?' required':'')+' '+extra+'>';
  const field=(name,label,value='',type='text',required=false,extra='')=>'<label class="field"><span>'+e(label)+'</span>'+input(name,value,type,required,extra)+'</label>';
  const select=(name,items,value='',extra='')=>'<select name="'+e(name)+'" '+extra+'>'+Object.entries(items).map(([k,l])=>'<option value="'+e(k)+'"'+(String(value)===String(k)?' selected':'')+'>'+e(l)+'</option>').join('')+'</select>';
  const btn=(label='Сохранить')=>'<button class="btn btn-primary" type="submit">'+e(label)+'</button>';
  const form=(ctx,act,body,label='Сохранить')=>'<form class="edit flat" method="post">'+action(ctx,act)+body+'<div class="form-actions">'+btn(label)+'</div></form>';
  const card=(title,html)=>'<section class="card pad"><h2>'+e(title)+'</h2>'+html+'</section>';
  const table=(head,rows)=>'<div class="table-wrap"><table><thead><tr>'+head.map(x=>'<th>'+e(x)+'</th>').join('')+'</tr></thead><tbody>'+(rows.length?rows.map(row=>'<tr>'+row.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>').join(''):'<tr><td class="muted" colspan="'+head.length+'">Записей пока нет.</td></tr>')+'</tbody></table></div>';
  const tiles=arr=>'<div class="tiles">'+arr.map(([val,label,link])=>'<a class="tile" href="'+e(link)+'"><b>'+e(val)+'</b><span>'+e(label)+'</span></a>').join('')+'</div>';
  const link=(href,text)=>'<a href="'+e(href)+'">'+e(text)+'</a>';
  const month=ctx=>F.validMonth(ctx.url.searchParams.get('month'))?ctx.url.searchParams.get('month'):today().slice(0,7);
  const period=(ctx,label='Месяц')=>'<form class="finance-period" method="get"><label>'+e(label)+' '+input('month',month(ctx),'month',true)+'</label>'+btn('Показать')+'</form>';
  const status=s=>({pending:'На проверке',approved:'Подтверждено',rejected:'Отклонено',open:'Смена открыта'})[s]||e(s);
  const BAD=(str)=>{throw Error(str);};
  const checked=x=>num(x)?' checked':'';
  const monthRows=(tableName,dateColumn,m)=>{const [start,end]=F.monthRange(m);return {query:'SELECT * FROM '+tableName+' WHERE '+dateColumn+'>=$1 AND '+dateColumn+'<$2',params:[start,end]};};
  const getStaff=async id=>id?db.get('SELECT * FROM staff_users WHERE id=$1',[id]):null;
  const getEmployee=async id=>{const employee=await getStaff(F.number(id,10000000));if(!employee)BAD('Сотрудник не найден.');return employee;};
  const getRates=async id=>{const rows=await db.all('SELECT * FROM staff_rates WHERE employee_id=$1',[id]);return Object.fromEntries(rows.map(r=>[r.rate_type,num(r.rate_cents)]));};
  const moneyValue=cents=>(num(cents)/100).toFixed(2);
  const audit=(actor,entity,id,op,detail)=>db.run('INSERT INTO finance_audit(actor,entity,entity_id,operation,detail,created) VALUES ($1,$2,$3,$4,$5,$6)',[actor,entity,id,op,JSON.stringify(detail).slice(0,3000),now()]);
  const allStaff=()=>db.all('SELECT id,name,email,trainer,administrator,active FROM staff_users ORDER BY active DESC,name');
  const staffSelect=async ()=>Object.fromEntries((await allStaff()).map(s=>[String(s.id),s.name+(!num(s.active)?' (неактивен)':'')]));

  async function init(){
    const id=db.kind==='pg'?'SERIAL PRIMARY KEY':'INTEGER PRIMARY KEY AUTOINCREMENT';
    const stmts=[
      'CREATE TABLE IF NOT EXISTS staff_users (id '+id+',name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,trainer INTEGER NOT NULL DEFAULT 0,administrator INTEGER NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 1,auth_version INTEGER NOT NULL DEFAULT 1,created TEXT NOT NULL)',
      'CREATE TABLE IF NOT EXISTS staff_rates (employee_id INTEGER NOT NULL,rate_type TEXT NOT NULL,rate_cents BIGINT NOT NULL DEFAULT 0,updated TEXT NOT NULL,PRIMARY KEY(employee_id,rate_type))',
      'CREATE TABLE IF NOT EXISTS staff_work (id '+id+',employee_id INTEGER NOT NULL,work_date TEXT NOT NULL,kind TEXT NOT NULL,attendance INTEGER NOT NULL DEFAULT 0,units INTEGER NOT NULL DEFAULT 1,rate_cents BIGINT NOT NULL,amount_cents BIGINT NOT NULL,comment TEXT NOT NULL DEFAULT \'\',status TEXT NOT NULL DEFAULT \'pending\',created TEXT NOT NULL,reviewed TEXT NOT NULL DEFAULT \'\')',
      'CREATE TABLE IF NOT EXISTS finance_templates (id '+id+',name TEXT NOT NULL,category TEXT NOT NULL DEFAULT \'utility\',active INTEGER NOT NULL DEFAULT 1,created TEXT NOT NULL)',
      'CREATE TABLE IF NOT EXISTS finance_transactions (id '+id+',employee_id INTEGER,direction TEXT NOT NULL,entry_date TEXT NOT NULL,category TEXT NOT NULL,method TEXT NOT NULL,amount_cents BIGINT NOT NULL,comment TEXT NOT NULL DEFAULT \'\',status TEXT NOT NULL DEFAULT \'pending\',template_id INTEGER,period TEXT,created TEXT NOT NULL,reviewed TEXT NOT NULL DEFAULT \'\')',
      'CREATE TABLE IF NOT EXISTS cash_shifts (id '+id+',employee_id INTEGER NOT NULL,entry_date TEXT NOT NULL,opening_cents BIGINT NOT NULL,opening_delta_cents BIGINT NOT NULL DEFAULT 0,closing_cents BIGINT,withdrawn_cents BIGINT NOT NULL DEFAULT 0,expected_cents BIGINT,difference_cents BIGINT,note TEXT NOT NULL DEFAULT \'\',status TEXT NOT NULL DEFAULT \'open\',created TEXT NOT NULL,reviewed TEXT NOT NULL DEFAULT \'\',UNIQUE(employee_id,entry_date))',
      'CREATE TABLE IF NOT EXISTS payroll_extras (id '+id+',employee_id INTEGER NOT NULL,entry_date TEXT NOT NULL,amount_cents BIGINT NOT NULL,comment TEXT NOT NULL,created TEXT NOT NULL)',
      'CREATE TABLE IF NOT EXISTS payroll_payments (id '+id+',employee_id INTEGER NOT NULL,pay_date TEXT NOT NULL,amount_cents BIGINT NOT NULL,comment TEXT NOT NULL,created TEXT NOT NULL)',
      'CREATE TABLE IF NOT EXISTS finance_audit (id '+id+',actor TEXT NOT NULL,entity TEXT NOT NULL,entity_id INTEGER NOT NULL,operation TEXT NOT NULL,detail TEXT NOT NULL,created TEXT NOT NULL)',
      'CREATE INDEX IF NOT EXISTS idx_staff_work_month ON staff_work(work_date,employee_id)',
      'CREATE INDEX IF NOT EXISTS idx_finance_tx_month ON finance_transactions(entry_date,direction,status)',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_template_month ON finance_transactions(template_id,period)',
      'CREATE INDEX IF NOT EXISTS idx_payroll_extras_month ON payroll_extras(entry_date,employee_id)',
      'CREATE INDEX IF NOT EXISTS idx_payroll_payments_month ON payroll_payments(pay_date,employee_id)'
    ];
    for(const statement of stmts)await db.exec(statement);
  }

  async function recordWork(employee,fields,actor,approved=false){
    const kind=String(fields.kind||'');
    const training=kind==='training';
    const adminTask=['cleaning','general','vacuum','equipment'].includes(kind);
    if(training&&!num(employee.trainer)||adminTask&&!num(employee.administrator)||!training&&!adminTask)BAD('Этот вид работы не разрешён сотруднику.');
    const date=F.validatePastDate(fields.entry_date);
    const attendance=training?F.number(fields.attendance,300):0;
    const type=F.rateType(kind,attendance);
    const rates=await getRates(employee.id);
    if(!Object.prototype.hasOwnProperty.call(rates,type))BAD('Ставка ещё не назначена руководителем.');
    const calc=F.calculateWork({kind,attendance,minutes:kind==='cleaning'?F.number(fields.minutes,1440):0,quantity:kind!=='cleaning'&&!training?F.number(fields.quantity||'1',100):1,rateCents:rates[type],date});
    const note=String(fields.comment||'').trim().slice(0,250);
    const res=await db.run('INSERT INTO staff_work(employee_id,work_date,kind,attendance,units,rate_cents,amount_cents,comment,status,created) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',
      [employee.id,date,kind,attendance,calc.units,rates[type],calc.amountCents,note,approved?'approved':'pending',now()]);
    await audit(actor,'work',res.rows[0].id,'create',{kind,date,amount:calc.amountCents,employee:employee.id});
    return res.rows[0].id;
  }
  async function recordTransaction(fields,actor,employeeId=null,approved=false){
    const direction=String(fields.direction||'');
    if(direction!=='income'&&direction!=='expense')BAD('Выберите доход или расход.');
    const date=F.validatePastDate(fields.entry_date);
    const category=String(fields.category||'');
    if(!(direction==='income'?F.INCOME:F.EXPENSE)[category])BAD('Неизвестная категория.');
    const method=String(fields.method||'');
    if(!F.METHODS[method])BAD('Выберите способ оплаты.');
    const value=F.parseMoney(fields.amount);
    const comment=String(fields.comment||'').trim().slice(0,500);
    if(direction==='expense'&&!comment)BAD('Для расходов обязательный комментарий.');
    if(employeeId){
      const shift=await db.get("SELECT status FROM cash_shifts WHERE employee_id=$1 AND entry_date=$2",[employeeId,date]);
      if(!shift||shift.status!=='open')BAD('Сначала откройте кассовую смену на эту дату. Закрытые смены менять нельзя.');
    }
    const result=await db.run('INSERT INTO finance_transactions(employee_id,direction,entry_date,category,method,amount_cents,comment,status,created) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
      [employeeId,direction,date,category,method,value,comment,approved?'approved':'pending',now()]);
    await audit(actor,'transaction',result.rows[0].id,'create',{direction,category,method,amount:value,date,employeeId});
  }
  async function financeTotals(m){
    const [start,end]=F.monthRange(m);
    const tx=await db.all('SELECT * FROM finance_transactions WHERE entry_date >= $1 AND entry_date < $2',[start,end]);
    const work=await db.all('SELECT * FROM staff_work WHERE work_date >= $1 AND work_date < $2',[start,end]);
    const extras=await db.all('SELECT * FROM payroll_extras WHERE entry_date >= $1 AND entry_date < $2',[start,end]);
    const payments=await db.all('SELECT * FROM payroll_payments WHERE pay_date >= $1 AND pay_date < $2',[start,end]);
    const income=F.sum(tx.filter(t=>t.status==='approved'&&t.direction==='income'));
    const expense=F.sum(tx.filter(t=>t.status==='approved'&&t.direction==='expense'));
    const wages=F.sum(work.filter(t=>t.status==='approved'))+F.sum(extras);
    const paid=F.sum(payments);
    const pendingTx=tx.filter(t=>t.status==='pending').length;
    const pendingWork=work.filter(t=>t.status==='pending').length;
    return {income,expense,wages,paid,profit:income-expense-wages,pendingTx,pendingWork,tx,work,extras,payments};
  }
  async function dashboardMini(m){
    const t=await financeTotals(m);
    return '<div class="topline" style="margin-top:24px"><h2>Финансы CF BAZA · '+e(m)+'</h2>'+link('/admin/finance?month='+encodeURIComponent(m),'Открыть финансовый кабинет')+'</div>'+tiles([[money(t.income),'Подтверждённые доходы','/admin/finance/revenue'],[money(t.expense),'Подтверждённые расходы','/admin/finance/revenue'],[money(t.wages),'Начислено сотрудникам','/admin/finance/payroll'],[money(t.profit),'Результат до других неучтённых затрат','/admin/finance']])+
      '<p class="muted">Ожидают проверки: '+t.pendingTx+' финансовых записей и '+t.pendingWork+' рабочих записей. Неподтверждённые операции в итог не включены.</p>';
  }

  function nav(active=''){
    const links=[['/admin/finance','Обзор'],['/admin/finance/staff','Сотрудники и ставки'],['/admin/finance/work','Работа и начисления'],['/admin/finance/revenue','Доходы и расходы'],['/admin/finance/cash','Сверка кассы'],['/admin/finance/templates','Коммуналка и шаблоны'],['/admin/finance/payroll','Зарплата и выплаты']];
    return '<div class="tabs">'+links.map(([href,name])=>'<a class="'+(active===href?'on':'')+'" href="'+href+'">'+e(name)+'</a>').join('')+'</div>';
  }
  function managerHeader(title,ctx){
    return '<div class="topline"><h1>'+e(title)+'</h1><a href="/admin">← Обзор клуба</a></div>'+nav(ctx.path);
  }
  function employeeNameMap(employees){return Object.fromEntries(employees.map(s=>[s.id,s.name]));}
  function workRows(rows,nameMap,ctx,manager=false){
    return table(['Дата','Сотрудник','Работа','Количество','Начислено','Статус','Комментарий',...(manager?['Проверка']:[])],
      rows.map(r=>{
        const units=r.kind==='training'?num(r.attendance)+' чел.':r.kind==='cleaning'?(num(r.units)/60).toLocaleString('ru-RU')+' ч.':num(r.units)+' шт.';
        const cells=[e(dateText(r.work_date)),e(nameMap[r.employee_id]||''),e(F.WORK_LABELS[r.kind]),e(units),e(money(r.amount_cents)),e(status(r.status)),e(r.comment)];
        if(manager)cells.push(r.status==='pending'?'<form method="post">'+action(ctx,'review_work')+input('id',r.id,'hidden')+'<button class="btn btn-sm" name="decision" value="approved">Подтвердить</button> <button class="btn btn-sm btn-danger" name="decision" value="rejected">Отклонить</button></form>':'—');
        return cells;
      }));
  }
  function transactionRows(rows,ctx,manager=false){
    const cols=['Дата','Вид','Категория','Способ','Сумма','Комментарий','Статус',...(manager?['Проверка']:[])];
    return table(cols,rows.map(r=>{
      const items=r.direction==='income'?F.INCOME:F.EXPENSE;
      const cells=[e(dateText(r.entry_date)),r.direction==='income'?'Доход':'Расход',e(items[r.category]||r.category),e(F.METHODS[r.method]||r.method),e(money(r.amount_cents)),e(r.comment),e(status(r.status))];
      if(manager)cells.push(r.status==='pending'?'<form method="post">'+action(ctx,'review_transaction')+input('id',r.id,'hidden')+'<button class="btn btn-sm" name="decision" value="approved">Подтвердить</button> <button class="btn btn-sm btn-danger" name="decision" value="rejected">Отклонить</button></form>':'—');
      return cells;
    }));
  }
  function transactionForm(ctx,admin=false,direction='income'){
    const income=direction==='income';
    const category=income?F.INCOME:F.EXPENSE;
    return form(ctx,admin?'manager_transaction':'staff_transaction',
      input('direction',direction,'hidden')+
      field('entry_date','Дата',today(),'date',true)+
      '<div class="row2">'+
      '<label class="field"><span>Категория</span>'+select('category',category,income?'membership':'supplies')+'</label>'+
      '<label class="field"><span>Оплата</span>'+select('method',F.METHODS,'cash')+'</label></div>'+
      field('amount','Сумма, ₽','','number',true,'min="0.01" step="0.01"')+
      '<label class="field"><span>Комментарий'+(income?' (необязательно)':' (обязательно)')+'</span><textarea name="comment" maxlength="500" '+(income?'':'required')+' placeholder="'+(income?'Например, продажа воды':'Что куплено и зачем')+'"></textarea></label>'+
      '<p class="muted">'+(income?'Абонементы, кофе, вода, изотоник и другие продажи.':'Непредвиденные расходы записываются отдельно с комментарием.')+'</p>',
      income?'Добавить доход':'Добавить расход');
  }
  function workForm(ctx,employeeSelect,roles){
    return '<form class="edit flat" method="post">'+action(ctx,employeeSelect?'manager_work':'staff_work')+
      (employeeSelect?'<label class="field"><span>Сотрудник</span>'+select('employee_id',employeeSelect)+'</label>':'')+
      field('entry_date','Дата',today(),'date',true)+
      '<label class="field"><span>Вид работы</span>'+select('kind',roles?Object.fromEntries(Object.entries(F.WORK_LABELS).filter(([key])=>key==='training'?num(roles.trainer):num(roles.administrator))):F.WORK_LABELS,roles&&!num(roles.trainer)?'cleaning':'training')+'</label>'+
      '<div class="row2">'+field('attendance','Человек в группе (тренер)',0,'number',false,'min="0" max="300"')+
      field('minutes','Минут уборки (администратор)',0,'number',false,'min="0" max="1440"')+'</div>'+
      field('quantity','Количество работ (генеральная, пылесос, оборудование)',1,'number',false,'min="1" max="100"')+
      field('comment','Группа / время / примечание','')+
      '<p class="muted">Одна запись = одна тренировка или одна выполненная работа. Порог ставки: 10 человек включительно. Для ежедневной уборки укажите минуты.</p>'+
      '<div class="form-actions">'+btn('Добавить работу')+'</div></form>';
  }
  async function manage(ctx,posted,render){
    const m=month(ctx),p=ctx.path;
    const f=posted?.fields;
    if(f){
      try{
        const act=String(f.action||'');
        if(act==='add_staff'){
          const name=String(f.name||'').trim().slice(0,100);
          const email=String(f.email||'').trim().toLowerCase();
          const pwd=String(f.password||'');
          if(!name||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)||pwd.length<12)BAD('Введите имя, корректную почту и пароль от 12 символов.');
          if(f.trainer!=='1'&&f.administrator!=='1')BAD('Назначьте хотя бы один статус.');
          const result=await db.run('INSERT INTO staff_users(name,email,password_hash,trainer,administrator,created) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
            [name,email,H.hashPassword(pwd),f.trainer==='1'?1:0,f.administrator==='1'?1:0,now()]);
          await audit('owner','employee',result.rows[0].id,'create',{name,email});
          ctx.flash('ok','Сотрудник добавлен. Передайте ему пароль безопасным способом.');
        }else if(act==='edit_staff'){
          const user=await getEmployee(f.employee_id);
          if(f.trainer!=='1'&&f.administrator!=='1')BAD('Назначьте хотя бы один статус.');
          const active=f.active==='1'?1:0;
          const pwd=String(f.password||'');
          if(pwd&&pwd.length<12)BAD('Новый пароль — не менее 12 символов.');
          if(pwd){
            await db.run('UPDATE staff_users SET trainer=$1,administrator=$2,active=$3,password_hash=$4,auth_version=auth_version+1 WHERE id=$5',[f.trainer==='1'?1:0,f.administrator==='1'?1:0,active,H.hashPassword(pwd),user.id]);
          }else{
            await db.run('UPDATE staff_users SET trainer=$1,administrator=$2,active=$3,auth_version=auth_version+1 WHERE id=$4',[f.trainer==='1'?1:0,f.administrator==='1'?1:0,active,user.id]);
          }
          await audit('owner','employee',user.id,'update',{trainer:f.trainer==='1',administrator:f.administrator==='1',active:!!active,resetPassword:!!pwd});
          ctx.flash('ok','Статусы и доступ обновлены.');
        }else if(act==='save_rates'){
          const user=await getEmployee(f.employee_id);
          for(const key of Object.keys(F.TYPES)){
            const value=F.parseMoney(f['rate_'+key]||'0',{zero:true});
            await db.run('INSERT INTO staff_rates(employee_id,rate_type,rate_cents,updated) VALUES ($1,$2,$3,$4) ON CONFLICT(employee_id,rate_type) DO UPDATE SET rate_cents=$3,updated=$4',[user.id,key,value,now()]);
          }
          await audit('owner','rates',user.id,'update',{employee:user.id});
          ctx.flash('ok','Ставки сохранены. Старые начисления не пересчитываются.');
        }else if(act==='review_work'||act==='review_transaction'||act==='review_cash'){
          const decision=String(f.decision||'');
          if(decision!=='approved'&&decision!=='rejected')BAD('Неизвестное решение.');
          const id=F.number(f.id,1000000000);
          const target=act==='review_work'?'staff_work':act==='review_cash'?'cash_shifts':'finance_transactions';
          const result=await db.run('UPDATE '+target+' SET status=$1,reviewed=$2 WHERE id=$3 AND status=$4 RETURNING id',[decision,now(),id,'pending']);
          if(result.changes!==1)BAD('Запись уже рассмотрена.');
          await audit('owner',target,id,'review',{decision});
          ctx.flash('ok','Решение сохранено.');
        }else if(act==='manager_work'){
          const user=await getEmployee(f.employee_id);
          await recordWork(user,f,'owner',true);
          ctx.flash('ok','Работа добавлена и подтверждена.');
        }else if(act==='manager_transaction'){
          await recordTransaction(f,'owner',null,true);
          ctx.flash('ok','Операция добавлена.');
        }else if(act==='add_template'){
          const name=String(f.name||'').trim().slice(0,120);
          if(!name)BAD('Укажите название регулярного расхода.');
          const category=F.EXPENSE[f.category]?f.category:'utility';
          const result=await db.run('INSERT INTO finance_templates(name,category,created) VALUES ($1,$2,$3) RETURNING id',[name,category,now()]);
          await audit('owner','template',result.rows[0].id,'create',{name,category});
          ctx.flash('ok','Шаблон создан.');
        }else if(act==='toggle_template'){
          const id=F.number(f.id,1000000000);
          await db.run('UPDATE finance_templates SET active=1-active WHERE id=$1',[id]);
          await audit('owner','template',id,'toggle',{});
          ctx.flash('ok','Шаблон изменён.');
        }else if(act==='template_month'){
          const id=F.number(f.id,1000000000);
          const month=String(f.period||'');
          if(!F.validMonth(month))BAD('Неверный месяц.');
          const template=await db.get('SELECT * FROM finance_templates WHERE id=$1 AND active=1',[id]);
          if(!template)BAD('Шаблон не найден или отключён.');
          const value=F.parseMoney(f.amount);
          const date=month+'-01';
          const existing=await db.get('SELECT * FROM finance_transactions WHERE template_id=$1 AND period=$2',[id,month]);
          if(existing){
            await db.run('UPDATE finance_transactions SET amount_cents=$1,reviewed=$2 WHERE id=$3',[value,now(),existing.id]);
            await audit('owner','transaction',existing.id,'correct_template',{oldAmount:num(existing.amount_cents),amount:value,month});
          }else{
            const result=await db.run("INSERT INTO finance_transactions(direction,entry_date,category,method,amount_cents,comment,status,template_id,period,created) VALUES ('expense',$1,$2,'terminal',$3,$4,'approved',$5,$6,$7) RETURNING id",
              [date,template.category,value,template.name,id,month,now()]);
            await audit('owner','transaction',result.rows[0].id,'template',{id,amount:value,month});
          }
          ctx.flash('ok','Ежемесячная сумма сохранена.');
        }else if(act==='add_extra'||act==='add_payment'){
          const user=await getEmployee(f.employee_id);
          const date=F.validatePastDate(f.entry_date,365);
          const val=F.parseMoney(f.amount);
          const comment=String(f.comment||'').trim().slice(0,350);
          if(!comment)BAD('Укажите причину выплаты.');
          const target=act==='add_extra'?'payroll_extras':'payroll_payments';
          const dateColumn=act==='add_extra'?'entry_date':'pay_date';
          const result=await db.run('INSERT INTO '+target+'(employee_id,'+dateColumn+',amount_cents,comment,created) VALUES ($1,$2,$3,$4,$5) RETURNING id',
            [user.id,date,val,comment,now()]);
          await audit('owner',target,result.rows[0].id,'create',{employee:user.id,amount:val,date});
          ctx.flash('ok','Запись сохранена.');
        }else BAD('Неизвестное действие.');
      }catch(err){
        console.error('finance manager form:',err.message);
        ctx.flash('error',err.message.includes('unique')||err.message.includes('duplicate')?'Такая запись уже существует.':err.message);
      }
      return ctx.redirect(p+(ctx.url.search||''));
    }

    const employees=await allStaff();
    const names=employeeNameMap(employees);
    const t=await financeTotals(m);
    let body=managerHeader('Финансы и персонал',ctx)+period(ctx);
    if(p==='/admin/finance'||p==='/admin/finance/'){
      const shifts=await db.all('SELECT * FROM cash_shifts WHERE entry_date >= $1 AND entry_date < $2 ORDER BY entry_date DESC,id DESC',F.monthRange(m));
      const diffs=shifts.filter(s=>s.status!=='open'&&(num(s.difference_cents)!==0||num(s.opening_delta_cents)!==0));
      body+=tiles([[money(t.income),'Доходы (подтверждено)','/admin/finance/revenue'],[money(t.expense),'Расходы (подтверждено)','/admin/finance/revenue'],
        [money(t.wages),'Зарплата начислена','/admin/finance/payroll'],[money(t.profit),'Результат периода','/admin/finance'],
        [money(t.paid),'Зарплата выплачена','/admin/finance/payroll'],[String(t.pendingWork+t.pendingTx),'Записей на проверке','/admin/finance/work'],
        [String(diffs.length),'Расхождения кассы','/admin/finance/cash']]);
      const sales=Object.entries(F.METHODS).map(([k,label])=>{
        const revenue=F.sum(t.tx.filter(x=>x.status==='approved'&&x.direction==='income'&&x.method===k));
        return [e(label),e(money(revenue))];
      });
      body+='<div class="finance-grid">'+card('Выручка по способам оплаты',table(['Способ','Сумма'],sales))+
        card('Что требует внимания','<p>Рабочие записи: <b>'+t.pendingWork+'</b></p><p>Доходы и расходы: <b>'+t.pendingTx+'</b></p><p>Расхождения кассы: <b>'+diffs.length+'</b></p>')+'</div>';
      body+=card('Последние операции',transactionRows(t.tx.slice().reverse().slice(0,15),ctx,true));
    }else if(p==='/admin/finance/staff'){
      body+=card('Добавить сотрудника',form(ctx,'add_staff',field('name','ФИО','', 'text',true)+field('email','Электронная почта','', 'email',true)+
        field('password','Первичный пароль (от 12 символов)','','password',true)+
        '<div class="row2"><label><input type="checkbox" name="trainer" value="1"> Тренер</label><label><input type="checkbox" name="administrator" value="1"> Администратор</label></div>',
        'Выдать доступ'));
      body+=card('Сотрудники',employees.length?employees.map(u=>'<details class="finance-details"><summary><b>'+e(u.name)+'</b> · '+(num(u.trainer)?'Тренер ':'')+(num(u.administrator)?'Администратор':'')+(num(u.active)?'':' · Доступ отключён')+'</summary>'+
        form(ctx,'edit_staff',input('employee_id',u.id,'hidden')+'<div class="row2"><label><input type="checkbox" name="trainer" value="1"'+checked(u.trainer)+'> Тренер</label><label><input type="checkbox" name="administrator" value="1"'+checked(u.administrator)+'> Администратор</label></div>'+
        '<label><input type="checkbox" name="active" value="1"'+checked(u.active)+'> Доступ активен</label>'+field('password','Новый пароль (необязательно)','','password'), 'Обновить доступ')+
        '<p>'+link('/admin/finance/staff?month='+m+'&rates='+u.id,'Настроить ставки →')+'</p></details>').join(''):'<p>Сотрудников пока нет.</p>');
      const rateId=ctx.url.searchParams.get('rates');
      if(rateId){
        const u=await getEmployee(rateId);
        const rates=await getRates(u.id);
        body+=card('Ставки: '+u.name,form(ctx,'save_rates',input('employee_id',u.id,'hidden')+Object.entries(F.TYPES).map(([key,label])=>field('rate_'+key,label+', ₽',moneyValue(rates[key]||0),'number',true,'min="0" step="0.01"')).join('')+
          '<p class="muted">Ставки действуют для новых записей. Уже начисленные суммы не изменятся.</p>','Сохранить ставки'));
      }
    }else if(p==='/admin/finance/work'){
      body+=card('Внести работу за сотрудника',workForm(ctx,Object.fromEntries(employees.map(u=>[String(u.id),u.name]))));
      body+=card('Записи о работе',workRows(t.work.slice().reverse(),names,ctx,true));
    }else if(p==='/admin/finance/revenue'){
      body+='<div class="finance-grid">'+card('Добавить доход',transactionForm(ctx,true,'income'))+card('Добавить расход',transactionForm(ctx,true,'expense'))+'</div>';
      body+=card('Журнал операций',transactionRows(t.tx.slice().reverse(),ctx,true));
      body+='<p class="muted">Неподтверждённые операции не входят в итог финансового дашборда.</p>';
    }else if(p==='/admin/finance/cash'){
      const shifts=await db.all('SELECT * FROM cash_shifts WHERE entry_date >= $1 AND entry_date < $2 ORDER BY entry_date DESC,id DESC',F.monthRange(m));
      body+=card('Сверка наличных по сменам',table(['Дата','Администратор','Начало','Ожидалось','Факт','Расхождение','Передано','Статус','Решение'],
        shifts.map(x=>[e(dateText(x.entry_date)),e(names[x.employee_id]||''),e(money(x.opening_cents)),x.status==='open'?'—':e(money(x.expected_cents)),x.status==='open'?'—':e(money(x.closing_cents)),
          x.status==='open'?'—':e(money(x.difference_cents)),e(money(x.withdrawn_cents)),e(status(x.status))+(x.note?'<p class="muted">'+e(x.note)+'</p>':''),
          x.status==='pending'?'<form method="post">'+action(ctx,'review_cash')+input('id',x.id,'hidden')+'<button class="btn btn-sm" name="decision" value="approved">Сверено</button> <button class="btn btn-sm btn-danger" name="decision" value="rejected">Расхождение</button></form>':'—'])));
      body+='<p class="muted">Ожидалось = наличные в начале + наличные поступления − наличные расходы − передача наличных. При несовпадении начала смены с прошлой кассой фиксируется отдельное расхождение.</p>';
    }else if(p==='/admin/finance/templates'){
      const templates=await db.all('SELECT * FROM finance_templates ORDER BY active DESC,id');
      body+=card('Добавить шаблон ежемесячного расхода',form(ctx,'add_template',field('name','Название (например, Электричество)','','text',true)+
        '<label class="field"><span>Категория</span>'+select('category',F.EXPENSE,'utility')+'</label>','Создать шаблон'));
      const entries=await db.all('SELECT * FROM finance_transactions WHERE period=$1 AND template_id IS NOT NULL',[m]);
      const byTemplate=Object.fromEntries(entries.map(x=>[x.template_id,x]));
      body+=card('Расходы за '+m,templates.map(x=>{
        const entry=byTemplate[x.id];
        return '<div class="finance-template"><div><b>'+e(x.name)+'</b> <small>'+(num(x.active)?'Активен':'Отключён')+'</small></div>'+
          (num(x.active)?'<form method="post" class="finance-inline">'+action(ctx,'template_month')+input('id',x.id,'hidden')+input('period',m,'hidden')+
          input('amount',entry?moneyValue(entry.amount_cents):'','number',true,'min="0.01" step="0.01" placeholder="Сумма, ₽"')+' '+btn(entry?'Исправить сумму':'Сохранить сумму')+'</form>':'')+
          '<form method="post">'+action(ctx,'toggle_template')+input('id',x.id,'hidden')+'<button class="btn btn-sm" type="submit">'+(num(x.active)?'Отключить':'Включить')+'</button></form></div>';
      }).join('')||'<p class="muted">Создайте первый шаблон. Затем каждый месяц останется ввести только суммы.</p>');
      body+='<p class="muted">Исправление введённой суммы фиксируется в журнале изменений. Дата операции — первый день выбранного месяца.</p>';
    }else if(p==='/admin/finance/payroll'){
      const staffOptions=Object.fromEntries(employees.map(u=>[String(u.id),u.name]));
      const extrasByEmp={},paymentByEmp={},workByEmp={};
      for(const x of t.extras)(extrasByEmp[x.employee_id]??=[]).push(x);
      for(const x of t.payments)(paymentByEmp[x.employee_id]??=[]).push(x);
      for(const x of t.work)(workByEmp[x.employee_id]??=[]).push(x);
      body+=card('Ведомость '+m,table(['Сотрудник','Работа','Доплаты','Начислено','Выплачено за месяц','Разница'],employees.map(u=>{
        const work=F.sum((workByEmp[u.id]||[]).filter(x=>x.status==='approved'));
        const extra=F.sum(extrasByEmp[u.id]||[]),paid=F.sum(paymentByEmp[u.id]||[]);
        return [e(u.name),e(money(work)),e(money(extra)),e(money(work+extra)),e(money(paid)),e(money(work+extra-paid))];
      })));
      const extraForm=(name,title)=>form(ctx,name,'<label class="field"><span>Сотрудник</span>'+select('employee_id',staffOptions)+'</label>'+field('entry_date','Дата',today(),'date',true)+field('amount','Сумма, ₽','','number',true,'min="0.01" step="0.01"')+field('comment','Причина / комментарий','','text',true),title);
      body+='<div class="finance-grid">'+card('Доплата сотруднику',extraForm('add_extra','Добавить доплату'))+card('Фактическая выплата зарплаты',extraForm('add_payment','Записать выплату'))+'</div>';
      body+='<p class="muted">Ведомость показывает операции выбранного месяца. Общая задолженность по зарплатам рассчитывается по всем периодам; выплаты не создают повторный расход в журнале клуба.</p>';
    }else return render('Финансы',body+'<p>Раздел не найден.</p>');
    return render('Финансы CF BAZA',body);
  }

  function staffShell(ctx,u,content,title='Кабинет сотрудника'){
    const tabs=[['/staff','Моя смена'],['/staff/work','Моя работа'],...(num(u.administrator)?[['/staff/revenue','Доходы и расходы'],['/staff/cash','Касса']]:[]),['/staff/payroll','Моя зарплата']];
    const nav=tabs.map(([href,label])=>'<a class="'+(ctx.path===href?'on':'')+'" href="'+href+'">'+e(label)+'</a>').join('');
    const flash=(ctx.takeFlash()||[]).map(([type,msg])=>'<div class="flash '+e(type)+'">'+e(msg)+'</div>').join('');
    ctx.res.setHeader('X-Robots-Tag','noindex, nofollow');
    return ctx.html('<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>'+e(title)+' — CF BAZA</title><link rel="stylesheet" href="/static/css/admin.css?v=finance1"></head><body><div class="staff-header"><a href="/staff"><img src="/static/img/logo-text.png" alt="CF BAZA"></a><span>'+e(u.name)+'</span><form method="post" action="/staff/logout">'+csrf(ctx)+'<button class="btn btn-sm">Выйти</button></form></div><main class="staff-main"><div class="topline"><h1>'+e(title)+'</h1></div><nav class="tabs">'+nav+'</nav>'+flash+content+'</main></body></html>');
  }
  async function authenticated(ctx){
    if(!ctx.session.staffId||!ctx.session.staffSince||Date.now()-ctx.session.staffSince>7*86400000)return null;
    const user=await getStaff(ctx.session.staffId);
    if(!user||!num(user.active)||num(ctx.session.staffVersion)!==num(user.auth_version))return null;
    return user;
  }
  async function handleStaff(ctx){
    const path=ctx.path;
    if(path==='/staff/login'){
      if(await authenticated(ctx))return ctx.redirect('/staff');
      let error='';
      if(ctx.req.method==='POST'){
        const data=(await H.parseForm(ctx.req)).fields;
        if(data.csrf!==ctx.session.csrf)return ctx.text('Сессия устарела.',400);
        const email=String(data.email||'').trim().toLowerCase();
        const password=String(data.password||'');
        const key=crypto.createHash('sha256').update(email).digest('hex').slice(0,20);
        const blocked=(await durableLimit(db,'stafflogin:'+key,8,15*60000))||(await durableLimit(db,'stafflogin-total',300,3600000));
        if(!blocked){
          const user=await db.get('SELECT * FROM staff_users WHERE email=$1 AND active=1',[email]);
          if(user&&H.checkPassword(password,user.password_hash)){
            ctx.session={staffId:user.id,staffVersion:user.auth_version,staffSince:Date.now(),csrf:crypto.randomBytes(16).toString('hex')};
            ctx.sessionDirty=true;
            return ctx.redirect('/staff');
          }
        }
        error='Неверные данные или слишком много попыток входа.';
      }
      ctx.res.setHeader('X-Robots-Tag','noindex, nofollow');
      return ctx.html('<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Вход сотрудника — CF BAZA</title><link rel="stylesheet" href="/static/css/admin.css?v=finance1"></head><body class="login"><div class="login-box"><img src="/static/img/logo-text.png" alt="CF BAZA"><h1>Кабинет сотрудника</h1>'+(error?'<p class="flash error">'+e(error)+'</p>':'')+
        form(ctx,'staff_login',field('email','Почта','','email',true)+field('password','Пароль','','password',true),'Войти')+'<p class="muted">Доступ и статусы назначает руководитель клуба.</p></div></body></html>');
    }
    const u=await authenticated(ctx);
    if(!u)return ctx.redirect('/staff/login');
    const f=ctx.req.method==='POST'?(await H.parseForm(ctx.req)).fields:null;
    if(f&&f.csrf!==ctx.session.csrf)return ctx.text('Сессия устарела. Обновите страницу.',400);
    if(path==='/staff/logout'&&f){
      ctx.session={csrf:crypto.randomBytes(16).toString('hex')};ctx.sessionDirty=true;
      return ctx.redirect('/staff/login');
    }
    if(f){
      try{
        const act=String(f.action||'');
        if(act==='staff_work'){
          await recordWork(u,f,'staff:'+u.id,false);
          ctx.flash('ok','Работа отправлена руководителю на проверку.');
        }else if(act==='staff_transaction'){
          if(!num(u.administrator))BAD('Недостаточно прав.');
          await recordTransaction(f,'staff:'+u.id,u.id,false);
          ctx.flash('ok','Операция записана и отправлена на проверку.');
        }else if(act==='staff_cash_open'){
          if(!num(u.administrator))BAD('Только администратор может открывать смену.');
          const date=F.validatePastDate(f.entry_date,31);
          const another=await db.get("SELECT id FROM cash_shifts WHERE status='open' LIMIT 1");
          if(another)BAD('Сначала закройте предыдущую кассовую смену.');
          const previous=await db.get("SELECT * FROM cash_shifts WHERE (entry_date<$1 OR (entry_date=$1 AND employee_id<>$2)) AND status<>'open' ORDER BY entry_date DESC,id DESC LIMIT 1",[date,u.id]);
          const opening=F.parseMoney(f.opening,{zero:true});
          const previousCents=previous?num(previous.closing_cents):opening;
          const delta=opening-previousCents;
          const note=String(f.note||'').trim().slice(0,350);
          if(delta!==0&&!note)BAD('При расхождении с предыдущей сменой укажите комментарий.');
          await db.run("INSERT INTO cash_shifts(employee_id,entry_date,opening_cents,opening_delta_cents,note,status,created) VALUES ($1,$2,$3,$4,$5,'open',$6)",[u.id,date,opening,delta,note,now()]);
          await audit('staff:'+u.id,'cash',u.id,'open',{date,opening,delta});
          ctx.flash('ok','Смена открыта. Начальный остаток зафиксирован.');
        }else if(act==='staff_cash_close'){
          if(!num(u.administrator))BAD('Только администратор может закрывать смену.');
          const date=F.validatePastDate(f.entry_date,31);
          const shift=await db.get("SELECT * FROM cash_shifts WHERE employee_id=$1 AND entry_date=$2 AND status='open'",[u.id,date]);
          if(!shift)BAD('Сначала откройте смену.');
          const closing=F.parseMoney(f.closing,{zero:true});
          const withdrawn=F.parseMoney(f.withdrawn||'0',{zero:true});
          const tx=await db.all("SELECT direction,amount_cents FROM finance_transactions WHERE employee_id=$1 AND entry_date=$2 AND method='cash' AND status<>'rejected'",[u.id,date]);
          const inCash=F.sum(tx.filter(x=>x.direction==='income'));
          const outCash=F.sum(tx.filter(x=>x.direction==='expense'));
          const expected=num(shift.opening_cents)+inCash-outCash-withdrawn;
          if(expected<0)BAD('Выдача наличных превышает доступную кассу.');
          const diff=closing-expected;
          const note=String(f.note||'').trim().slice(0,350);
          if(diff!==0&&!note&&!shift.note)BAD('Если касса не сошлась, укажите комментарий.');
          await db.run("UPDATE cash_shifts SET closing_cents=$1,withdrawn_cents=$2,expected_cents=$3,difference_cents=$4,note=$5,status='pending' WHERE id=$6",
            [closing,withdrawn,expected,diff,[shift.note,note].filter(Boolean).join(' | '),shift.id]);
          await audit('staff:'+u.id,'cash',shift.id,'close',{expected,closing,diff,withdrawn});
          ctx.flash('ok','Касса закрыта. Сверка отправлена руководителю.');
        }else if(act==='staff_password'){
          const old=String(f.old||''),pwd=String(f.password||'');
          if(!H.checkPassword(old,u.password_hash)||pwd.length<12)BAD('Проверьте старый пароль. Новый — минимум 12 символов.');
          await db.run('UPDATE staff_users SET password_hash=$1,auth_version=auth_version+1 WHERE id=$2',[H.hashPassword(pwd),u.id]);
          await audit('staff:'+u.id,'employee',u.id,'change_password',{});
          ctx.session={csrf:crypto.randomBytes(16).toString('hex')};ctx.sessionDirty=true;
          return ctx.redirect('/staff/login');
        }else BAD('Неизвестное действие.');
      }catch(err){
        console.error('finance staff form:',err.message);
        ctx.flash('error',/UNIQUE|unique|duplicate/i.test(err.message)?'На эту дату такая кассовая смена уже создана.':err.message);
      }
      return ctx.redirect(path);
    }
    const range=F.monthRange(F.validMonth(ctx.url.searchParams.get('month'))?ctx.url.searchParams.get('month'):today().slice(0,7));
    const work=await db.all('SELECT * FROM staff_work WHERE employee_id=$1 AND work_date >= $2 AND work_date < $3 ORDER BY work_date DESC,id DESC',[u.id,...range]);
    const extras=await db.all('SELECT * FROM payroll_extras WHERE employee_id=$1 AND entry_date >= $2 AND entry_date < $3',[u.id,...range]);
    const payouts=await db.all('SELECT * FROM payroll_payments WHERE employee_id=$1 AND pay_date >= $2 AND pay_date < $3',[u.id,...range]);
    const summary=F.payroll(work,extras,payouts);
    const ownNames={[u.id]:u.name};
    if(path==='/staff'||path==='/staff/'){
      let content=tiles([[money(summary.earned),'Начислено за месяц','/staff/payroll'],[money(summary.paid),'Выплачено за месяц','/staff/payroll'],[String(work.filter(x=>x.status==='pending').length),'Работ на проверке','/staff/work']]);
      content+='<div class="finance-grid">'+card('Быстрый учёт работы',workForm(ctx,null,u))+
        (num(u.administrator)?card('Дневная выручка',transactionForm(ctx,false,'income'))+card('Расходы',transactionForm(ctx,false,'expense')):'')+'</div>';
      content+='<p class="muted">Администратору сначала нужно открыть смену в разделе <a href="/staff/cash">Касса</a>. Рабочие записи попадут в зарплату после проверки руководителем.</p>';
      return staffShell(ctx,u,content,'Моя смена');
    }
    if(path==='/staff/work'){
      return staffShell(ctx,u,card('Добавить проведённую работу',workForm(ctx,null,u))+card('Мои записи',workRows(work,ownNames,ctx)),'Моя работа');
    }
    if(path==='/staff/revenue'&&num(u.administrator)){
      const tx=await db.all('SELECT * FROM finance_transactions WHERE employee_id=$1 AND entry_date >= $2 AND entry_date < $3 ORDER BY entry_date DESC,id DESC',[u.id,...range]);
      const revenue=F.sum(tx.filter(x=>x.direction==='income'&&x.status!=='rejected'));
      const spent=F.sum(tx.filter(x=>x.direction==='expense'&&x.status!=='rejected'));
      return staffShell(ctx,u,tiles([[money(revenue),'Внесено доходов','/staff/revenue'],[money(spent),'Внесено расходов','/staff/revenue']])+
        card('Добавить доход',transactionForm(ctx,false,'income'))+card('Добавить расход',transactionForm(ctx,false,'expense'))+card('Мои операции',transactionRows(tx,ctx)),'Доходы и расходы');
    }
    if(path==='/staff/cash'&&num(u.administrator)){
      const shifts=await db.all('SELECT * FROM cash_shifts WHERE employee_id=$1 ORDER BY entry_date DESC,id DESC LIMIT 25',[u.id]);
      const open=shifts.find(x=>x.status==='open');
      const previous=await db.get("SELECT * FROM cash_shifts WHERE status<>'open' ORDER BY entry_date DESC,id DESC LIMIT 1");
      const closed=shifts.map(x=>[dateText(x.entry_date),money(x.opening_cents),x.status==='open'?'—':money(x.expected_cents),x.status==='open'?'—':money(x.closing_cents),x.status==='open'?'—':money(x.difference_cents),status(x.status)]);
      let content=card('Касса наличных',previous?'<p>Последняя зафиксированная касса: <b>'+money(previous.closing_cents)+'</b> ('+dateText(previous.entry_date)+'). Сравните с фактическим началом своей смены.</p>':'<p>Предыдущих закрытых смен нет. Укажите фактическую наличность.</p>');
      if(!open){
        content+=card('Открыть смену',form(ctx,'staff_cash_open',field('entry_date','Дата смены',today(),'date',true)+field('opening','Фактически в кассе на начало, ₽','','number',true,'min="0" step="0.01"')+
          field('note','Комментарий при расхождении с предыдущей сменой'), 'Открыть кассу'));
      }else{
        content+=card('Закрыть смену · '+dateText(open.entry_date),form(ctx,'staff_cash_close',input('entry_date',open.entry_date,'hidden')+
          '<p>Начальный остаток: <b>'+money(open.opening_cents)+'</b></p>'+
          field('closing','Наличные в кассе при закрытии, ₽','','number',true,'min="0" step="0.01"')+
          field('withdrawn','Передано из кассы (не расход клуба), ₽','0','number',true,'min="0" step="0.01"')+
          field('note','Комментарий при расхождении'), 'Закрыть и отправить на сверку'));
      }
      content+=card('Мои кассовые смены',table(['Дата','Начало','Ожидалось','Факт','Расхождение','Состояние'],closed));
      return staffShell(ctx,u,content,'Сверка кассы');
    }
    if(path==='/staff/payroll'){
      const rate=await getRates(u.id);
      const rates=table(['Вид','Твоя ставка'],Object.entries(F.TYPES).filter(([key])=>key.startsWith('training')?num(u.trainer):num(u.administrator)).map(([key,name])=>[e(name),Object.prototype.hasOwnProperty.call(rate,key)?money(rate[key]):'Не задана']));
      const extrasTable=table(['Дата','Доплата','Комментарий'],extras.map(x=>[dateText(x.entry_date),money(x.amount_cents),e(x.comment)]));
      const payTable=table(['Дата','Выплата','Комментарий'],payouts.map(x=>[dateText(x.pay_date),money(x.amount_cents),e(x.comment)]));
      return staffShell(ctx,u,tiles([[money(summary.earned),'Начислено за месяц','/staff/payroll'],[money(summary.paid),'Выплачено за месяц','/staff/payroll'],[money(summary.due),'Разница за месяц','/staff/payroll']])+
        card('Мои ставки',rates)+card('Моя работа',workRows(work,ownNames,ctx))+card('Доплаты',extrasTable)+card('Выплаты',payTable)+
        card('Сменить пароль',form(ctx,'staff_password',field('old','Старый пароль','','password',true)+field('password','Новый пароль (от 12 символов)','','password',true),'Сменить пароль')),
        'Моя зарплата');
    }
    return ctx.text('Страница не найдена.',404);
  }
  return {init,manage,handleStaff,dashboardMini};
}
module.exports={createFinance};
