import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectMutationAssets} from '../scripts/mutation-assets.ts';

const config="const mutations=[{id:'glass',icon:'mut-glass',tier:0,rules:[],prize:{frame:'Frame',banner:'Banner'}}];";
test('mutation assets follow the complete catalog, independent of the current day',()=>{
  const source=config.replace('];',",{id:'new-mode',icon:'custom-icon',tier:1,rules:[],prize:{frame:'Frame',banner:'Banner'}}];");
  assert.deepEqual(inspectMutationAssets(source.replace('mutations','renamed')),[
    'assets/ui/banners/mut-glass.jpg','assets/ui/banners/mut-new-mode.jpg',
    'assets/ui/frames/mut-glass.png','assets/ui/frames/mut-new-mode.png',
    'assets/ui/icons/custom-icon.png','assets/ui/icons/mut-glass.png',
  ]);
});
test('missing, ambiguous, duplicate and unsafe mutation catalogs stop collection',()=>{
  for(const source of [
    'const unrelated=[];',
    config+config.replace('mutations','duplicate'),
    config.replace('];',",{id:'glass',icon:'another',tier:1,rules:[],prize:{frame:'Frame',banner:'Banner'}}];"),
    config.replace("id:'glass'","id:'../glass'"),
    config.replace("icon:'mut-glass'","icon:'../secret'"),
    config.replace("banner:'Banner'","banner:null"),
  ])assert.throws(()=>inspectMutationAssets(source),/mutation/);
});

test('a combined catalog includes generation-specific mutation rewards',()=>{
  const johto=config.replace('mutations','johto').replaceAll('glass','daynight');
  const combined=config+johto+'const combined=[...mutations,...johto];';
  assert.ok(inspectMutationAssets(combined).includes('assets/ui/frames/mut-daynight.png'));
  assert.equal(inspectMutationAssets(combined).length,6);
  assert.throws(()=>inspectMutationAssets(config+johto),/mutation catalog/);
});
