

export const REFERENCE_FRAME=33/2000;
export const STEP=REFERENCE_FRAME;
export const BASE_SPEED=(2500/33)/8;
export const DIRECTIONS=Object.freeze({up:{x:0,y:-1},left:{x:-1,y:0},down:{x:0,y:1},right:{x:1,y:0}});
export const ORDER=Object.freeze(Object.keys(DIRECTIONS));
export const CLOCKWISE=Object.freeze(['right','down','left','up']);
export const OPPOSITE=Object.freeze({up:'down',down:'up',left:'right',right:'left'});


const ghostMasks=[
  {normal:[170,42,85,85],fright:[146,36,146,36],tunnel:[34,34,34,34],elroy1:[85,85,85,85],elroy2:[170,106,85,213]},
  {normal:[170,106,85,213],fright:[146,36,37,73],tunnel:[72,36,34,145],elroy1:[213,106,213,106],elroy2:[214,90,173,181]},
  {normal:[214,90,173,181],fright:[37,37,37,37],tunnel:[146,36,146,36],elroy1:[109,109,109,109],elroy2:[182,109,109,219]},
  {normal:[214,90,173,181],fright:[72,36,34,145],tunnel:[146,36,146,36],elroy1:[109,109,109,109],elroy2:[182,109,109,219]},
];
const playerMasks=[[[85,85,85,85],[213,106,213,106]],[[213,106,213,106],[214,90,173,181]],[[109,109,109,109],[109,109,109,109]],[[213,106,213,106],[213,106,213,106]]];
function packedMask([a,b,c,d]){return ((b<<24)|(a<<16)|(d<<8)|c)>>>0;}
export function initialPlayerMasks(level,primed=true){
  const [normal,powered]=playerMasks[level===1?0:level<=4?1:level<=20?2:3];
  const n=packedMask(normal);
  return {normal:primed?((n<<1)|(n>>>31))>>>0:n,powered:packedMask(powered)};
}
export function initialGhostMasks(level,blinky=false){
  const row=ghostMasks[level===1?0:level<=4?1:level<=20?2:3];
  return Object.fromEntries(Object.entries(row).map(([key,[a,b,c,d]])=>{
    let mask=packedMask([a,b,c,d]);

    if(blinky&&key==='normal')mask=((mask<<2)|(mask>>>30))>>>0;
    return [key,mask];
  }));
}
const fright=[6,5,4,3,2,5,2,2,1,5,2,1,1,3,1,1,0,1,0,0,0];
const warningFlashes=[5,5,5,5,5,5,5,5,3,5,5,3,3,5,3,3,0,3,0,0,0];
const elroyFirst=[20,30,40,40,40,50,50,50,60,60,60,80,80,80,100,100,100,100,120,120,120];
const fruitKinds=[['cherry','Cherries',100],['strawberry','Strawberry',300],['orange','Orange',500],['apple','Apple',700],['melon','Melon',1000],['galaxian','Galaxian',2000],['bell','Bell',3000],['key','Key',5000]];
const schedules=[
  [420,1200,420,1200,300,1200,300,Infinity],
  [420,1200,420,1200,300,61994,1,Infinity],
  [300,1200,300,1200,300,62234,1,Infinity],
].map(values=>Object.freeze(values.map(n=>n*REFERENCE_FRAME)));
const rows=Array.from({length:21},(_,i)=>{
  const family=i===0?0:i<4?1:i<20?2:3;
  const [player,poweredPlayer,ghost,frightenedGhost,tunnelGhost,elroy1,elroy2]=[
    [.8,.9,.75,.5,.4,.8,.85],[.9,.95,.85,.55,.45,.9,.95],
    [1,1,.95,.6,.5,1,1.05],[.9,null,.95,null,.5,1,1.05],
  ][family];
  const fruitIndex=i===0?0:i===1?1:Math.min(7,2+Math.floor((i-2)/2));
  const [id,name,points]=fruitKinds[fruitIndex];
  return Object.freeze({player,poweredPlayer:fright[i]?poweredPlayer:null,ghost,
    frightenedGhost:fright[i]?frightenedGhost:null,tunnelGhost,eyes:1.6,house:.4,
    powerSeconds:fright[i]*60*REFERENCE_FRAME,nominalPowerSeconds:fright[i],warningFlashes:warningFlashes[i],
    warningSeconds:Math.min(fright[i]*60,128)*REFERENCE_FRAME,
    elroy1,elroy2,elroyDots:Object.freeze([elroyFirst[i],elroyFirst[i]/2]),
    releaseLimits:Object.freeze(i===0?[0,30,60]:i===1?[0,0,50]:[0,0,0]),
    releaseTimeout:(i<4?240:180)*REFERENCE_FRAME,
    scatterChase:schedules[i===0?0:i<4?1:2],
    fruit:Object.freeze({id,name,points}),intermissionAfterClear:({2:1,5:2,9:3,13:3,17:3})[i+1]??null});
});
export function rulesForLevel(level){
  if(!Number.isInteger(level)||level<1||level>256)throw new RangeError('Level must be an integer from 1 to 256.');
  return rows[Math.min(level-1,20)];
}

export const RULES=rows[0];



export const PHASE_SECONDS=Object.freeze({starting:120*REFERENCE_FRAME,respawning:120*REFERENCE_FRAME,
  capture:60*REFERENCE_FRAME,dying:220*REFERENCE_FRAME,clearing:231*REFERENCE_FRAME,intermission:3});
