import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {patchOptionalLookFrames} from '../scripts/optional-look-frames.ts';
import {record} from '../types/data.ts';
const fixture='function frame(){let choice=resolve();if(!choice)return null;let image=createImage();image.src=url(`ui/frames/${choice.frame??`look-`+choice.style}.png`);image.onerror=()=>{image.onerror=null;image.remove()};return image;}';
function render(source:string,choice:unknown):unknown{return vm.runInNewContext(source+';frame();',{resolve:()=>choice,createImage:()=>({remove(){}}),url:(path:string)=>path});}
test('only known absent optional style frames skip their existing remove-on-error path',()=>{
  const other='function equipped(frame){return url(`ui/frames/${frame}.png`)}';
  assert.ok(patchOptionalLookFrames(fixture+other).includes(other));
  for(const style of ['ember','verdant','tidal']) {
    assert.ok(render(fixture,{style}));
    assert.equal(render(patchOptionalLookFrames(fixture),{style}),null);
    assert.equal(record(render(patchOptionalLookFrames(fixture),{style,frame:'explicit'}))['src'],'ui/frames/explicit.png');
  }
  assert.equal(record(render(patchOptionalLookFrames(fixture),{style:'holo'}))['src'],'ui/frames/look-holo.png');
  assert.equal(render(patchOptionalLookFrames(fixture),null),null);
});
test('missing or ambiguous optional frame ownership rejects',()=>{
  assert.throws(()=>patchOptionalLookFrames('function unrelated(){}'),/optional look frame/);
  assert.throws(()=>patchOptionalLookFrames(fixture+fixture.replace('function frame','function duplicate')),/optional look frame/);
});
