import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readSnapshot} from '../scripts/upstream-snapshot.ts';
import {assertRequiredResources,assertReviewedInputs,readResourceContract,parseResourceContract,validResourceImage} from '../scripts/resource-contract.ts';

const png='assets/ui/icons/exp-bag.png',webp='assets/ui/desktop/forest.webp';
test('requirements remain independent of a self-consistent downloaded-file manifest',async()=>{
  const contract=await readResourceContract(),{files}=await readSnapshot();
  assertRequiredResources(new Set(files.keys()),contract);
  for(const missing of [png,webp,'assets/env/iris/tiles/grass.png','assets/ui/relics/r-comet.png','assets/ui/frames/top100.png','assets/ui/frames/type-fire.png','assets/ui/frames/mon-master.png']) {
    const inventory=new Set(files.keys());inventory.delete(missing);
    assert.throws(()=>assertRequiredResources(inventory,contract),/Missing required resource/);
  }
});
test('changed indirect tables, CSS paths, data and new URL producers require review',async()=>{
  const contract=await readResourceContract(),{files,manifest}=await readSnapshot();
  assertReviewedInputs(files,manifest.upstreamBuild,contract);
  for(const suffix of ['.js','.css','.json']) {
    const input=contract.inputs.find(input=>input.name.endsWith(suffix));assert.ok(input);
    const original=files.get(input.name);assert.ok(original);
    const changed=new Map(files);changed.set(input.name,Buffer.concat([original,Buffer.from('\n/* new resource producer */')]));
    assert.throws(()=>assertReviewedInputs(changed,manifest.upstreamBuild,contract),/Unreviewed upstream resource inputs/);
  }
  const added=new Map(files);added.set('assets/new-producer.js',Buffer.from('fetch(dynamicPath)'));
  assert.throws(()=>assertReviewedInputs(added,manifest.upstreamBuild,contract),/input inventory changed/);
  assert.throws(()=>assertReviewedInputs(files,'new-build',contract),/build changed/);
});
test('contract rejects duplicate requirements, missing input membership and unsafe paths',()=>{
  const base={schemaVersion:1,upstreamBuild:'fixture',inputs:[{name:'index.html',sha256:createHash('sha256').update('html').digest('hex')}],required:['index.html',png]};
  assert.deepEqual(parseResourceContract(base).required,base.required);
  assert.throws(()=>parseResourceContract({...base,required:[...base.required,png]}),/duplicate/);
  assert.throws(()=>parseResourceContract({...base,required:[png]}),/must be required/);
  for(const name of ['../secret','/absolute','assets/.hidden','assets//bad'])assert.throws(()=>parseResourceContract({...base,required:['index.html',name]}),/Invalid resource contract path/);
});
test('PNG and CSS WebP bytes cannot be HTML error pages with consistent hashes',()=>{
  assert.equal(validResourceImage(png,Buffer.from('<!doctype html>')),false);
  assert.equal(validResourceImage(webp,Buffer.from('<!doctype html>')),false);
  assert.equal(validResourceImage(webp,Buffer.from('RIFF0000WEBP')),true);
});
