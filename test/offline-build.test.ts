import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {execFileSync,spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {parseMetadata} from '../types/metadata.ts';
import {readSnapshotManifest,writeSnapshot,readSnapshot} from '../scripts/upstream-snapshot.ts';
import {parseManifest} from '../types/metadata.ts';

test('a checked-out snapshot prepares without fetch and rejects candidate publication',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'pokebonk-offline-build-'));
  try {
    const input=await readSnapshotManifest();
    execFileSync(process.execPath,['--import','./test/no-upstream-network.ts','scripts/prepare-game.ts',root],{stdio:'pipe'});
    const metadata=parseMetadata(JSON.parse(await readFile(path.join(root,'offline-build.json'),'utf8')));
    assert.equal(metadata.upstreamBuild,input.upstreamBuild);
    assert.equal(metadata.upstreamVersion,input.upstreamVersion);
    execFileSync(process.execPath,['scripts/verify-game.ts',root],{stdio:'pipe'});
    const manifestPath=path.join(root,'asset-manifest.json'),savedManifest=await readFile(manifestPath,'utf8');
    const payload=parseManifest(JSON.parse(savedManifest));
    for(const omitted of ['assets/ui/icons/exp-bag.png','assets/ui/desktop/forest.webp','assets/env/iris/tiles/grass.png','assets/ui/banners/allcaught.jpg','assets/ui/frames/top100.png','assets/ui/frames/type-fire.png','assets/ui/frames/mon-master.png']) {
      await writeFile(manifestPath,JSON.stringify({...payload,files:payload.files.filter(file=>file.name!==omitted)}));
      const result=spawnSync(process.execPath,['scripts/verify-game.ts',root],{encoding:'utf8'});
      assert.notEqual(result.status,0);assert.ok(result.stderr.includes(`Missing required resource: ${omitted}`));
    }
    await writeFile(manifestPath,savedManifest);
    const plan=execFileSync(process.execPath,['--import','./test/no-upstream-network.ts','scripts/check-update.ts'],{encoding:'utf8',env:{...process.env,POKEBONK_PUBLISH:'false',GITHUB_OUTPUT:''},stdio:'pipe'});
    assert.match(plan,new RegExp(`snapshotDigest=${input.digest}`));
    const candidate=spawnSync(process.execPath,['--import','./test/no-upstream-network.ts','scripts/check-update.ts','cache/upstream-candidate'],{encoding:'utf8',env:{...process.env,POKEBONK_PUBLISH:'true',GITHUB_OUTPUT:''}});
    assert.notEqual(candidate.status,0);assert.match(candidate.stderr,/Only the repository snapshot can be published/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('a failed sync cannot replace the previous candidate or committed snapshot',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'pokebonk-failed-sync-'));
  try {
    const files=new Map([['index.html',Buffer.from('<meta name="pokebonk-build" content="previous">')]]);
    const candidate=path.join(root,'candidate');
    await writeSnapshot(candidate,files,'previous','0.8.77');
    const result=spawnSync(process.execPath,['--import','./test/no-upstream-network.ts','scripts/sync-upstream.ts',candidate],{encoding:'utf8'});
    assert.notEqual(result.status,0);assert.match(result.stderr,/Network is disabled/);
    assert.deepEqual((await readSnapshot(candidate)).files,files);
  }finally{await rm(root,{recursive:true,force:true});}
});
