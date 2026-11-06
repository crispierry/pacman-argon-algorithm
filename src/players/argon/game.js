import {BASE_SPEED,DIRECTIONS,OPPOSITE,ORDER,CLOCKWISE,STEP,REFERENCE_FRAME,PHASE_SECONDS,rulesForLevel,initialGhostMasks,initialPlayerMasks} from './rules.js';
import {WIDTH,HEIGHT,TUNNEL_Y,HORIZONTAL_PERIOD,collectibles,key,neighbor as mazeNeighbor,canEnter,splitGhostCanEnterLookahead,splitWrapX,splitDisplayY,splitCollectibles,viewForLevel,restrictedUp,slowZone,suppressTargetSchedule} from './maze.js';
import {arcadeFrightChoice} from './arcade-fright-sequence.js';
const EPS=1e-9;
const actor=(x,y,dir)=>({x,y,dir,next:null});
const distance2=(a,b)=>(a.x-b.x)**2+(a.y-b.y)**2;


const ghostDistance2=(a,b)=>{
  const dx=((59-a.x)&255)-((59-b.x)&255),dy=((a.y+33)&255)-((b.y+33)&255);
  return (dx*dx+dy*dy)&65535;
};
const wrap=x=>(x+WIDTH)%WIDTH;
const centerTile=(a,s,physical=false)=>({x:(s?.mazeVariant==='split-256'||Math.round(a.y)===TUNNEL_Y)?splitWrapX(Math.ceil(a.x-.5-EPS)):wrap(Math.ceil(a.x-.5-EPS)),y:Math.floor((physical&&s?.mazeVariant==='split-256'?splitDisplayY(a.y):a.y)+.5+EPS)});
const nav=(s,x,y,dir,kind='player')=>mazeNeighbor(x,y,dir,kind,s.mazeVariant);
const rules=s=>rulesForLevel(s.level);
const initialGhosts=(level=1,blinkyPrimed=true)=>[
  {id:'blinky',color:'#FF6262',...actor(13.5,11,'left'),next:{x:13,y:11},plannedDir:'left',status:'active',corner:{x:25,y:-4}},
  {id:'pinky',color:'#FFB8E0',...actor(13.5,14,'down'),status:'house',corner:{x:2,y:-4}},
  {id:'inky',color:'#66E3E7',...actor(11.5,14,'up'),status:'house',corner:{x:27,y:31}},
  {id:'clyde',color:'#FFB66B',...actor(15.5,14,'up'),status:'house',corner:{x:0,y:31}},
].map(g=>({...g,frightened:false,reverse:false,dots:0,revived:false,moveMasks:initialGhostMasks(level,g.id==='blinky'&&blinkyPrimed)}));
function emit(s,type,data={}){s.events.push({id:++s.eventId,type,level:s.level,...data});}
export function drainEvents(s){return s.events.splice(0);}
export function createGame({seed=0x504143,schedulerPhase=42}={}){
  if(!Number.isInteger(schedulerPhase)||schedulerPhase<0||schedulerPhase>=60)throw new RangeError('schedulerPhase must be an integer from 0 to 59');
  return {seed:seed>>>0,random:seed>>>0,arcadeFrightIndex:0,eventId:0,events:[],level:1,phase:'ready',suspendedPhase:null,
    phaseRemaining:0,phaseDuration:0,pauseReason:'',score:0,lives:3,bonusAwarded:false,
    pellets:collectibles(),levelDotsEaten:0,player:{...actor(13.5,23,'left'),next:{x:13,y:23}},requested:'left',playerDesired:'left',ghosts:initialGhosts(),
    power:0,frightWarning:false,chain:0,modeIndex:0,modeClock:STEP,noDotClock:0,inactivitySeenDots:0,globalRelease:false,
    globalDots:0,elroySuspended:false,elroyResumePending:false,playerDelay:0,playerMasks:initialPlayerMasks(1),houseFrame:0,schedulerPhase,initialSchedulerPhase:schedulerPhase,captureResumePass:false,respawnHoldFrames:0,stageStartHold:false,time:0,accumulator:0,fruit:null,fruitTriggered:[false,false],
    award:null,intermission:null,actorVisibility:{player:true,ghosts:true},mazeVariant:'normal',deferEdgePellet:false,
    mazeView:{variant:'normal',width:WIDTH,height:HEIGHT,originY:0,visualCells:null},mapAvailable:true};
}
function setPhase(s,phase){
  s.phase=phase;s.phaseDuration=PHASE_SECONDS[phase]??0;s.phaseRemaining=s.phaseDuration;
  if(phase==='clearing'){
    s.clearDelayFrames=(4-s.schedulerPhase%6+6)%6;
    s.phaseRemaining=s.phaseDuration+=s.clearDelayFrames*STEP;
  }
  s.actorVisibility={player:!['capture','intermission'].includes(phase),ghosts:!['dying','intermission'].includes(phase)};
}
export function startGame(s){
  if(s.phase!=='ready'||!s.mapAvailable)return;
  setPhase(s,'starting');emit(s,'ready');
}
export function pauseGame(s,reason='manual'){
  if(['ready','paused','game-over'].includes(s.phase))return;
  s.suspendedPhase=s.phase;s.phase='paused';s.pauseReason=reason;s.accumulator=0;
}
export function resumeGame(s){
  if(s.phase!=='paused'||!s.mapAvailable)return;
  s.phase=s.suspendedPhase??'playing';s.suspendedPhase=null;s.pauseReason='';
}
function resetActors(s,afterDeath){
  const counters=new Map(s.ghosts.map(g=>[g.id,g.dots]));

  const direction=s.requested;
  s.player={...actor(13.5,23,'left'),next:{x:13,y:23}};s.requested=direction;s.playerDesired='left';s.ghosts=initialGhosts(s.level,false);
  if(afterDeath)for(const g of s.ghosts)g.dots=counters.get(g.id)??0;
  Object.assign(s,{power:0,frightWarning:false,chain:0,modeIndex:0,modeClock:0,noDotClock:0,inactivitySeenDots:s.levelDotsEaten,
    globalRelease:afterDeath,globalDots:0,elroySuspended:afterDeath,elroyResumePending:false,playerDelay:0,playerMasks:initialPlayerMasks(s.level,false),houseFrame:0,captureResumePass:false,respawnHoldFrames:0,stageStartHold:false,random:s.seed,arcadeFrightIndex:0,fruit:null,award:null,deferEdgePellet:false});
}
export function continueGame(s){

  if(s.phase==='life-lost'){resetActors(s,true);setPhase(s,'respawning');emit(s,'ready');}
}
export function restartGame(s){
  const {seed,eventId,events,initialSchedulerPhase}=s;Object.assign(s,createGame({seed,schedulerPhase:initialSchedulerPhase}));s.eventId=eventId;s.events=events;emit(s,'ready');
}
export function requestDirection(s,dir){if(DIRECTIONS[dir]||dir==='neutral')s.requested=dir;}
export function mode(s){return s.modeIndex%2===0?'scatter':'chase';}
function elroy(s,g){return g.id==='blinky'&&!s.elroySuspended&&244-s.levelDotsEaten<=rules(s).elroyDots[0];}
export function ghostTarget(s,g,decisionTile=centerTile(g,s)){
  if(mode(s)==='scatter'&&!elroy(s,g))return g.corner;


  const playerDirection=s.player.neutralWall?.vector??s.player.dir;
  const p=centerTile(s.player,s),d=DIRECTIONS[playerDirection];
  const ahead=n=>({x:p.x+d.x*n-(playerDirection==='up'?n:0),y:p.y+d.y*n});
  if(g.id==='pinky')return ahead(4);
  if(g.id==='inky'){
    const a=ahead(2),blinky=s.ghosts.find(a=>a.id==='blinky')??g,b=blinky.next??centerTile(blinky,s);


    const wrapping=blinky.x>29||blinky.x< -2;
    const bx=wrapping&&blinky.dir==='right'&&b.x===-2?30:
      wrapping&&blinky.dir==='left'&&b.x===29?-3:b.x;
    return {x:2*a.x-bx,y:2*a.y-b.y};
  }
  if(g.id==='clyde'&&ghostDistance2(decisionTile,p)<64)return g.corner;
  return p;
}
function random(s){
  if(s.seed===0x504143)return arcadeFrightChoice(s.arcadeFrightIndex++)/4;
  s.random=(Math.imul(s.random,1664525)+1013904223)>>>0;return s.random/4294967296;
}
export function ghostDirectionAt(s,g,position={x:g.x,y:g.y},incoming=g.dir){
  if(s.mazeVariant==='split-256'){
    const current=centerTile(g,s);
    if(current.x<=0||current.x>=27)return incoming;
  }
  if(s.mazeVariant!=='split-256'&&position.y===TUNNEL_Y&&(position.x<=0||position.x>=27)){


    if(g.status==='active'&&g.frightened&&((position.x===0&&incoming==='left')||(position.x===27&&incoming==='right')))random(s);
    return incoming;
  }
  if(s.mazeVariant!=='split-256'&&position.y===TUNNEL_Y&&((position.x===1&&incoming==='right')||(position.x===26&&incoming==='left')))return incoming;
  const reverse=OPPOSITE[incoming];
  let choices=ORDER.filter(dir=>dir!==reverse&&nav(s,position.x,position.y,dir,'ghost'));
  if(s.mazeVariant==='split-256'&&(position.x===0||position.x===27)){


    choices=choices.filter(dir=>{const d=DIRECTIONS[dir];return splitGhostCanEnterLookahead(position.x+d.x,position.y+d.y);});
  }
  if(g.status!=='eyes'&&!g.frightened&&restrictedUp(position.x,position.y,s.mazeVariant))choices=choices.filter(d=>d!=='up');

  if(!choices.length)return s.mazeVariant==='split-256'?incoming:(nav(s,position.x,position.y,reverse,'ghost')?reverse:null);
  if(g.status!=='eyes'&&g.frightened){
    const start=Math.floor(random(s)*4);
    for(let i=0;i<4;i++){const dir=CLOCKWISE[(start+i)%4];if(choices.includes(dir))return dir;}
  }
  const target=g.status==='eyes'?{x:13,y:11}:ghostTarget(s,g,position);
  return choices.reduce((best,dir)=>ghostDistance2(nav(s,position.x,position.y,dir,'ghost'),target)<ghostDistance2(nav(s,position.x,position.y,best,'ghost'),target)?dir:best);
}
function chooseGhost(s,g){
  const planned=g.plannedDir;delete g.plannedDir;
  return planned&&(s.mazeVariant==='split-256'||nav(s,g.x,g.y,planned,'ghost'))?planned:ghostDirectionAt(s,g);
}
function resolvePendingTargets(s){
  for(const g of s.ghosts)if(g.pendingTarget){
    if(g.status==='active'&&!g.frightened)g.plannedDir=ghostDirectionAt(s,g,g.pendingTarget.position,g.pendingTarget.incoming);
    delete g.pendingTarget;
  }
}


