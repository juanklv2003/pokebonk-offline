import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ast, edits, one, configContext } from '../scripts/source.ts';
import { inspectGame } from '../scripts/patch-game.ts';
test('unknown upstream fails closed before generating a package',()=>{
  assert.throws(()=>inspectGame('export {};','export {};'),/Unsupported upstream/);
});
test('downloaded configuration has no process access or dynamic code generation',()=>{
  assert.throws(()=>configContext('const escape=Function("return process")(); export {};'),/Code generation/);
  assert.throws(()=>configContext('const secret=process.env; export {};'),/process is not defined/);
  assert.equal(configContext('const f=()=>1; export {};').values['f'],'__function__');
});
test('source edits reject overlap and invalid JavaScript',()=>{
  assert.throws(()=>edits('let a=1;',[{start:0,end:5,text:''},{start:4,end:7,text:''}]),/Overlapping/);
  assert.throws(()=>edits('let a=1;',[{start:0,end:8,text:'let = ;'}]));
  assert.throws(()=>one([1,2],'ambiguous'),/expected one/);
  assert.equal(ast('const renamed = 2;').body.length,1);
});

test('split season imports resolve against their owning configuration module', async()=>{
  const {readFile,readdir}=await import('node:fs/promises');
  const {gameModules}=await import('../scripts/game-modules.ts');
  const root=new URL('../vendor/pokebonk/game/',import.meta.url);
  const paths=await readdir(root,{recursive:true});
  const files=new Map(await Promise.all(paths.filter(p=>p.endsWith('.js')).map(async p=>[p,await readFile(new URL(p,root))] as const)));
  const modules=gameModules(files);
  const info=inspectGame(modules.main.source,modules.config.source,modules.menus.source);
  const season=info.extraImports.find(binding=>binding.local===info.aliases.season);
  assert.ok(season,'configuration season calculator must be imported into menus');
  // Export names are only unique within a module: menus reuses this name for a number.
  const {nodesOf,maybeName}=await import('../scripts/source.ts');
  assert.equal(nodesOf(info.configTree,'FunctionDeclaration',n=>maybeName(n.id)===info.aliases.season.replace('__pokebonkConfig_','')).length,1);
  const collision=one(nodesOf(info.tree,'ExportSpecifier',n=>maybeName(n.exported)===season.imported),'menu export collision');
  assert.ok(nodesOf(info.tree,'VariableDeclarator',n=>maybeName(n.id)===maybeName(collision.local)&&n.init?.type==='Literal').length);
});
