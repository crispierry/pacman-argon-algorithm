import {collectibles} from './maze.js';
import {rulesForLevel} from './rules.js';

const ghosts=new Set(['blinky','pinky','inky','clyde']);
const scoringEvents=new Set(['dot','power','fruit','ghost']);

function newBoard(state,fullHistory){
 const level=state.level;
 if(level===256)return {level,scope:'split-unsupported',points:0,cleared:false,fruit:[],energizers:[],activeFruit:null,activeEnergizer:null,collectiblesRemaining:state.pellets?.size??null,optimisticBoardTotal:null};
 const eligible=rulesForLevel(level).powerSeconds>0,initial=collectibles();
 const energizers=[...initial].filter(([,v])=>v==='o').map(([position])=>({id:`${level}:${position}`,position,eligible,
  status:fullHistory?'pending':state.pellets?.has(position)?'pending':'unknown',captures:[],distinctIds:[],lossReason:null}));
 const fruit=[70,170].map((trigger,i)=>({id:`${level}:fruit-${trigger}`,trigger,status:fullHistory||!state.fruitTriggered?.[i]?'pending':'unknown',lossReason:null}));
 let activeFruit=null;
 if(!fullHistory&&state.fruit){
  const i=state.fruitTriggered?.[1]?1:state.fruitTriggered?.[0]?0:-1;
  if(i>=0){fruit[i].status='active';activeFruit=fruit[i].id;}
 }
 return {level,scope:'normal',points:0,cleared:false,fruit,energizers,activeFruit,activeEnergizer:null,collectiblesRemaining:state.pellets?.size??null,optimisticBoardTotal:null};
}

function updateCeiling(ledger,state){
 const board=ledger.board;
 if(ledger.completeness!=='complete-history'||board.scope!=='normal'||state.level!==board.level||!(state.pellets instanceof Map)){
  board.optimisticBoardTotal=null;return;
 }
 let remaining=0;
 for(const value of state.pellets.values())remaining+=value==='o'?50:value==='.'?10:0;
 for(const fruit of board.fruit)if(fruit.status==='pending'||fruit.status==='active')remaining+=rulesForLevel(board.level).fruit.points;
 for(const power of board.energizers){
  if(!power.eligible)continue;
  if(power.status==='pending')remaining+=3000;
  else if(power.status==='active')remaining+=power.invalidCapture?3000:Math.max(0,3000-power.captures.reduce((n,c)=>n+c.points,0));
 }
 board.optimisticBoardTotal=board.points+remaining;
}










