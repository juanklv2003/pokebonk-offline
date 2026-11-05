import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectItemIcons} from '../scripts/item-icons.ts';

const config=`const upgrades=[{key:'exp-candy',icon:'rare-candy',stat:'xpGain',per:0.1},{key:'enigma-berry',icon:'enigma-berry',stat:'overheal',per:0.05}];
const held=[{key:'held',mods:[]}];const shop=[{key:'shop',price:1}];`;
const data={'rare-candy':{icon:'items/candy.png'},held:{icon:'items/held.png'},shop:{icon:'items/shop.png'}};

test('item paths use catalog icon tokens and the renderer fallback for missing JSON entries',()=>{
  const expected=['assets/items/candy.png','assets/items/enigma-berry.png','assets/items/held.png','assets/items/poke-ball.png','assets/items/shop.png'];
  assert.deepEqual(inspectItemIcons(config,data),expected);
  assert.deepEqual(inspectItemIcons(config.replaceAll('upgrades','renamed'),data),expected);
  const added=config.replace("stat:'overheal',per:0.05}","stat:'overheal',per:0.05},{key:'new-vitamin',icon:'new-icon',stat:'armor',per:1}");
  assert.ok(inspectItemIcons(added,data).includes('assets/items/new-icon.png'));
  assert.ok(!inspectItemIcons(config,data).includes('assets/items/exp-candy.png'));
  const override={...data,shop:{icon:'items/poke-ball.png'},'poke-ball':{icon:'items/other-ball.png'}};
  assert.ok(inspectItemIcons(config,override).includes('assets/items/poke-ball.png'));
});

test('missing, ambiguous, duplicate or unsafe item catalogs fail explicitly',()=>{
  for(const source of [config.replaceAll('stat:', 'unknown:'),
    config+"const duplicate=[{key:'other',icon:'other',stat:'armor',per:1}];",
    config.replace("key:'enigma-berry'","key:'exp-candy'"),
    config.replace("icon:'enigma-berry'","icon:'../secret'"),
    config.replace("icon:'enigma-berry'","icon:42")]) {
    assert.throws(()=>inspectItemIcons(source,data),/item/);
  }
  assert.throws(()=>inspectItemIcons(config,{...data,'enigma-berry':{icon:'../secret.png'}}),/item icon path/);
  assert.throws(()=>inspectItemIcons(config,{...data,'enigma-berry':null}),/item data entry/);
});

test('passive relic catalogs do not masquerade as held items',()=>{
  assert.deepEqual(inspectItemIcons(config+"const relics=[{key:'r-comet',mods:[],passive:'Comet'}];",data),inspectItemIcons(config,data));
});
