'use strict';
// CF BAZA internal personnel and financial ledger. All monetary values are integer kopecks.
const TYPES = Object.freeze({
  training_low:'Тренировка: 1–9 человек',
  training_high:'Тренировка: 10+ человек',
  cleaning_hour:'Ежедневная уборка (час)',
  general:'Генеральная уборка',
  vacuum:'Пылесос',
  equipment:'Оборудование (пятница)'
});
const WORK_LABELS = Object.freeze({
  training:'Тренировка', cleaning:'Ежедневная уборка',
  general:'Генеральная уборка', vacuum:'Пылесос', equipment:'Оборудование'
});
const METHODS = Object.freeze({cash:'Наличные',terminal:'Безналичные',transfer:'Перевод на карту'});
const INCOME = Object.freeze({membership:'Абонементы',single:'Разовые занятия',coffee:'Кофе',isotonic:'Изотоник',water:'Вода',other:'Прочие доходы'});
const EXPENSE = Object.freeze({utility:'Коммунальные',rent:'Аренда',supplies:'Хозяйственные',equipment:'Оборудование',repairs:'Ремонт',unexpected:'Непредвиденные',other:'Прочие расходы'});
const formatMoney = cents => (Number(cents||0)/100).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₽';
function parseMoney(value, {zero=false}={}){
  const s=String(value??'').trim().replace(',','.');
  if(!/^\d{1,9}(\.\d{1,2})?$/.test(s))throw Error('Введите сумму в рублях, до двух знаков после запятой.');
  const [whole,fraction='']=s.split('.');
  const cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  if(!Number.isSafeInteger(cents)||cents>100000000000||(!zero&&cents===0))throw Error('Сумма должна быть больше нуля.');
  return cents;
}
function number(value,max=10000){
  const n=Number(value);
  if(!/^\d+$/.test(String(value))||!Number.isInteger(n)||n<0||n>max)throw Error('Некорректное количество.');
  return n;
}
function validDate(s){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(s)))return false;
  const d=new Date(s+'T12:00:00Z');
  return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===s;
}
function validMonth(s){return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s));}
function monthRange(month){
  if(!validMonth(month))throw Error('Неверный месяц.');
  const [y,m]=month.split('-').map(Number);
  return [month+'-01',new Date(Date.UTC(y,m,1)).toISOString().slice(0,10)];
}
function todayIrkutsk(){return new Date(Date.now()+8*3600000).toISOString().slice(0,10);}
function validatePastDate(date,days=180){
  if(!validDate(date)||date>todayIrkutsk()||date<new Date(Date.now()+8*3600000-days*86400000).toISOString().slice(0,10))
    throw Error('Дата должна быть сегодняшней или прошедшей (не старше '+days+' дней).');
  return date;
}
function rateType(kind,attendance){
  if(kind==='training')return number(attendance,300)>=10?'training_high':'training_low';
  if(kind==='cleaning')return 'cleaning_hour';
  if(!Object.prototype.hasOwnProperty.call(TYPES,kind))throw Error('Неизвестный вид работы.');
  return kind;
}
function calculateWork({kind,attendance=0,minutes=0,quantity=1,rateCents=0,date}){
  const rate=number(rateCents,100000000000);
  if(kind==='training'){
    const count=number(attendance,300);
    if(count===0)throw Error('Укажите количество участников.');
    return {rateType:rateType(kind,count),units:1,amountCents:rate};
  }
  if(kind==='cleaning'){
    const duration=number(minutes,1440);
    if(duration===0)throw Error('Укажите количество минут уборки.');
    return {rateType:'cleaning_hour',units:duration,amountCents:Math.round(rate*duration/60)};
  }
  if(kind==='equipment'&&new Date(date+'T12:00:00Z').getUTCDay()!==5)throw Error('Работа с оборудованием учитывается по пятницам.');
  const units=number(quantity,100);
  if(units===0)throw Error('Укажите количество выполненных работ.');
  return {rateType:rateType(kind),units,amountCents:rate*units};
}
function sum(rows,field='amount_cents'){return rows.reduce((acc,r)=>acc+Number(r[field]||0),0);}
function payroll(work,extras,payments){
  const earned=sum(work.filter(x=>x.status==='approved'))+sum(extras);
  const paid=sum(payments);
  return {earned,paid,due:earned-paid};
}
module.exports={TYPES,WORK_LABELS,METHODS,INCOME,EXPENSE,formatMoney,parseMoney,number,validDate,validMonth,monthRange,todayIrkutsk,validatePastDate,rateType,calculateWork,sum,payroll};