function actorStep(s,a,dir,kind){
  const next=nav(s,a.x,a.y,dir,kind);if(next||s.mazeVariant!=='split-256'||kind==='player')return next;
  const d=DIRECTIONS[dir],x=splitWrapX(a.x+d.x),y=a.y+d.y;
  return {x,y};
}
function previousCenter(s,a){
  const d=DIRECTIONS[a.dir];
  if(s.mazeVariant==='split-256'&&d.y&&((d.y>0&&a.next.y===-1)||(d.y<0&&a.next.y===30)))return {x:a.next.x,y:d.y>0?30:-1};
  return {x:Math.round(a.next.x-d.x),y:Math.round(a.next.y-d.y)};
}
function move(s,a,budget,choose,kind,onCenter=()=>{}){
  let guard=0;
  while(budget>EPS&&guard++<8){
    if(!a.next){const dir=choose();if(!dir)break;const n=actorStep(s,a,dir,kind());if(!n)break;a.dir=dir;a.next=n;}
    const d=DIRECTIONS[a.dir];let remaining=Math.abs(d.x?a.next.x-a.x:a.next.y-a.y);
    const split=s.mazeVariant==='split-256',horizontalBuffer=split||a.y===TUNNEL_Y,wrapping=remaining>1.01&&(d.x||(split&&kind()==='player'&&d.y));
    if(wrapping)remaining=d.x?(d.x<0?a.x+(horizontalBuffer?3:1):(horizontalBuffer?30:WIDTH)-a.x):(d.y<0?a.y+2:31-a.y);
    const travel=Math.min(budget,remaining);a.x+=d.x*travel;a.y+=d.y*travel;budget-=travel;
    if(horizontalBuffer){if(a.x<= -2.5)a.x+=HORIZONTAL_PERIOD;if(a.x>29.5)a.x-=HORIZONTAL_PERIOD;}
    else {if(a.x<-.5)a.x+=WIDTH;if(a.x>WIDTH-.5)a.x-=WIDTH;}
    if(split){
      if(kind()==='player'){if(a.y< -1.5)a.y+=32;if(a.y>=30.5)a.y-=32;}
    }
    if(travel>=remaining-EPS){a.x=a.next.x;a.y=a.next.y;a.next=null;if(onCenter()===false)break;}
  }
  return budget;
}
function reverseAtCenter(s,g){
  if(!g.reverse||g.transit||!['active','eyes'].includes(g.status)||Math.abs(g.x-Math.round(g.x))>EPS||Math.abs(g.y-Math.round(g.y))>EPS)return;
  const dir=OPPOSITE[g.dir];
  g.reverse=false;delete g.plannedDir;
  g.next=actorStep(s,g,dir,g.status==='eyes'?'house':'ghost');
  g.dir=dir;



  const suppressed=g.status==='active'&&!g.frightened&&suppressTargetSchedule(g.x,g.y,s.mazeVariant);
  if(g.next){
    g.plannedDir=suppressed?dir:ghostDirectionAt(s,g,g.next,dir);


    if(!suppressed&&g.status==='active'&&!g.frightened)g.pendingTarget={position:{...g.next},incoming:dir};
  }
}
function moveGhost(s,g,dt,pixelStep=false){


  if(pixelStep&&g.status==='active'&&!g.transit)delete g.exitCollisionTile;
  if(g.status==='eyes'&&g.capturedExit){



    let budget=ghostSpeed(s,g)*dt;
    const arrive=()=>{
      const houseMoveDir=g.capturedExit.exitClock?'up':'left';
      delete g.capturedExit;g.frightened=false;g.revived=true;g.status=g.id==='blinky'?'exiting':'house';g.dir='down';g.next=null;
      if(g.status==='house')g.houseMoveDir=houseMoveDir;
      if(g.status==='house')release(s);
    };
    while(budget>EPS&&g.capturedExit){
      const transit=g.capturedExit;
      if(transit.phase==='navigate'){


        const d=DIRECTIONS[transit.vector],axis=d.x?'x':'y';
        if(Math.abs(g[axis]-Math.round(g[axis]))<EPS){
          const scheduledFallback=transit.plan;
          if(g.reverse){transit.plan=OPPOSITE[transit.orientation];transit.orientation=transit.plan;g.reverse=false;}
          transit.vector=transit.plan;
          const next=DIRECTIONS[transit.vector];transit.tile.x+=next.x;transit.tile.y+=next.y;
          transit.previous=transit.orientation;transit.pendingPlan=scheduledFallback;
        }
        const vector=DIRECTIONS[transit.vector],travel=Math.min(budget,1/8);g.x+=vector.x*travel;g.y+=vector.y*travel;budget-=travel;g.dir=transit.vector;
        if(g.y< -1.5)g.y+=32;else if(g.y>=30.5)g.y-=32;
        if(Math.abs(g.x-13.5)<EPS&&Math.abs(g.y-11)<EPS)transit.phase='enter';
      }else if(transit.phase==='enter'){
        const distance=Math.max(0,14.5-g.y),travel=Math.min(budget,distance);g.y+=travel;budget-=travel;g.dir='down';
        if(distance-travel<EPS){
          if(Math.abs(transit.homeX-g.x)<EPS){arrive();break;}
          transit.phase='aside';
        }else break;
      }else{
        const distance=Math.abs(transit.homeX-g.x),travel=Math.min(budget,distance);g.x+=Math.sign(transit.homeX-g.x)*travel;budget-=travel;
        if(distance-travel>=EPS)break;
        g.x=transit.homeX;arrive();
        break;
      }
    }
    return;
  }
  let time=dt,guard=0;
  while(time>EPS&&guard++<16){
    if(g.status==='house')break;
    if(g.status==='eyes'&&!g.transit&&g.reverse&&Math.abs(g.x-Math.round(g.x))<EPS&&Math.abs(g.y-Math.round(g.y))<EPS)reverseAtCenter(s,g);
    if(g.leavingDoor&&(g.x!==13.5||g.y!==11))delete g.leavingDoor;
    if(!g.transit&&(g.status==='exiting'||(g.status==='eyes'&&g.y===11&&((!g.next&&g.x===13)||(g.x===13.5&&!g.leavingDoor))))){
      const homeX=({inky:11.5,clyde:15.5})[g.id]??13.5;
      if(g.status==='eyes')g.returnVector=g.dir;
      const returnPoints=[{x:13.5,y:11},{x:13.5,y:14.5}];
      if(homeX!==13.5)returnPoints.push({x:homeX,y:14.5});
      g.transit={points:g.status==='eyes'?returnPoints:[{x:13.5,y:g.y},{x:13.5,y:g.exitWrapUp?11-32:11}],index:0};g.next=null;delete g.exitWrapUp;
    }
    const speed=pixelStep&&g.status==='active'&&!g.transit?1/(8*dt):ghostSpeed(s,g);
    if(g.transit){
      const target=g.transit.points[g.transit.index],dx=target.x-g.x,dy=target.y-g.y;
      const distance=Math.abs(dx)+Math.abs(dy),travel=Math.min(distance,speed*time);
      if(distance>EPS){
        g.dir=dx?(dx<0?'left':'right'):(dy<0?'up':'down');const d=DIRECTIONS[g.dir];g.x+=d.x*travel;g.y+=d.y*travel;time-=travel/speed;


        if(g.status==='exiting'&&target.y< -1.5&&g.y< -1.5){g.y+=32;target.y+=32;}
      }
      if(travel<distance-EPS)break;
      g.x=target.x;g.y=target.y;
      if(++g.transit.index===g.transit.points.length){
        delete g.transit;g.next=null;
        if(g.status==='eyes'){
          delete g.plannedDir;
          g.frightened=false;g.revived=true;g.status=g.id==='blinky'?'exiting':'house';g.dir='down';
          if(g.status==='house')release(s);
          break;
        }
        else {
          g.exitCollisionTile={x:({pinky:13,inky:11,clyde:15})[g.id]??13,y:14};
          g.status='active';g.dir='left';g.next={x:13,y:11};g.plannedDir='left';
        }
      }
    }else{
      reverseAtCenter(s,g);
      const choose=()=>{
        const dir=chooseGhost(s,g),next=dir?actorStep(s,g,dir,'ghost'):null;
        if((g.status==='active'||g.status==='eyes')&&next){
          const suppressed=g.status==='active'&&!g.frightened&&suppressTargetSchedule(g.x,g.y,s.mazeVariant);
          g.plannedDir=suppressed?dir:ghostDirectionAt(s,g,next,dir);


          if(!suppressed&&g.status==='active'&&!g.frightened)g.pendingTarget={position:{...next},incoming:dir};
        }
        return dir;
      };


      const doorway=g.status==='eyes'&&g.y===11&&g.next&&((g.dir==='left'&&g.x>13.5&&g.next.x<=13)||(g.dir==='right'&&g.x<13.5&&g.next.x>=14));
      const budget=doorway?Math.min(speed*time,Math.abs(g.x-13.5)):speed*time;
      const unused=move(s,g,budget,choose,()=>g.status==='eyes'?'house':'ghost',
        ()=>!(g.status==='eyes'&&g.x===13&&g.y===11));
      const reachedDoor=doorway&&Math.abs(g.x-13.5)<EPS;
      if(reachedDoor){g.x=13.5;g.next=null;time-=(budget-unused)/speed;continue;}
      if(g.status!=='eyes'||g.x!==13||g.y!==11)break;
      time=unused/speed;
    }
  }
}
function activeGhostMoves(s,g){
  const r=rules(s),pos=centerTile(g,s,s.mazeVariant==='split-256');
  const mask=slowZone(pos.x,pos.y,s.mazeVariant)?'tunnel':g.frightened?'fright':
    elroy(s,g)?(244-s.levelDotsEaten<=r.elroyDots[1]?'elroy2':'elroy1'):'normal';
  const value=g.moveMasks[mask]>>>0,bit=value>>>31;
  g.moveMasks[mask]=((value<<1)|bit)>>>0;
  return bit!==0;
}
function playerMoves(s){
  const key=s.power?'powered':'normal',value=s.playerMasks[key]>>>0,bit=value>>>31;
  s.playerMasks[key]=((value<<1)|bit)>>>0;
  return bit!==0;
}
function bounce(s,g,dt){
  const speed=BASE_SPEED*rules(s).house;
  if(g.houseMoveDir){


    if(Math.abs(g.y-13.5)<EPS||Math.abs(g.y-14.5)<EPS){g.dir=OPPOSITE[g.dir];g.houseMoveDir=g.dir;}
    const d=DIRECTIONS[g.houseMoveDir];g.x+=d.x*speed*dt;g.y+=d.y*speed*dt;
    if(g.y< -1.5)g.y+=32;else if(g.y>=30.5)g.y-=32;
    return;
  }
  const next=g.dir==='down'?14.5:13.5,sign=g.dir==='down'?1:-1;
  g.y+=sign*speed*dt;
  if(sign>0&&g.y>next){g.y=2*next-g.y;g.dir='up';}
  if(sign<0&&g.y<next){g.y=2*next-g.y;g.dir='down';}
}
function addScore(s,points){
  const before=s.score;s.score=(before+points)%1000000;
  if(!s.bonusAwarded&&before<10000&&before+points>=10000){s.bonusAwarded=true;s.lives++;emit(s,'extra-life',{lives:s.lives});}
}
function endPower(s,force=false){
  if(!force&&!s.power)return;
  s.power=0;s.frightWarning=false;for(const g of s.ghosts)g.frightened=false;emit(s,'power-end');
}
function consume(s,afterPlayerMove=false){



  if(s.mazeVariant==='split-256'&&s.deferEdgePellet)return;
  const p=centerTile(s.player,s),k=key(p.x,p.y),pellet=s.pellets.get(k);if(!pellet)return;
  s.pellets.delete(k);s.levelDotsEaten++;s.noDotClock=0;
  const points=pellet==='o'?50:10;addScore(s,points);


  s.playerDelay=(pellet==='o'?3.5:1)*REFERENCE_FRAME;
  if(s.globalRelease)s.globalDots=(s.globalDots+1)&255;
  else {const waiting=s.ghosts.find(g=>g.status==='house');if(waiting)waiting.dots++;}
  if(pellet==='o'){
    const seconds=rules(s).powerSeconds,wasPowered=s.power>0;s.power=seconds;s.chain=0;


    if(seconds===0)s.zeroFrightPass=true;
    for(const g of s.ghosts){

      if(g.status==='eyes'&&afterPlayerMove)g.pendingPowerReverse=true;
      else {g.reverse=true;delete g.plannedDir;}
      if(g.status!=='eyes'){g.frightened=true;g.revived=false;}
    }
    if(seconds>0)emit(s,'power',{points,x:p.x,y:p.y});
    else {emit(s,'dot',{points,x:p.x,y:p.y,energizer:true});if(wasPowered)emit(s,'power-end');}
  }else emit(s,'dot',{points,x:p.x,y:p.y});
  const trigger=[70,170].indexOf(s.levelDotsEaten);
  if(trigger>=0&&!s.fruitTriggered[trigger]){
    s.fruitTriggered[trigger]=true;


    const phase=s.schedulerPhase;
    s.fruit={...rules(s).fruit,x:13.5,y:17,remaining:(600-phase)*REFERENCE_FRAME};
    emit(s,'fruit-spawn',{...s.fruit});
  }
}
function movePlayer(s,budget){
  const a=s.player;
  const neutral=s.requested==='neutral';



  if(a.neutralWall){
    if(neutral)return;
    const vector=a.neutralWall.vector,corner=centerTile(a,s);
    s.playerDesired=s.requested;
    if(s.requested===vector||!nav(s,corner.x,corner.y,s.requested))return;
    delete a.neutralWall;
    if(s.requested===OPPOSITE[vector]){
      a.dir=s.requested;a.next=nav(s,corner.x,corner.y,s.requested);
    }else{
      a.dir=s.requested;a.next={...corner};a.turn={corner,oldDir:vector,dir:s.requested};
    }
  }


  const tile=centerTile(a,s),tunnelEdge=tile.x<=0||tile.x>=27;
  if(!neutral&&!(tunnelEdge&&(s.requested==='up'||s.requested==='down')))s.playerDesired=s.requested;
  let requested=neutral?(a.turn?.dir??a.dir):s.requested;


  if(a.turn?.correcting){
    const t=a.turn,physical=centerTile(a,s);
    if(neutral||(requested!==t.oldDir&&!nav(s,physical.x,physical.y,requested)))requested=t.oldDir;
    else {
      const d=DIRECTIONS[t.oldDir],want=DIRECTIONS[requested];
      if(d.x*want.x+d.y*want.y===0){


        const corner=t.correctionJunction??t.corner,axis=d.x?'x':'y';
        const forward=(corner[axis]-a[axis])*(d.x||d.y)>=0;
        a.turn={corner:{...corner},oldDir:forward?t.oldDir:OPPOSITE[t.oldDir],dir:requested};a.next={...corner};a.dir=requested;
      }
    }
  }
  if(neutral&&!a.turn&&a.next&&s.playerDesired&&s.playerDesired!==a.dir){
    const physical=centerTile(a,s),vector=DIRECTIONS[a.dir],facing=DIRECTIONS[s.playerDesired];
    if(vector.x*facing.x+vector.y*facing.y===0&&!nav(s,physical.x,physical.y,a.dir)){
      const axis=vector.x?'x':'y',perpendicular=vector.x?'y':'x';
      if(Math.abs(a[perpendicular]-Math.round(a[perpendicular]))<EPS){


        a[axis]+=(vector.x||vector.y)*budget;
        const correction=Math.round(a[axis])-a[axis];
        a[axis]+=Math.sign(correction)*Math.min(budget,Math.abs(correction));
        a.neutralWall={vector:a.dir};a.dir=s.playerDesired;consume(s,true);return;
      }
    }
  }
  if(a.turn&&requested===OPPOSITE[a.turn.oldDir]&&nav(s,centerTile(a,s).x,centerTile(a,s).y,requested)){


    const t=a.turn,d=DIRECTIONS[t.oldDir],corner={x:t.corner.x-d.x,y:t.corner.y-d.y};
    const axis=d.x?'x':'y',other=axis==='x'?'y':'x';
    const correction=other==='x'?(corner.x<a.x?'left':'right'):(corner.y<a.y?'up':'down');
    a.dir=requested;a.next={...corner};a.turn={corner,oldDir:requested,dir:correction,correctionJunction:{...t.corner}};
  }
  if(a.turn&&requested===OPPOSITE[a.turn.dir]){
    const physical=centerTile(a,s);
    if(nav(s,physical.x,physical.y,requested)){a.turn.dir=requested;a.dir=requested;}
  }
  const physical=centerTile(a,s);
  if(!a.turn&&a.next&&requested===OPPOSITE[a.dir]&&nav(s,physical.x,physical.y,requested)){
    const target=previousCenter(s,a),vector=DIRECTIONS[a.dir],axis=vector.x?'x':'y',sign=vector.x||vector.y;



    const offset=(a[axis]-target[axis])*sign;if(offset< -EPS&&offset> -1-EPS)target[axis]-=sign;
    a.next={x:(s.mazeVariant==='split-256'||a.y===TUNNEL_Y)?splitWrapX(target.x):wrap(target.x),y:target.y};a.dir=requested;
  }
  if(!a.turn&&a.next&&Math.abs(a.x-Math.round(a.x))<EPS&&Math.abs(a.y-Math.round(a.y))<EPS){
    const current=DIRECTIONS[a.dir],want=DIRECTIONS[requested];
    if(current.x*want.x+current.y*want.y===0){
      const next=nav(s,physical.x,physical.y,requested);
      if(next){a.dir=requested;a.next=next;}
    }
  }
  let guard=0;
  while(budget>EPS&&guard++<8){
    if(a.turn){
      const t=a.turn,old=DIRECTIONS[t.oldDir],d=DIRECTIONS[t.dir],axis=old.x?'x':'y';
      if(requested===t.oldDir&&nav(s,t.corner.x,t.corner.y,t.oldDir)){




        const correctionJunction=t.correctionJunction??{...t.corner};
        if((t.corner[axis]-a[axis])*(old.x||old.y)<-EPS){
          t.corner=nav(s,t.corner.x,t.corner.y,t.oldDir);a.next={...t.corner};
        }
        const other=axis==='x'?'y':'x',remaining=Math.abs(t.corner[axis]-a[axis]);
        const travel=Math.min(budget,remaining);a[axis]+=Math.sign(t.corner[axis]-a[axis])*travel;
        a[other]+=Math.sign(t.corner[other]-a[other])*Math.min(travel,Math.abs(t.corner[other]-a[other]));
        budget-=travel;a.dir=t.oldDir;consume(s,true);
        if(travel<remaining-EPS&&Math.abs(a[other]-t.corner[other])<=EPS){
          a.next={...t.corner};delete a.turn;
        }else if(travel<remaining-EPS){
          t.correcting=true;t.correctionJunction=correctionJunction;
          t.dir=other==='x'?(t.corner.x<a.x?'left':'right'):(t.corner.y<a.y?'up':'down');
        }else if(travel>=remaining-EPS){
          a[axis]=t.corner[axis];
          if(Math.abs(a[other]-t.corner[other])>EPS){



            const next=nav(s,t.corner.x,t.corner.y,t.oldDir);
            if(next){
              const correction=other==='x'?(t.corner.x<a.x?'left':'right'):(t.corner.y<a.y?'up':'down');
              a.next=next;a.turn={corner:next,oldDir:t.oldDir,dir:correction,correcting:true,correctionJunction};
            }else {a.next=null;delete a.turn;}
          }else {a.next=null;delete a.turn;}
        }
        if(s.playerDelay>EPS)return;
        continue;
      }
      const remaining=Math.abs(t.corner[axis]-a[axis]),travel=Math.min(budget,remaining);
      a[axis]+=Math.sign(t.corner[axis]-a[axis])*travel;
      const newAxis=d.x?'x':'y',sign=d.x||d.y,candidate=a[newAxis]+sign*travel;
      const exit=nav(s,t.corner.x,t.corner.y,t.dir);


      a[newAxis]=!exit&&(candidate-t.corner[newAxis])*sign>0?t.corner[newAxis]:candidate;
      budget-=travel;a.dir=t.dir;consume(s,true);
      if(travel>=remaining-EPS){
        a[axis]=t.corner[axis];a.next=exit??(Math.abs(a[newAxis]-t.corner[newAxis])>EPS?{...t.corner}:null);delete a.turn;
      }
      if(s.playerDelay>EPS)return;
      continue;
    }
    if(!a.next){
      const dir=nav(s,a.x,a.y,requested)?requested:(nav(s,a.x,a.y,a.dir)?a.dir:null);
      if(!dir)return;a.dir=dir;a.next=nav(s,a.x,a.y,dir);
    }
    const d=DIRECTIONS[a.dir],wanted=DIRECTIONS[requested];
    const distance=Math.abs(d.x?a.next.x-a.x:a.next.y-a.y),wrapping=distance>1.01&&(d.x||s.mazeVariant==='split-256');
    if(d.x*wanted.x+d.y*wanted.y===0){
      const origin=previousCenter(s,a),pre=(a.dir==='right'||a.dir==='up'?3:4)/8,post=7/8-pre;
      const since=Math.abs(d.x?a.x-origin.x:a.y-origin.y);
      const corner=!wrapping&&distance<=pre+EPS&&nav(s,a.next.x,a.next.y,requested)?a.next:
        since<=post+EPS&&since>EPS&&nav(s,origin.x,origin.y,requested)?origin:null;
      if(corner){a.turn={corner:{...corner},oldDir:a.dir,dir:requested};continue;}
      if(!wrapping&&nav(s,a.next.x,a.next.y,requested)&&distance>pre+EPS){
        const travel=Math.min(budget,distance-pre);a.x+=d.x*travel;a.y+=d.y*travel;budget-=travel;consume(s,true);
        if(s.playerDelay>EPS)return;continue;
      }
    }
    budget=move(s,a,budget,()=>a.dir,()=>'player',()=>{consume(s,true);return false;});
    consume(s,true);if(s.playerDelay>EPS)return;
  }
}
function release(s,timeoutOnly=false){
  const clyde=s.ghosts.find(g=>g.id==='clyde');
  if(!timeoutOnly&&s.globalRelease&&s.globalDots===32&&clyde?.status==='house'){
    s.globalRelease=false;s.globalDots=0;return;
  }
  let waiting=s.ghosts.find(g=>g.status==='house');



  if(!timeoutOnly&&s.globalRelease){
    const target=({7:'pinky',17:'inky'})[s.globalDots];
    if(target)waiting=s.ghosts.find(g=>g.id===target&&g.status==='house')??waiting;
  }

  if(!waiting){if(timeoutOnly&&s.noDotClock+EPS>=rules(s).releaseTimeout)s.noDotClock=0;return;}
  const i=['pinky','inky','clyde'].indexOf(waiting.id);if(i<0)return;
  const threshold=rules(s).releaseLimits[i];
  const reached=!timeoutOnly&&(s.globalRelease?s.globalDots===({pinky:7,inky:17})[waiting.id]:waiting.dots>=threshold);
  const timed=s.noDotClock+EPS>=rules(s).releaseTimeout;
  if(reached||timed){
    if(waiting.houseMoveDir&&waiting.y<11)waiting.exitWrapUp=true;
    waiting.status='exiting';delete waiting.houseMoveDir;if(timed)s.noDotClock=0;
    if(waiting.id==='clyde'){
      if(timeoutOnly)s.elroyResumePending=true;
      else s.elroySuspended=false;
    }
  }
}
export function ghostSpeed(s,g){
  const r=rules(s);
  if(g.status==='eyes')return BASE_SPEED*r.eyes;
  if(g.status==='house'||g.status==='exiting')return BASE_SPEED*r.house;
  const pos=centerTile(g,s,s.mazeVariant==='split-256');
  if(slowZone(pos.x,pos.y,s.mazeVariant))return BASE_SPEED*r.tunnelGhost;
  if(g.frightened)return BASE_SPEED*(r.frightenedGhost??r.ghost);
  return BASE_SPEED*(elroy(s,g)?(244-s.levelDotsEaten<=r.elroyDots[1]?r.elroy2:r.elroy1):r.ghost);
}
function contact(s,pass=0){
  const p=centerTile(s.player,s);
  const ghosts=['clyde','inky','pinky','blinky'].map(id=>s.ghosts.find(a=>a.id===id));
  let g=ghosts.find(g=>g?.status==='active'&&distance2(g.exitCollisionTile??centerTile(g,s,true),p)===0);


  if(!g&&s.power>0)g=ghosts.find(g=>{


    if(!['active','exiting','house'].includes(g?.status))return false;
    const y=s.mazeVariant==='split-256'?splitDisplayY(g.y):g.y;
    const dx=(Math.round((s.player.x-g.x)*8)&255),dy=(Math.round((y-s.player.y)*8)&255);
    return dx<4&&dy<4;
  });
  if(!g)return false;
  if(g.frightened&&s.power>0){
    const points=200*2**Math.min(s.chain++,3),displayY=s.mazeVariant==='split-256'?splitDisplayY(g.y):g.y;addScore(s,points);






    const phase=s.schedulerPhase%6;
    const captureFrames=59-phase+(pass===1&&phase===5?6:0);
    s.award={kind:'ghost',points,x:g.x,y:displayY,remaining:captureFrames*STEP};

    if(g.status==='exiting'){
      const homeX=({inky:11.5,clyde:15.5})[g.id]??13.5;
      const vector=g.returnVector??'up';
      g.capturedExit={phase:'navigate',homeX,exitClock:true,vector,plan:'up',orientation:'up',previous:'up',tile:{x:Math.floor(homeX),y:14}};
      delete g.transit;g.next=null;
    }
    else if(g.status==='active'&&g.x===13.5&&g.y===11)g.leavingDoor=true;
    g.status='eyes';g.frightened=false;g.capturePending=true;
    setPhase(s,'capture');s.phaseDuration=s.phaseRemaining=captureFrames*STEP;emit(s,'ghost',{points,x:g.x,y:displayY,idGhost:g.id});
  }else{
    s.lives=Math.max(0,s.lives-1);s.fruit=null;s.power=0;s.frightWarning=false;
    for(const ghost of s.ghosts)ghost.frightened=false;
    setPhase(s,'dying');emit(s,'death',{lives:s.lives,x:s.player.x,y:s.player.y});
  }
  return true;
}
function fruitContact(s,old){
  if(!s.fruit)return;const f=s.fruit,p=s.player,dx=p.x-old.x,dy=p.y-old.y;



  if(Math.abs(dx)>1||Math.abs(dy)>1)return;
  const norm=dx*dx+dy*dy,t=norm?Math.max(0,Math.min(1,((f.x-old.x)*dx+(f.y-old.y)*dy)/norm)):0;
  if((old.x+t*dx-f.x)**2+(old.y+t*dy-f.y)**2>1e-8)return;
  addScore(s,f.points);s.award={kind:'fruit',points:f.points,x:f.x,y:f.y,remaining:(120-s.schedulerPhase%6)*REFERENCE_FRAME};
  emit(s,'fruit',{points:f.points,x:f.x,y:f.y,idFruit:f.id});s.fruit=null;
}
function updateAwards(s,dt){if(s.award){s.award.remaining=Math.max(0,s.award.remaining-dt);if(s.award.remaining<EPS)s.award=null;}}
function updateFruit(s,dt){
  if(s.fruit){s.fruit.remaining=Math.max(0,s.fruit.remaining-dt);if(s.fruit.remaining<EPS){s.fruit=null;emit(s,'fruit-expire');}}
}
function advanceLevel(s,afterIntermission=false){
  if(s.level>=256)return;
  s.level++;s.levelDotsEaten=0;s.fruitTriggered=[false,false];resetActors(s,false);
  s.pellets=s.level===256?splitCollectibles():collectibles();s.mazeVariant=s.level===256?'split-256':'normal';
  s.mazeView=viewForLevel(s.level);s.mapAvailable=true;
  setPhase(s,'starting');s.stageStartHold=true;s.phaseDuration=s.phaseRemaining=(afterIntermission?120:119)*STEP;emit(s,'level');emit(s,'ready');
}
function finishPhase(s){
  switch(s.phase){
    case 'starting':if(s.stageStartHold)s.respawnHoldFrames=1;else s.noDotClock=STEP;setPhase(s,'playing');break;
    case 'respawning':s.respawnHoldFrames=1;setPhase(s,'playing');break;
    case 'capture':for(const g of s.ghosts)if(g.capturePending){delete g.capturePending;g.captureJustResumed=true;}s.captureResumePass=true;setPhase(s,'playing');break;
    case 'dying':
      if(!s.lives){setPhase(s,'game-over');emit(s,'game-over',{score:s.score});}
      else {
        resetActors(s,true);if(s.level===256)for(const [k,v] of splitCollectibles(true))s.pellets.set(k,v);
        setPhase(s,'respawning');


        const registerPhase=(s.schedulerPhase+3)%6;
        const delay=3+114+(6-registerPhase);
        s.phaseDuration=s.phaseRemaining=delay*STEP;
        emit(s,'ready');
      }break;
    case 'clearing':{
      const kind=rules(s).intermissionAfterClear;
      if(kind){setPhase(s,'intermission');const observed={1:635,2:510,3:521}[kind];if(observed)s.phaseDuration=s.phaseRemaining=observed*STEP;s.intermission={kind,elapsed:0,duration:s.phaseDuration};emit(s,'intermission',{kind});}
      else advanceLevel(s);break;
    }
    case 'intermission':{const afterIntermission=[1,3].includes(s.intermission?.kind);s.intermission=null;advanceLevel(s,afterIntermission);break;}
  }
}
function tick(s){
  s.time+=STEP;
  s.schedulerPhase=(s.schedulerPhase+1)%60;
  if(s.mazeVariant==='split-256')for(const g of s.ghosts)g.displayY=splitDisplayY(g.y);updateAwards(s,STEP);
  if(s.phase!=='playing'){
    if(s.phase==='capture'){


      if(s.inactivitySeenDots!==s.levelDotsEaten)s.noDotClock=0;else s.noDotClock+=STEP;
      release(s,true);updateFruit(s,STEP);
      for(const g of s.ghosts)if(g.status==='eyes'&&!g.capturePending)moveGhost(s,g,STEP);
    }
    if(s.phase==='dying'){
      const elapsed=s.phaseDuration-s.phaseRemaining;
      s.actorVisibility={player:elapsed<345/2*REFERENCE_FRAME,ghosts:elapsed<60*REFERENCE_FRAME};
    }
    if(s.phase==='clearing'){
      const frames=Math.round((s.phaseDuration-s.phaseRemaining)/STEP)+1-(s.clearDelayFrames??0);
      s.actorVisibility={player:frames<215,ghosts:frames<117};
    }
    if(s.phase==='intermission')s.intermission.elapsed=Math.min(s.intermission.duration,s.intermission.elapsed+STEP);
    s.phaseRemaining=Math.max(0,s.phaseRemaining-STEP);
    if(s.phaseRemaining<EPS)finishPhase(s);
    if(s.mazeVariant==='split-256')for(const g of s.ghosts)g.displayY=splitDisplayY(g.y);
    return;
  }
  if(s.level<256&&s.levelDotsEaten===244){setPhase(s,'clearing');s.fruit=null;endPower(s);emit(s,'clear');return;}
  if(s.respawnHoldFrames){
    s.respawnHoldFrames--;s.modeClock+=STEP;

    const mask=s.playerMasks.normal>>>0;s.playerMasks.normal=((mask<<1)|(mask>>>31))>>>0;


    if(s.level===1&&!s.stageStartHold){const b=s.ghosts.find(g=>g.id==='blinky');if(b){const n=b.moveMasks.normal>>>0;b.moveMasks.normal=((n<<2)|(n>>>30))>>>0;}}
    if(s.stageStartHold)s.noDotClock+=STEP;
    if(s.stageStartHold||s.level>1){
      const blinky=s.ghosts.find(g=>g.id==='blinky');
      if(blinky&&blinky.status==='active')for(let pass=0;pass<2;pass++)if(activeGhostMoves(s,blinky))moveGhost(s,blinky,STEP/2,true);
      s.stageStartHold=false;
    }
    resolvePendingTargets(s);
    return;
  }
  updateFruit(s,STEP);
  if(s.elroyResumePending&&s.schedulerPhase%6===2){s.elroySuspended=false;s.elroyResumePending=false;}
  const dt=STEP/2;
  for(let pass=0;pass<2;pass++){
    if(s.captureResumePass){
      s.captureResumePass=false;
      for(const g of s.ghosts){if(g.status==='eyes'&&!g.captureJustResumed)moveGhost(s,g,dt);delete g.captureJustResumed;}
      continue;
    }
    if(contact(s,pass)){


      if(s.phase==='capture'){
        for(const g of s.ghosts)if(g.status==='eyes'&&!g.capturePending)moveGhost(s,g,pass===0?STEP:dt);


        if(s.inactivitySeenDots!==s.levelDotsEaten)s.noDotClock=0;else s.noDotClock+=STEP;
      }
      resolvePendingTargets(s);
      if(s.mazeVariant==='split-256')for(const g of s.ghosts)g.displayY=splitDisplayY(g.y);return;
    }
    const old={x:s.player.x,y:s.player.y};consume(s);
    if(s.playerDelay>EPS)s.playerDelay=Math.max(0,s.playerDelay-dt);
    else if(playerMoves(s)){
      s.inactivitySeenDots=s.levelDotsEaten;
      if(s.mazeVariant==='split-256'){const tile=centerTile(s.player,s);s.deferEdgePellet=tile.x<=0||tile.x>=27;}
      movePlayer(s,1/8);
    }
    fruitContact(s,old);
    for(const g of s.ghosts)if(g.status!=='house'&&g.status!=='exiting'){
      if(g.status==='active'&&!g.transit){if(activeGhostMoves(s,g))moveGhost(s,g,dt,true);}
      else moveGhost(s,g,dt);
    }


    for(const g of s.ghosts)if(g.pendingPowerReverse){g.reverse=true;delete g.plannedDir;delete g.pendingPowerReverse;}
    if(s.zeroFrightPass){for(const g of s.ghosts)g.frightened=false;delete s.zeroFrightPass;}



    if(s.power>0&&s.ghosts.every(g=>!g.frightened&&g.status!=='eyes'))endPower(s,true);
    if(s.power>0){s.power=Math.max(0,s.power-dt);if(s.power<EPS)endPower(s,true);}
    release(s);
  }
  if(s.inactivitySeenDots!==s.levelDotsEaten)s.noDotClock=0;
  else s.noDotClock+=STEP;


  if(s.level>=3&&s.houseFrame===0&&!s.globalRelease)release(s);


  release(s,true);
  if(s.houseFrame++%2===0)for(const g of s.ghosts){
    if(g.status==='house')bounce(s,g,2*STEP);
    else if(g.status==='exiting')moveGhost(s,g,2*STEP);
    else if(g.status==='eyes'&&g.capturedExit?.exitClock){
      g.y-=1/8;
      if(g.y< -1.5)g.y+=32;
      if(g.capturedExit.phase==='navigate'){g.capturedExit.orientation='up';g.capturedExit.previous='up';}


      if(Math.abs(g.y-11)<EPS){
        const transit=g.capturedExit;transit.exitClock=false;
        if(transit.phase==='navigate'){


          transit.vector='left';transit.plan='left';transit.orientation='left';transit.previous='left';transit.tile={x:13,y:11};
        }
      }
    }
  }
  resolvePendingTargets(s);
  for(const g of s.ghosts)if(g.capturedExit?.pendingPlan){
    const transit=g.capturedExit,planned=ghostDirectionAt(s,g,transit.tile,transit.previous);
    transit.plan=planned??transit.pendingPlan;transit.pendingPlan=null;
  }
  if(s.elroyResumePending){s.elroySuspended=false;s.elroyResumePending=false;}
  if(!s.power&&s.modeIndex<7){
    s.modeClock+=STEP;

    while(s.modeIndex<7&&s.modeClock+EPS>=rules(s).scatterChase[s.modeIndex]){
      s.modeClock-=rules(s).scatterChase[s.modeIndex++];for(const g of s.ghosts){g.reverse=true;delete g.plannedDir;}
    }
  }
  s.frightWarning=s.power>0&&s.power<=rules(s).warningSeconds;
  if(s.mazeVariant==='split-256')for(const g of s.ghosts)g.displayY=splitDisplayY(g.y);
}
export function step(s,dt=STEP,{beforeTick,afterTick}={}){
  if(['ready','paused','game-over'].includes(s.phase)||!Number.isFinite(dt)||dt<=0)return s;
  if(dt>.25){pauseGame(s,'interrupted');return s;}
  s.accumulator+=dt;
  while(s.accumulator+EPS>=STEP&&!['ready','paused','game-over'].includes(s.phase)){
    beforeTick?.(s);
    if(['ready','paused','game-over'].includes(s.phase))break;
    s.accumulator-=STEP;tick(s);afterTick?.(s);
  }
  return s;
}
