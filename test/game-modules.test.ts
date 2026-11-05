import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gameModules} from '../scripts/game-modules.ts';

const profile='function defaults(){return {stardust:0,lab:{},league:[],lastSpecies:4,settings:{}};}';
const application='class Application{} export{Application as App}';
const config="const marker='slot-move';";
const files=(entries:[string,string][])=>new Map(entries.map(([name,source])=>[name,Buffer.from(source)]));

test('module discovery handles integrated and directly imported menu ownership',()=>{
  const integrated=gameModules(files([['assets/main.js',profile+application],['assets/config.js',config]]));
  assert.equal(integrated.menus.name,integrated.main.name);
  assert.equal(integrated.menuPath,undefined);
  const split=gameModules(files([['assets/main.js',"import {menu} from './menus.js';import {backend} from './menus.js';"+application],['assets/config.js',config],['assets/menus.js',profile+"const label='slot-move';"]]));
  assert.equal(split.menus.name,'assets/menus.js');
  assert.equal(split.menuPath,'./menus.js');
});

test('missing, ambiguous and disconnected profile modules reject',()=>{
  const base:[string,string][]=[['main.js',application],['config.js',config]];
  assert.throws(()=>gameModules(files(base)),/profile module/);
  assert.throws(()=>gameModules(files([...base,['menus.js',profile]])),/application menu import/);
  assert.throws(()=>gameModules(files([...base,['menus.js',profile],['duplicate.js',profile]])),/profile module/);
});
