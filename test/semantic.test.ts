import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {ast,nodesOf,maybeName} from '../scripts/source.ts';
import { patchGame } from '../scripts/patch-game.ts';

const config = `
const rosterSymbol=[{id:4,start:true,kit:[],passive:'flame'}];
const labSymbol=[{id:'slot-move',max:1,cost:()=>1}];
const shopSymbol=[{key:'soda-pop',price:1}];
const biomeSymbol=[{id:'forest',size:10}];
const seasonSymbol={maxDex:151,season:2};
const versionsSymbol={'data/pokemon.json':'a',models:'b',pmd:'c'};
const rankSymbol=[{id:'champion',name:'Champion',icon:'champion'}];
const questSymbol=[{id:'k100',counter:'kills',goal:100,reward:50}];
const preparationSymbol=[{id:'rare-candy',desc:'Preparation'}];
const scoreSymbol=r=>r.kills+r.time+(r.victory?1:0);
const assetSymbol=e=>\`./assets/\${e}\`;
const dataSymbol=e=>\`./data/\${e}\`;
function wardrobeSymbol(p,m,look,x){switch(look){case 'shiny':case 'spectral':case 'classic':case 'm1':case 'm2':return false;}}
export {questSymbol as questExport,rosterSymbol as rosterExport,labSymbol as labExport,shopSymbol as shopExport,biomeSymbol as biomeExport,scoreSymbol as scoreExport};`;
const main = `
import {questExport as questAlias,rosterExport as rosterAlias,labExport as labAlias,shopExport as shopAlias,biomeExport as biomeAlias,scoreExport as scoreAlias} from './config.js';
const registrySymbol=new class{pokemon=[];movesByKey=new Map;};
function profileSymbol(){return {stardust:0,lab:{},league:[],lastSpecies:4,settings:{}};}
function backendSymbol(){return new Http('https://api.pokebonk.com');}
class Http{season(){return this.info??seasonFunction(Date.now());}}
function refreshSymbol(p,now){for(const period of ['daily','weekly'])p[period]={idx:now,ids:['task1','task2','task3'],prog:[0,0,0],claimed:[0,0,0,0]};}
function taskSymbol(id){return {goal:3};}
function progressSymbol(p,q){return p.counters[q.counter]??0;}
class Application{boot(){}tasksReady(){refreshSymbol(this.profile,Date.now());}task(period,index){return taskSymbol(this.profile[period].ids[index]);}claimable(){return questAlias.filter(q=>!this.profile.quests[q.id]).length;}questProgress(q){return progressSymbol(this.profile,q);}}
await new Application().boot();`;

test('semantic patches survive renamed upstream identifiers',()=>{
  const rename = (source:string) => source.replace(/\b\w*(?:Symbol|Alias|Export)\b/g, (name:string)=>'renamed_'+name);
  const result=patchGame(rename(main),rename(config),'const catalogs=[__ROSTER__,__LAB__,__ITEMS__,__BIOMES__];const profile=__PROFILE__;const score=__SCORE__;');
  assert.match(result.main,/p\.localSandbox&&p\.quests\[q\.id\]\)return q\.goal/);
  assert.match(result.main,/const catalogs=\[renamed_rosterAlias/);
  assert.match(result.main,/window\.__pokebonkLocalApp=new Application/);
  assert.match(result.config,/p\.localSandbox&&p\.league\.includes\(m\)/);
  assert.match(result.config,/document\.baseURI/);
});
test('registry discovery supports constructor helpers and formatted native fields',()=>{
  const original='pokemon=[];movesByKey=new Map;';
  for(const fields of [
    'pokemon = []; movesByKey = new Map();',
    'constructor(){renamed(this,`pokemon`,[]),renamed(this,`movesByKey`,new Map)}',
  ]) {
    const result=patchGame(main.replace(original,fields),config,'const dex=__REGISTRY__;');
    assert.match(result.main,/const dex=registrySymbol;/);
  }
});
test('registry discovery rejects missing, misleading and ambiguous initializations',()=>{
  const original='pokemon=[];movesByKey=new Map;';
  for(const fields of [
    'pokemon=[];unrelated=new Map;',
    'static pokemon=[];movesByKey=new Map;',
    'pokemon=[];movesByKey="movesByKey";',
    'constructor(){helper(other,`pokemon`,[]),helper(other,`movesByKey`,new Map)}',
    'constructor(){helper(this,`pokemon`,{}),helper(this,`movesByKey`,new Map)}',
    'method(){helper(this,`pokemon`,[]),helper(this,`movesByKey`,new Map)}',
  ])assert.throws(()=>patchGame(main.replace(original,fields),config,''),/Pokédex registry/);
  assert.throws(()=>patchGame(main+'const duplicate=new class{pokemon=[];movesByKey=new Map;};',config,''),/Pokédex registry: expected one match, got 2/);
});
test('missing wardrobe cases reject the complete patch',()=>{
  assert.throws(()=>patchGame(main,config.replace("case 'm2':",''),''),/wardrobe eligibility/);
});