export function createObligationLedger(initialState,{snapshot=null,historyComplete}={}){
 if(!initialState||!Number.isInteger(initialState.level)||!Number.isSafeInteger(initialState.eventId))throw new TypeError('An engine state with level and eventId is required');
 const fresh=initialState.level===1&&initialState.levelDotsEaten===0&&initialState.score===0&&!initialState.fruit&&initialState.power===0;
 const complete=historyComplete===false?false:fresh;
 const data=snapshot?structuredClone(snapshot):{version:1,pointsEarned:0,deaths:0,lastObservedEventId:0,
  completeness:complete?'complete-history':'partial-history',losses:[],pastBoards:[],board:newBoard(initialState,complete),perfectStillPossible:complete?true:null};
 const markPartial=()=>{data.completeness='partial-history';};
 const loss=(kind,id,reason,tick)=>{
  if(!data.losses.some(x=>x.kind===kind&&x.id===id))data.losses.push({level:data.board.level,kind,id,reason,tick});
 };
 const closeFruit=(reason,tick)=>{
  const item=data.board.fruit.find(x=>x.id===data.board.activeFruit);
  if(item&&item.status==='active'){item.status='lost';item.lossReason=reason;item.closedTick=tick;loss('fruit',item.id,reason,tick);}
  data.board.activeFruit=null;
 };
 const closeChain=(reason,tick)=>{
  const item=data.board.energizers.find(x=>x.id===data.board.activeEnergizer);
  if(item&&item.status==='active'){
   if(item.distinctIds.length===4&&!item.invalidCapture)item.status='complete';
   else{item.status='lost';item.lossReason=item.invalidCapture?'invalid-capture-sequence':reason;loss('energizer',item.id,item.lossReason,tick);}
   item.closedTick=tick;
  }
  data.board.activeEnergizer=null;
 };
 const expireOutstanding=(reason,tick)=>{
  closeFruit(reason,tick);closeChain(reason,tick);
  for(const item of [...data.board.fruit,...data.board.energizers]){
   if(item.status==='pending'){item.status='lost';item.lossReason=reason;item.closedTick=tick;loss(item.trigger?'fruit':'energizer',item.id,reason,tick);}
  }
 };
 const observe=(events,state,tick=null)=>{
  if(!Array.isArray(events)||!state||!Number.isSafeInteger(state.eventId))throw new TypeError('Supply the full event batch and post-batch state');
  const start=state.eventId-events.length+1;
  if(events.length&&start<1)throw new RangeError('Event batch is inconsistent with state.eventId');
  for(let i=0;i<events.length;i++){
   const event=events[i],id=start+i;
   if(typeof event.id==='number'&&event.id!==id)throw new RangeError('Event batch is not contiguous');
   if(event.type!=='fruit-spawn'&&typeof event.id!=='number')throw new TypeError('Event has no numeric engine id');
  }
  if(events.length&&start>data.lastObservedEventId+1)markPartial();
  if(!events.length&&state.eventId>data.lastObservedEventId)markPartial();
  for(let i=0;i<events.length;i++){
   const event=events[i],id=start+i;
   if(id<=data.lastObservedEventId)continue;
   data.lastObservedEventId=id;
   if(event.type==='level'&&event.level!==data.board.level){
    data.pastBoards.push(data.board);const full=data.completeness==='complete-history'&&state.level===event.level;
    data.board=newBoard(state,full);
    if(data.board.scope!=='normal')markPartial();
   }
   const board=data.board;
   if(scoringEvents.has(event.type)){
    const points=Number.isFinite(event.points)?event.points:0;data.pointsEarned+=points;board.points+=points;
   }
   if(board.scope!=='normal'){if(event.type==='death')data.deaths++;continue;}
   if(event.type==='fruit-spawn'){
    if(board.activeFruit)closeFruit('replaced',tick);
    const item=board.fruit.find(x=>x.status==='pending');
    if(item){item.status='active';item.spawnTick=tick;board.activeFruit=item.id;}else markPartial();
   }else if(event.type==='fruit'){
    const item=board.fruit.find(x=>x.id===board.activeFruit);
    if(item&&item.status==='active'){item.status='collected';item.collectedTick=tick;board.activeFruit=null;}else markPartial();
   }else if(event.type==='fruit-expire'){
    if(board.activeFruit)closeFruit('expired',tick);else markPartial();
   }else if(event.type==='power'||event.type==='dot'&&event.energizer){
    if(board.activeEnergizer)closeChain('superseded',tick);
    const position=`${event.x},${event.y}`,item=board.energizers.find(x=>x.position===position);
    if(!item||item.status!=='pending'){markPartial();continue;}
    item.activationTick=tick;
    if(event.type==='power'&&item.eligible){item.status='active';board.activeEnergizer=item.id;}
    else if(!item.eligible){item.status='complete';item.closedTick=tick;}
    else markPartial();
   }else if(event.type==='ghost'){
    const item=board.energizers.find(x=>x.id===board.activeEnergizer);
    if(!item||item.status!=='active'||!ghosts.has(event.idGhost)){markPartial();continue;}
    const expected=[200,400,800,1600][item.captures.length];
    if(item.distinctIds.includes(event.idGhost)||event.points!==expected){
     item.invalidCapture=true;loss('energizer',item.id,'invalid-capture-sequence',tick);
    }
    item.captures.push({ghostId:event.idGhost,points:event.points??0,tick});
    if(!item.distinctIds.includes(event.idGhost))item.distinctIds.push(event.idGhost);
    if(item.distinctIds.length===4&&!item.invalidCapture){item.status='complete';item.completedTick=tick;}
   }else if(event.type==='power-end'){
    if(board.activeEnergizer)closeChain('expired',tick);
   }else if(event.type==='death'){
    data.deaths++;loss('death',`death:${id}`,'death',tick);closeFruit('death',tick);closeChain('death',tick);
   }else if(event.type==='clear'){
    board.cleared=true;board.collectiblesRemaining=0;expireOutstanding('board-cleared',tick);
    board.optimisticBoardTotal=data.completeness==='complete-history'?board.points:null;
   }
  }
  if(!events.length&&state.eventId>data.lastObservedEventId)data.lastObservedEventId=state.eventId;
  data.board.collectiblesRemaining=state.pellets?.size??null;
  data.perfectStillPossible=data.losses.length?false:data.completeness==='complete-history'?true:null;
  updateCeiling(data,state);
 };
 if(!snapshot)updateCeiling(data,initialState);
 return {observe,snapshot:()=>structuredClone(data)};
}
