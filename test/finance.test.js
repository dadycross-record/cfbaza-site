'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const F=require('../lib/finance-core');
test('training threshold 10 inclusive',()=>{
  assert.equal(F.rateType('training',9),'training_low');
  assert.equal(F.rateType('training',10),'training_high');
  assert.equal(F.rateType('training',11),'training_high');
});
test('hourly cleaning proportional, integer kopecks',()=>{
  assert.equal(F.calculateWork({kind:'cleaning',minutes:90,rateCents:20000,date:'2026-11-16'}).amountCents,30000);
});
test('equipment only Friday',()=>{
  assert.equal(F.calculateWork({kind:'equipment',quantity:1,rateCents:30000,date:'2026-11-20'}).amountCents,30000);
  assert.throws(()=>F.calculateWork({kind:'equipment',quantity:1,rateCents:30000,date:'2026-11-19'}));
});
test('money and date validation',()=>{
  assert.equal(F.parseMoney('125,50'),12550);
  assert.equal(F.parseMoney('0',{zero:true}),0);
  assert.throws(()=>F.parseMoney('-1'));
  assert.throws(()=>F.parseMoney('1.123'));
  assert.equal(F.validDate('2026-02-29'),false);
  assert.equal(F.validDate('2024-02-29'),true);
  assert.deepEqual(F.monthRange('2026-12'),['2026-12-01','2027-01-01']);
});
test('payroll excludes pending and rejected entries',()=>{
 const work=[{status:'approved',amount_cents:80000},{status:'pending',amount_cents:30000},{status:'rejected',amount_cents:40000}];
 assert.deepEqual(F.payroll(work,[{amount_cents:10000}],[{amount_cents:20000}]),{earned:90000,paid:20000,due:70000});
});
