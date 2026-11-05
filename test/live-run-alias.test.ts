import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {patchLiveRunAlias} from '../scripts/live-run-alias.ts';

const fixture=`function make(){return createLocalSandboxBackend()}
class Meta {pulse(result,stats){this.backend.$renamed?.(this.account,this.ticket,this.report(result,stats,this.snap));}}`;
function invoke(source:string){
  const calls:unknown[][]=[];
  const backend=new Proxy({keepLive(...args:unknown[]){calls.push(args);}}, {get(target,key){if(key in target)return Reflect.get(target,key);throw Error('Unsupported online method');}});
  vm.runInNewContext(source+`;const meta=new Meta();Object.assign(meta,{backend:make(),account:'local',ticket:'ticket',snap:'original',report:(...args)=>args});meta.pulse('result','stats');`,{createLocalSandboxBackend:()=>backend});
  return JSON.stringify(calls);
}
test('renamed live checkpoint reaches the local persistence method with unchanged arguments',()=>{
  assert.throws(()=>invoke(fixture),/Unsupported online method/);
  for(const alias of ['$renamed','keepLive','$future']){
    const source=fixture.replaceAll('$renamed',alias);
    assert.equal(invoke(patchLiveRunAlias(source)),JSON.stringify([['local','ticket',['result','stats','original']]]));
  }
});
test('unknown or ambiguous checkpoint contracts stop preparation',()=>{
  assert.throws(()=>patchLiveRunAlias(fixture.replace('this.snap','this.profile')),/live run backend call/);
  assert.throws(()=>patchLiveRunAlias(fixture+fixture.replace('class Meta','class Duplicate').replace('function make','function other')),/live run backend call/);
});

test('split modules retain the live checkpoint alias across the backend factory import',()=>{
  const factory='function make(){return createLocalSandboxBackend()}';
  const checkpoint=fixture.slice(fixture.indexOf('class Meta'));
  const patched=patchLiveRunAlias(factory,checkpoint);
  assert.equal(invoke(patched+checkpoint),JSON.stringify([['local','ticket',['result','stats','original']]]));
  assert.throws(()=>patchLiveRunAlias(factory,checkpoint.replace('this.snap','this.profile')),/live run backend call/);
});
