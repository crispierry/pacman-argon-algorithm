import {key,neighbor} from './maze.js';
const directions=['up','left','down','right'];


export function fruitDirection(state){
 if(!state.fruit)return null;
 if(state.player.y===state.fruit.y&&Math.abs(state.player.x-state.fruit.x)<=1)return state.player.x<state.fruit.x?'right':'left';
 const p=state.player,start=p.next??{x:Math.round(p.x),y:Math.round(p.y)};
 const targets=new Set([key(Math.floor(state.fruit.x),state.fruit.y),key(Math.ceil(state.fruit.x),state.fruit.y)]);
 const queue=[{...start,first:null}],seen=new Set([key(start.x,start.y)]);
 for(let i=0;i<queue.length;i++){
  const node=queue[i];
  if(targets.has(key(node.x,node.y))&&node.first)return node.first;
  for(const dir of directions){
   const next=neighbor(node.x,node.y,dir,'player',state.mazeVariant);
   if(!next||seen.has(key(next.x,next.y)))continue;
   seen.add(key(next.x,next.y));queue.push({...next,first:node.first??dir});
  }
 }
 return null;
}