test('incompatible achievement catalogs fail closed',()=>{
  assert.throws(()=>patchGame(main,config.replace("counter:'kills',goal:100", "counter:'kills',goal:NaN"),''),/achievement catalog/);
});

test('period changes grant local task rewards while ordinary profiles keep progression',()=>{
  const patched=patchGame(main,config,'').main;
  const functions=nodesOf(ast(patched),'FunctionDeclaration',n=>['refreshSymbol','taskSymbol'].includes(maybeName(n.id) ?? '')).map(n=>patched.slice(n.start,n.end)).join('\n');
  for(const localSandbox of [false,true]) {
    const p: {localSandbox:boolean;daily?:{idx:number;prog:number[]};weekly?:{claimed:number[]}}={localSandbox};
    new vm.Script(functions+';refreshSymbol(p,42);').runInNewContext({p});
    assert.equal(p.daily?.idx,42);assert.equal(p.daily?.prog.join(','),localSandbox?'3,3,3':'0,0,0');
    assert.equal(p.weekly?.claimed.join(','),localSandbox?'1,1,1,1':'0,0,0,0');
  }
});

test('split menu modules keep profile and reward patches in their owning module',()=>{
  const menus=main
    .replace("function backendSymbol(){return new Http('https://api.pokebonk.com');}",'')
    .replace('class Http{season(){return this.info??seasonFunction(Date.now());}}','function seasonFunction(){return {season:2};} export {seasonFunction as seasonExport,registrySymbol as registryExport};')
    .replace('await new Application().boot();','')
    .replace(',scoreExport as scoreAlias','');
  const application=`import {seasonExport as renamedSeason,registryExport as registry} from './menus.js';
    function backendSymbol(){return new Http('https://api.pokebonk.com');}
    class Http{season(){return this.info??renamedSeason(Date.now());}}
    class Shell{boot(){}} await new Shell().boot();`;
  const result=patchGame(application,config,'const profile=__PROFILE__;const season=__SEASON__;const score=__SCORE__;function createLocalSandboxBackend(){}',{source:menus,path:'./menus.js'});
  assert.match(result.main,/import \{createLocalSandboxBackend\} from "\.\/menus.js"/);
  assert.match(result.main,/window\.__pokebonkLocalApp=new Shell/);
  assert.ok(result.menus);
  assert.match(result.menus,/const profile=profileSymbol;const season=seasonFunction;/);
  assert.match(result.menus,/p\.localSandbox&&p\.quests\[q\.id\]/);
  assert.match(result.menus,/export \{createLocalSandboxBackend\}/);
  assert.match(result.menus,/import \{scoreExport as __pokebonkConfig_scoreSymbol\} from "\.\/config.js"/);
  assert.doesNotMatch(result.main,/const profile=profileSymbol/);
  assert.throws(()=>patchGame(application,config,'',{source:menus.replace('seasonFunction as seasonExport','seasonFunction as wrongExport'),path:'./menus.js'}),/season/);
  assert.throws(()=>patchGame(application.replace('seasonExport as renamedSeason,','').replace('function backendSymbol()',"import {seasonExport as renamedSeason} from './unknown.js'; function backendSymbol()"),config,'',{source:menus,path:'./menus.js'}),/unknown season module/);
});

test('nested achievement cosmetics include banner, avatar and frame rewards',()=>{
  const awarded=config.replace("reward:50}","reward:50,prizes:[{id:'bg:allcaught'},{id:'tr:pokemaster'},{id:'frame:allcaught'}]}");
  const result=patchGame(main,awarded,'const unlocked=__COSMETICS__;');
  for(const id of ['bg:allcaught','tr:pokemaster','frame:allcaught'])assert.ok(result.main.includes(JSON.stringify(id)));
});
