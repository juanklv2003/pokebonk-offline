import {parseMetadata} from '../types/metadata.ts';
import type {ElectronApplication} from 'playwright-core';
import {_electron as electron} from 'playwright-core';
import {readFile,mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {checkGame,dismissMenuNotices} from './game-checks.ts';
import {focusNativeInput} from './native-input-focus.ts';
import {checkOfflineFriends} from './friends-checks.ts';
import {checkRunSaves,checkCorruptRecovery} from './run-save-checks.ts';
import {checkAppearanceAssets} from './appearance-checks.ts';
const game=path.resolve(process.argv[2]??'build/game');
const executablePath=process.argv[3];
const userData=await mkdtemp(path.join(os.tmpdir(),'pokebonk-e2e-'));
const metadata=parseMetadata(JSON.parse(await readFile(path.join(game,'offline-build.json'),'utf8')));
const options={env:{...process.env,POKEBONK_GAME_DIR:game,POKEBONK_USER_DATA_DIR:userData},timeout:120000,args:executablePath?[]:['dist/desktop/main.js'],...(executablePath?{executablePath:path.resolve(executablePath)}:{})};
// SwiftShader is required for headless Linux; macOS uses its native Metal backend.
if(process.env['CI'] && process.platform==='linux')options.args.push('--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader');
await mkdir('evidence',{recursive:true});
let app: ElectronApplication | undefined;
const errors: string[]=[],missing: {url:string;status:number}[]=[],external: string[]=[];
try {
  app=await electron.launch(options);
  let page=await app.firstWindow();
  if(executablePath)assert.equal(await app.evaluate(({app})=>app.getVersion()),metadata.offlineVersion,'Packaged native version must match offline release');
  const isolation=await app.evaluate(({BrowserWindow})=>{
    const window=BrowserWindow.getAllWindows()[0];
    if(!window)throw new Error('No Electron window');
    // Electron exposes this runtime method without a public declaration.
    const read: unknown=Reflect.get(window.webContents,'getLastWebPreferences');
    if(typeof read!=='function')throw new Error('Missing Electron preferences probe');
    const value: unknown=read.call(window.webContents);
    if(typeof value!=='object'||value===null)throw new Error('Invalid Electron preferences');
    const p=value as Record<string,unknown>;
    return {sandbox:p['sandbox'],nodeIntegration:p['nodeIntegration'],contextIsolation:p['contextIsolation'],webSecurity:p['webSecurity']};
  });
  assert.deepEqual(isolation,{sandbox:true,nodeIntegration:false,contextIsolation:true,webSecurity:true});
  const observe=(page:import('playwright-core').Page)=>{
  page.on('pageerror',e=>errors.push(e.message));
  page.on('response',r=>{if(r.status()>=400)missing.push({url:r.url(),status:r.status()});});
  page.on('request',r=>{if(/^(https?|wss?):/.test(r.url()))external.push(r.url());});
  };
  observe(page);
  await app.evaluate(({app,BrowserWindow})=>{app.focus({steal:true});BrowserWindow.getAllWindows()[0]?.focus();});
  await page.waitForFunction(()=>document.hasFocus());
  await page.waitForFunction(()=>window.__pokebonkLocalApp?.meta?.profile?.localSandbox,null,{timeout:120000});
  await dismissMenuNotices(page);
  await checkOfflineFriends(page);
  await page.locator('.dk-btn').click();
  await page.locator('.dk-card .dk-ic svg').first().waitFor({state:'visible'});
  assert.equal(await page.locator('.dk-card .dk-ic svg').count(),4);
  await page.locator('.dk-scr img').evaluateAll(async images=>{
    await Promise.all(images.map(async image=>{
      if(!(image instanceof HTMLImageElement))throw new Error('Invalid desktop page image');
      await image.decode();
      if(!image.naturalWidth)throw new Error('Undecoded desktop page image: '+image.src);
    }));
  });
  assert.equal(await page.locator('.dk-bg').count(),5);
  await page.locator('.dk-bg').evaluateAll(async backgrounds=>{
    await Promise.all(backgrounds.map(async element=>{
      const url=/^url\(["']?(.*?)["']?\)$/.exec(getComputedStyle(element).backgroundImage)?.[1];
      if(!url)throw new Error('Missing desktop CSS background');
      const image=new Image();image.src=url;await image.decode();
      if(!image.naturalWidth)throw new Error('Undecoded desktop CSS background: '+url);
    }));
  });
  await page.screenshot({path:'evidence/electron-desktop-page.png'});
  await page.keyboard.press('Escape');
  await checkAppearanceAssets(page);
  await checkGame(page,metadata,executablePath?'electron-packaged':'electron',{pointerLock:true,focusPointerInput:async()=>{if(!app)throw new Error('Missing Electron application');await focusNativeInput(app);}});
  const restart=async(ready=true)=>{
    if(!app)throw Error('Missing native application');
    await app.evaluate(({BrowserWindow})=>{for(const window of BrowserWindow.getAllWindows())window.destroy();});
    await app.close();app=await electron.launch(options);
    const next=await app.firstWindow();observe(next);
    if(ready){
      await next.waitForFunction(()=>window.__pokebonkLocalApp?.meta?.profile?.localSandbox,null,{timeout:120000});
      await next.locator('.mm-nav').waitFor({state:'visible',timeout:30000});
    }
    return next;
  };
  page=await checkRunSaves(page,()=>restart(),async()=>{if(!app)throw Error('Missing native application');await focusNativeInput(app);});
  page=await checkCorruptRecovery(page,()=>restart(false));
  assert.deepEqual(external,[]);assert.deepEqual(missing,[]);assert.deepEqual(errors,[]);
  const gameRequests=[...external];
  assert.equal(await page.evaluate(()=>fetch('https://example.com/').then(()=>false,()=>true)),true,'Network must be blocked');
  await writeFile('evidence/electron-network.json',JSON.stringify({gameRequests,missing,errors,networkBlocked:true},null,2));
  console.log('Electron runtime, unlocks, persistence and network isolation passed.');
} catch(error) {
  if(app) {
    const pages=app.windows();
    const page=pages[0];
    if(page) {
      await page.screenshot({path:'evidence/electron-failure.png'}).catch(()=>{});
      await writeFile('evidence/electron-failure.json',JSON.stringify({errors,missing,external,url:page.url(),runtime:await page.evaluate(()=>({visibility:document.visibilityState,focused:document.hasFocus(),savedDialogs:document.querySelectorAll('.sv-card').length,run:window.__pokebonkLocalApp?.run?{state:window.__pokebonkLocalApp.run.state,time:window.__pokebonkLocalApp.run.time}:null})).catch(()=>null),text:await page.locator('body').innerText().catch(()=>''),error:String(error)},null,2));
    }
  }
  throw error;
} finally {
  if(app) {
    // Test profiles are disposable. Bypass gameplay beforeunload dialogs so a
    // failed assertion remains visible instead of a teardown dialog race.
    await app.evaluate(({BrowserWindow})=>{for(const window of BrowserWindow.getAllWindows())window.destroy();});
    await app.close();
  }
  await rm(userData,{recursive:true,force:true});
}
