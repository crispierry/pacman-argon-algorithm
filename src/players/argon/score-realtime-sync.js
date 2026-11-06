

function canonical(value, stack=new Set()) {
 if(value===null)return 'null';
 const type=typeof value;
 if(type==='undefined')return 'undefined';
 if(type==='boolean')return value?'true':'false';
 if(type==='string')return JSON.stringify(value);
 if(type==='number'){
  if(Number.isNaN(value))return 'number:NaN';
  if(value===Infinity)return 'number:Infinity';
  if(value===-Infinity)return 'number:-Infinity';
  if(Object.is(value,-0))return 'number:-0';
  return `number:${value}`;
 }
 if(type==='bigint')return `bigint:${value}`;
 if(type!=='object')throw TypeError('Unsupported state value');
 if(stack.has(value))throw TypeError('Circular state value');
 stack.add(value);
 let result;
 if(Array.isArray(value))result=`array:[${Array.from({length:value.length},(_,i)=>i in value?canonical(value[i],stack):'hole').join(',')}]`;
 else if(value instanceof Map)result=`map:[${[...value].map(([k,v])=>`[${canonical(k,stack)},${canonical(v,stack)}]`).join(',')}]`;
 else if(value instanceof Set)result=`set:[${[...value].map(v=>canonical(v,stack)).join(',')}]`;
 else if(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null)
  result=`object:{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k],stack)}`).join(',')}}`;
 else throw TypeError('Unsupported state object');
 stack.delete(value);return result;
}
export function canonicalStateKey(state){



 const {events,eventId,accumulator,pauseReason,...game}=state;
 return canonical(game);
}
export function canonicalLedgerKey(ledger){return canonical(ledger);}

export function eventSignatures(events){return events.map(({id,...event})=>structuredClone(typeof id==='number'?event:{...event,id}));}

const inputs=new Set([null,'neutral','up','left','down','right']);
function validRecord(record,tick){
 return record&&record.tick===tick&&inputs.has(record.input)&&
  ['preStateKey','postStateKey','preLedgerKey','postLedgerKey'].every(k=>typeof record[k]==='string')&&Array.isArray(record.eventSignatures);
}
function validRecords(reply){
 const records=reply.records;
 if(!Array.isArray(records)||!records.length)return false;
 for(let i=0;i<records.length;i++){
  const record=records[i];
  if(!validRecord(record,reply.anchorTick+i))return false;
  try{canonical(record.eventSignatures);}catch{return false;}
  if(i===0&&(record.preStateKey!==reply.anchorStateKey||record.preLedgerKey!==reply.anchorLedgerKey))return false;
  if(i>0&&(records[i-1].postStateKey!==record.preStateKey||records[i-1].postLedgerKey!==record.preLedgerKey))return false;
 }
 return true;
}
function actualMatches(expected,actual){
 if(!validRecord(actual,expected.tick))return false;
 let eventsMatch;try{eventsMatch=canonical(actual.eventSignatures)===canonical(expected.eventSignatures);}catch{return false;}
 return actual.input===expected.input&&
  actual.preStateKey===expected.preStateKey&&actual.postStateKey===expected.postStateKey&&
  actual.preLedgerKey===expected.preLedgerKey&&actual.postLedgerKey===expected.postLedgerKey&&
  eventsMatch;
}



export function createRealtimeSync({sessionId,boardId}){
 if(sessionId==null||boardId==null)throw TypeError('Session and board IDs are required');
 let generation=0,nextId=0,pending=null,staged=null,rejected=0,activated=0;
 const sameContext=current=>current&&current.sessionId===sessionId&&current.boardId===boardId&&Number.isSafeInteger(current.tick)&&current.tick>=0;
 function reject(reason){rejected++;return {status:'rejected',reason};}
 function evaluate(reply,current){
  if(!sameContext(current))return reject('context');
  if(current.tick<reply.anchorTick)return {status:'staged'};
  const offset=current.tick-reply.anchorTick;
  if(offset>=reply.records.length)return reject('no-remaining-input');
  const target=reply.records[offset];
  if(current.stateKey!==target.preStateKey||current.ledgerKey!==target.preLedgerKey)return reject('checkpoint');
  if(offset>0){
   if(!Array.isArray(current.history))return reject('missing-history');
   const history=new Map();
   for(const item of current.history){if(history.has(item.tick))return reject('duplicate-history');history.set(item.tick,item);}
   for(let i=0;i<offset;i++)if(!actualMatches(reply.records[i],history.get(reply.anchorTick+i)))return reject('history-mismatch');
  }
  activated++;return {status:'activate',plan:structuredClone(reply),offset};
 }
 return {
  get generation(){return generation;},
  begin(request){
   if(pending||staged)return null;
   if(!request||!Number.isSafeInteger(request.observedTick)||!Number.isSafeInteger(request.anchorTick)||
      !Number.isSafeInteger(request.replyByTick)||request.observedTick<0||request.observedTick>request.anchorTick||request.replyByTick<request.observedTick||
      typeof request.anchorStateKey!=='string'||typeof request.anchorLedgerKey!=='string')throw TypeError('Invalid plan request');
   pending={...structuredClone(request),sessionId,boardId,generation,requestId:++nextId};
   return structuredClone(pending);
  },
  receive(reply,current){
   if(!pending||!reply||reply.sessionId!==sessionId||reply.boardId!==boardId||reply.generation!==generation||reply.requestId!==pending.requestId)return reject('stale');
   if(reply.anchorTick!==pending.anchorTick||reply.replyByTick!==pending.replyByTick||reply.anchorStateKey!==pending.anchorStateKey||reply.anchorLedgerKey!==pending.anchorLedgerKey){pending=null;return reject('anchor');}
   if(!sameContext(current)){pending=null;return reject('context');}
   if(current.tick>pending.replyByTick){pending=null;return reject('deadline');}
   if(!validRecords(reply)){pending=null;return reject('invalid-records');}
   pending=null;
   const result=evaluate(reply,current);
   if(result.status==='staged')staged=structuredClone(reply);
   return result;
  },
  atTick(current){
   if(!sameContext(current))return reject('context');
   if(pending&&current.tick>pending.replyByTick){const requestId=pending.requestId;pending=null;return {status:'expired',requestId};}
   if(!staged)return {status:'waiting'};
   if(current.tick<staged.anchorTick)return {status:'staged'};
   const reply=staged;staged=null;return evaluate(reply,current);
  },
  fail(requestId,reason='worker-error'){
   if(!pending||pending.requestId!==requestId)return false;
   pending=null;return {status:'failed',reason};
  },
  invalidate(reason='override'){
   const cancelRequestId=pending?.requestId??null;
   generation++;pending=null;staged=null;return {generation,reason,cancelRequestId};
  },
  reset(next){
   if(!next||next.sessionId==null||next.boardId==null)throw TypeError('Session and board IDs are required');
   const cancelRequestId=pending?.requestId??null;
   sessionId=next.sessionId;boardId=next.boardId;generation++;pending=null;staged=null;
   return {generation,cancelRequestId};
  },
  diagnostics(){return {sessionId,boardId,generation,pendingRequestId:pending?.requestId??null,staged:!!staged,rejected,activated};}
 };
}
