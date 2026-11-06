import {drainEvents,requestDirection,step} from './game.js';
import {canEnter,key,neighbor} from './maze.js';
import {STEP} from './rules.js';
import {completionFingerprint} from './completion-fingerprint.js';

const DIRS=['up','left','down','right'],INPUTS=[null,...DIRS,'neutral'];
const anchor=s=>s.player.next??{x:Math.round(s.player.x),y:Math.round(s.player.y)};
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const region=p=>`${p.x<14?'left':'right'}:${p.y<15?'upper':'lower'}`;
const danger=s=>Math.min(40,...s.ghosts.filter(g=>g.status==='active'&&!g.frightened).map(g=>distance(g,s.player)));









export function createCleanupSearch(entry,{ledger=null,width=32,chunkTicks=8,routeTicks=32,maxDepth=240,recordCheckpoints=true}={}){
 for(const n of [width,chunkTicks,routeTicks,maxDepth])if(!Number.isSafeInteger(n)||n<1)throw RangeError('Invalid cleanup bounds');
 if(typeof recordCheckpoints!=='boolean')throw TypeError('Invalid checkpoint recording option');
 const root=structuredClone(entry);root.accumulator=0;drainEvents(root);
 const proven=ledger?.completeness==='complete-history'&&ledger.board?.fruit?.length===2&&ledger.board.fruit.every(f=>f.status==='collected')&&ledger.board?.energizers?.length===4&&ledger.board.energizers.every(e=>!e.eligible||e.status==='complete'&&new Set(e.distinctIds).size===4);
 const invalid=entry.mazeVariant!=='normal'||!['playing','capture'].includes(entry.phase)||entry.fruit||(entry.power>0||entry.phase==='capture')&&!proven||![true,true].every((v,i)=>entry.fruitTriggered?.[i]===v)||[...entry.pellets.values()].includes('o')||ledger&&!proven;
 const graph=new Map(),reverse=new Map(),fields=new Map();
 for(let y=entry.mazeVariant==='split-256'?-1:0;y<=30;y++)for(let x=-2;x<=29;x++){
  if(!canEnter(x,y,'player',entry.mazeVariant))continue;const k=key(x,y),edges=[];
  for(const direction of DIRS){const n=neighbor(x,y,direction,'player',entry.mazeVariant);if(n)edges.push({direction,to:key(n.x,n.y),point:n});}
  graph.set(k,edges);for(const edge of edges){if(!reverse.has(edge.to))reverse.set(edge.to,[]);reverse.get(edge.to).push(k);}
 }
 function targetField(targets){
  const id=[...targets].sort().join(';');if(fields.has(id))return fields.get(id);
  const queue=[...targets],field=new Map(queue.map(k=>[k,0]));
  for(let i=0;i<queue.length;i++)for(const from of reverse.get(queue[i])??[])if(!field.has(from)){field.set(from,field.get(queue[i])+1);queue.push(from);}


  if(targets.length===1)fields.set(id,field);return field;
 }
 function route(s,target){
  const p=anchor(s),field=targetField([key(target.x,target.y)]);
  if(field.get(key(p.x,p.y))===0)return s.player.dir;
  let best=null;for(const edge of graph.get(key(p.x,p.y))??[]){const d=field.get(edge.to);if(d!==undefined&&(!best||d<best.d))best={direction:edge.direction,d};}
  return best?.direction??null;
 }
 function nearest(s){const p=anchor(s);return targetField([...s.pellets.keys()]).get(key(p.x,p.y))??10000;}
 function rank(n){return [root.pellets.size-n.state.pellets.size,-n.nearest,danger(n.state)];}
 function compare(a,b){const x=rank(a),y=rank(b);for(let i=0;i<x.length;i++)if(x[i]!==y[i])return y[i]-x[i];return 0;}
 function maneuvers(node){
  const s=node.state,candidates=INPUTS.map(input=>({input,ticks:chunkTicks,region:'primitive'}));
  const groups=new Map(),p=anchor(s);
  for(const coordinate of s.pellets.keys()){
   const [x,y]=coordinate.split(',').map(Number),target={x,y},field=targetField([coordinate]),d=field.get(key(p.x,p.y));if(d===undefined)continue;
   const id=region(target),old=groups.get(id);if(!old||d<old.distance)groups.set(id,{target,distance:d});
  }
  for(const [id,{target}] of groups)candidates.push({target,ticks:routeTicks,region:id});


  const retreats=[];for(const [coordinate,edges]of graph){if(edges.length<3)continue;const [x,y]=coordinate.split(',').map(Number),target={x,y},d=targetField([coordinate]).get(key(p.x,p.y));if(d===undefined||d>8||d<2)continue;
   const clearance=Math.min(40,...s.ghosts.filter(g=>g.status==='active'&&!g.frightened).map(g=>distance(g,target)));retreats.push({target,d,clearance});}
  retreats.sort((a,b)=>b.clearance-a.clearance||a.d-b.d);for(const r of retreats.slice(0,2))candidates.push({target:r.target,ticks:routeTicks,region:'retreat'});
  return candidates;
 }
 const initial={state:root,parent:null,segment:null,depth:0,ticks:0,first:'root',region:'root',nearest:nearest(root)};
 let frontier=[initial],next=[],nodeIndex=0,actions=null,actionIndex=0,job=null,totalWork=0,expanded=0,rejected=0,depth=0,terminal=null,exhausted=false,bestRemaining=root.pellets.size;
 function finishWitness(node){
  const segments=[];for(let n=node;n?.segment;n=n.parent)segments.push(n.segment);segments.reverse();
  return {status:'complete-clear',inputs:segments.flatMap(s=>s.inputs),checkpoints:segments.flatMap(s=>s.checkpoints),events:segments.flatMap(s=>s.events),state:node.state,elapsedTicks:node.ticks,durationTicks:node.ticks,conditional:true};
 }
 function chooseLayer(){
  next.sort(compare);const chosen=[],buckets=new Set();


  for(const n of next){const b=`${n.first}:${n.region}:${n.state.player.dir}`;if(buckets.has(b))continue;buckets.add(b);chosen.push(n);if(chosen.length===width)break;}
  frontier=[...chosen,...next.filter(n=>!chosen.includes(n))].slice(0,width);next=[];nodeIndex=0;actions=null;actionIndex=0;depth++;
  if(!frontier.length||depth>=maxDepth)exhausted=true;
 }
 function summary(status,work,extra={}){return {status,work,totalWork,expanded,rejected,depth,bestRemaining,frontierSize:frontier.length+next.length,partialJobTicks:job?.elapsed??0,...extra};}
 return {
  run(workBudget){
   if(!Number.isSafeInteger(workBudget)||workBudget<1)throw RangeError('Invalid cleanup work budget');
   if(invalid)return summary('ineligible',0,{reason:'unsettled-cleanup-obligations'});
   if(terminal)return summary('complete-clear',0,structuredClone(terminal));
   let work=0;
   while(work<workBudget&&!exhausted){
    if(!job){
     if(nodeIndex>=frontier.length){chooseLayer();continue;}
     const node=frontier[nodeIndex];actions??=maneuvers(node);
     if(actionIndex>=actions.length){nodeIndex++;actions=null;actionIndex=0;continue;}
     const action=actions[actionIndex++],state=structuredClone(node.state);state.accumulator=0;drainEvents(state);expanded++;
     job={node,action,state,elapsed:0,inputs:[],checkpoints:[],events:[]};
    }
    const j=job,tick=j.node.ticks+j.elapsed,fingerprint=recordCheckpoints?completionFingerprint(j.state):undefined;
    let input=null;if(j.action.target&&j.elapsed%8===0&&j.state.phase==='playing')input=route(j.state,j.action.target);else if(!j.action.target&&j.elapsed===0)input=j.action.input;
    if(input!==null){j.inputs.push({tick,direction:input,...(recordCheckpoints?{fingerprint}:{})});requestDirection(j.state,input);}
    if(recordCheckpoints)j.checkpoints.push({tick,fingerprint});step(j.state,STEP);work++;totalWork++;j.elapsed++;
    const events=drainEvents(j.state);j.events.push(...events.map(e=>({...e,tick})));
    const lost=events.some(e=>['death','fruit-expire','power'].includes(e.type))||['dying','game-over'].includes(j.state.phase);
    if(lost){rejected++;job=null;continue;}
    const clear=events.some(e=>e.type==='clear');
    if(clear||j.elapsed>=j.action.ticks){
     const node={state:j.state,parent:j.node,segment:{inputs:j.inputs,checkpoints:j.checkpoints,events:j.events},depth:j.node.depth+1,ticks:j.node.ticks+j.elapsed,
      first:j.node.depth===0?(j.action.target?route(j.node.state,j.action.target):j.action.input)??'hold':j.node.first,region:j.action.region,nearest:nearest(j.state)};
     bestRemaining=Math.min(bestRemaining,node.state.pellets.size);job=null;
     if(clear){terminal=finishWitness(node);return summary('complete-clear',work,structuredClone(terminal));}


     const identity=completionFingerprint(node.state);if(!next.some(n=>n.identity===identity))next.push({...node,identity});
    }
   }
   return summary('unresolved',work,{reason:exhausted?'frontier-limit':'work-budget',resumable:!exhausted});
  }
 };
}
