import {SPLIT_MAP} from './split-map.js';


export const MAZE = [
  '############################',
  '#............##............#',
  '#.####.#####.##.#####.####.#',
  '#o####.#####.##.#####.####o#',
  '#.####.#####.##.#####.####.#',
  '#..........................#',
  '#.####.##.########.##.####.#',
  '#.####.##.########.##.####.#',
  '#......##....##....##......#',
  '######.##### ## #####.######',
  '_____#.##### ## #####.#_____',
  '_____#.##          ##.#_____',
  '_____#.## ###==### ##.#_____',
  '######.## #HHHHHH# ##.######',
  '      .   #HHHHHH#   .      ',
  '######.## #HHHHHH# ##.######',
  '_____#.## ######## ##.#_____',
  '_____#.##          ##.#_____',
  '_____#.## ######## ##.#_____',
  '######.## ######## ##.######',
  '#............##............#',
  '#.####.#####.##.#####.####.#',
  '#.####.#####.##.#####.####.#',
  '#o..##.......  .......##..o#',
  '###.##.##.########.##.##.###',
  '###.##.##.########.##.##.###',
  '#......##....##....##......#',
  '#.##########.##.##########.#',
  '#.##########.##.##########.#',
  '#..........................#',
  '############################',
];
export const WIDTH = 28, HEIGHT = 31, TUNNEL_Y = 14, HORIZONTAL_PERIOD=32;
export const key = (x,y) => `${x},${y}`;

export const splitWrapX=x=>((x+2)%HORIZONTAL_PERIOD+HORIZONTAL_PERIOD)%HORIZONTAL_PERIOD-2;
export const splitDisplayY=y=>((y+1.5)%32+32)%32-1.5;


export const splitScreenAddress=(x,y)=>((27-x)&31)*32+((y+1)&255)+64;
export const splitScreenOffset=(x,y)=>splitScreenAddress(x,y)&1023;
const splitWalls=(()=>{
  const walls=new Uint8Array(1024);
  for(let row=0;row<SPLIT_MAP.ghostRows.length;row++)for(let x=0;x<WIDTH;x++){
    const y=SPLIT_MAP.ghostOriginY+row;
    if(SPLIT_MAP.ghostRows[row][x]==='#')walls[splitScreenOffset(x,y)]=1;
  }
  return walls;
})();


const splitColorWallBytes=new Set([162,163,194,195,238,239,240,241,242,243,244,245]);
export function splitGhostCanEnterLookahead(x,y){
  const offset=splitScreenAddress(x,y);
  return offset<1024?!splitWalls[offset]:!splitColorWallBytes.has(offset-1024);
}
const splitTargetColors=new Set(SPLIT_MAP.restrictedUpTiles.map(([x,y])=>splitScreenOffset(x,y)));
const splitTunnelColors=new Set(SPLIT_MAP.slowTiles.flatMap(([x,y])=>[-1,0,1].map(dy=>splitScreenOffset(x,y+dy))));
export function tile(x,y,variant='normal',kind='player') {
  if(variant!=='split-256')return MAZE[y]?.[x]??'#';
  if(SPLIT_MAP.readyCells.some(p=>p[0]===x&&p[1]===y))return ' ';
  if(kind!=='player'&&Number.isInteger(x)&&Number.isInteger(y))return splitGhostCanEnterLookahead(x,y)?' ':'#';
  const rows=kind==='player'?SPLIT_MAP.playerRows:SPLIT_MAP.ghostRows,origin=kind==='player'?-1:-33;
  return rows[y-origin]?.[x]??'#';
}
export function canEnter(x,y,kind='player',variant='normal') {
  if(variant==='split-256'&&(x<0||x>=WIDTH))return true;
  if(variant==='normal'&&y===TUNNEL_Y&&x>=-2&&x<=29&&(x<0||x>=WIDTH))return true;
  const t = tile(x,y,variant,kind);
  return t !== '#' && t !== '_' && (kind === 'house' || (t !== 'H' && t !== '='));
}
export function neighbor(x,y,dir,kind='player',variant='normal') {
  const delta = {up:[0,-1],left:[-1,0],down:[0,1],right:[1,0]}[dir];
  if (!delta) return null;
  let nx=x+delta[0], ny=y+delta[1];
  if(variant==='split-256'){
    if(kind==='player'&&(x<=0||x>=27)&&delta[1])return null;
    nx=splitWrapX(nx);



    if(kind==='player'&&ny< -1)return canEnter(splitWrapX(nx-7),30,kind,variant)?{x:nx,y:ny+32}:null;
    if(kind==='player'&&ny>30)return canEnter(splitWrapX(nx-1),-1,kind,variant)?{x:nx,y:ny-32}:null;
    if((x<=0||x>=27)&&(kind!=='player'||delta[0]))return {x:nx,y:ny};
  }else if (ny === TUNNEL_Y) nx = splitWrapX(nx);
  return canEnter(nx,ny,kind,variant) ? {x:nx,y:ny} : null;
}
export function collectibles() {
  const result = new Map();
  MAZE.forEach((row,y) => [...row].forEach((t,x) => { if (t === '.' || t === 'o') result.set(key(x,y),t); }));
  return result;
}

export function splitCollectibles(rightOnly=false){
  const pairs=rightOnly?[]:SPLIT_MAP.leftDots.map(([x,y])=>[key(x,y),'.']);
  if(!rightOnly)pairs.push(...SPLIT_MAP.leftEnergizers.map(([x,y])=>[key(x,y),'o']));
  pairs.push(...SPLIT_MAP.rightDots.map(([x,y])=>[key(x,y),'.']));return new Map(pairs);
}
export function viewForLevel(level){
  return level===256?{variant:'split-256',width:28,height:32,originY:-1,visualCells:SPLIT_MAP.visualCells,
    collectibleAppearance:SPLIT_MAP.collectibleAppearance}:{variant:'normal',width:28,height:31,originY:0,visualCells:null};
}
export function restrictedUp(x,y,variant='normal'){

  if(variant==='split-256')return false;
  return (y===11||y===23)&&(x===12||x===15);
}
export function slowZone(x,y,variant='normal'){
  return variant==='split-256'?(splitScreenAddress(x,y)<1024&&splitTunnelColors.has(splitScreenOffset(x,y))):y>=13&&y<=15&&((x>=0&&x<=4)||(x>=23&&x<=27));
}


export function suppressTargetSchedule(x,y,variant='normal'){
  return variant==='split-256'&&splitScreenAddress(x,y)<1024&&splitTargetColors.has(splitScreenOffset(x,y));
}
