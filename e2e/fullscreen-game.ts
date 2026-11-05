import {_electron as electron} from 'playwright-core';
import type {Page} from 'playwright-core';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {dismissMenuNotices,ensurePlayableMenu} from './game-checks.ts';

const userData=await mkdtemp(path.join(os.tmpdir(),'pokebonk-fullscreen-game-'));
const game=path.resolve(process.argv[2]??'build/game');
const executablePath=process.argv[3];
const args=executablePath?[]:['dist/desktop/main.js'];
if(process.env['CI']&&process.platform==='linux')args.push('--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader');
const app=await electron.launch({args,...(executablePath?{executablePath:path.resolve(executablePath)}:{}),env:{...process.env,POKEBONK_GAME_DIR:game,POKEBONK_USER_DATA_DIR:userData},timeout:120000}).catch(async error=>{await rm(userData,{recursive:true,force:true});throw error;});
let page:Page|undefined;
const startupErrors:string[]=[];
try {
  page=await app.firstWindow();
  page.on('pageerror',error=>startupErrors.push(error.message));
  await page.addInitScript(()=>{
    Reflect.set(window,'__pokebonkSmokeBootState','pending');
    addEventListener('pokebonk:modules-ready',()=>Reflect.set(window,'__pokebonkSmokeBootState','ready'));
    addEventListener('pokebonk:boot-failed',()=>Reflect.set(window,'__pokebonkSmokeBootState','failed'));
  });
  // Install observers before navigation so an early boot refusal is observable.
  await page.reload();
  await page.waitForFunction(()=>window.__pokebonkLocalApp?.meta?.profile?.localSandbox||Reflect.get(window,'__pokebonkSmokeBootState')!=='pending',null,{timeout:120000});
  assert.equal(await page.evaluate(()=>!!window.__pokebonkLocalApp?.meta?.profile?.localSandbox),true,'Upstream entry completed without a local profile');
  await app.evaluate(({app,BrowserWindow})=>{app.focus({steal:true});BrowserWindow.getAllWindows()[0]?.focus();});
  await dismissMenuNotices(page);
  await ensurePlayableMenu(page);
  const toggle=page.locator('.fs-btn');
  await toggle.waitFor({state:'visible',timeout:120000});
  const label=await toggle.getAttribute('aria-label');
  await app.evaluate(({BrowserWindow})=>{
    Reflect.set(globalThis,'nativeEntered',false);
    BrowserWindow.getAllWindows()[0]?.once('enter-full-screen',()=>Reflect.set(globalThis,'nativeEntered',true));
  });
  await toggle.click();
  await page.waitForFunction(()=>!!document.fullscreenElement);
  await app.evaluate(async({BrowserWindow})=>{
    const window=BrowserWindow.getAllWindows()[0];
    if(window&&!Reflect.get(globalThis,'nativeEntered'))await new Promise<void>((resolve,reject)=>{window.once('enter-full-screen',()=>resolve());setTimeout(()=>reject(new Error('Fullscreen transition timed out')),5000);});
  });
  assert.notEqual(await toggle.getAttribute('aria-label'),label);
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]?.isFullScreen()),true);
  await mkdir('evidence',{recursive:true});
  await page.screenshot({path:'evidence/fullscreen-game.png'});
  await toggle.click();
  await page.waitForFunction(()=>!document.fullscreenElement);
  await app.evaluate(async({BrowserWindow})=>{
    const window=BrowserWindow.getAllWindows()[0];
    if(window?.isFullScreen())await new Promise<void>((resolve,reject)=>{window.once('leave-full-screen',()=>resolve());setTimeout(()=>reject(new Error('Exit transition timed out')),5000);});
  });
  assert.equal(await toggle.getAttribute('aria-label'),label);
  await page.getByRole('button',{name:'設定',exact:true}).click();
  await page.getByRole('button',{name:/^操作/}).click();
  const row=page.locator('.st-row').filter({has:page.getByText('全螢幕',{exact:true})});
  await app.evaluate(({BrowserWindow})=>{Reflect.set(globalThis,'nativeEntered',false);BrowserWindow.getAllWindows()[0]?.once('enter-full-screen',()=>Reflect.set(globalThis,'nativeEntered',true));});
  await row.click();
  await page.waitForFunction(()=>!!document.fullscreenElement);
  await app.evaluate(async({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];if(window&&!Reflect.get(globalThis,'nativeEntered'))await new Promise<void>((resolve,reject)=>{window.once('enter-full-screen',()=>resolve());setTimeout(()=>reject(new Error('Settings fullscreen transition timed out')),5000);});});
  await row.locator('.switch.on').waitFor();
  await page.screenshot({path:'evidence/fullscreen-settings.png'});
  await row.click();
  await page.waitForFunction(()=>!document.fullscreenElement);
  // The DOM fullscreen state changes before the game's event handler updates its switch.
  await row.locator('.switch:not(.on)').waitFor({timeout:5000});
  await app.evaluate(async({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];if(window?.isFullScreen())await new Promise<void>((resolve,reject)=>{window.once('leave-full-screen',()=>resolve());setTimeout(()=>reject(new Error('Settings exit transition timed out')),5000);});});
  await page.keyboard.press('Escape');
  await page.evaluate(()=>window.__pokebonkLocalApp.startRun({species:4,biome:'forest',tier:0,boosts:[]}));
  await page.waitForFunction(()=>(window.__pokebonkLocalApp.run?.time??0)>1,null,{timeout:90000});
  await page.keyboard.press('w');
  await page.waitForFunction(()=>document.pointerLockElement?.tagName==='CANVAS');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]?.minimize());
  await page.waitForFunction(()=>document.pointerLockElement===null&&window.__pokebonkLocalApp.run?.state==='paused');
  await app.evaluate(({app,BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];window?.restore();app.focus({steal:true});window?.focus();});
  await page.waitForFunction(()=>document.hasFocus());
  assert.equal(await page.evaluate(()=>window.__pokebonkLocalApp.run?.state),'paused');
  await page.evaluate(()=>window.__pokebonkLocalApp.run?.resume());
  await page.keyboard.press('w');
  await page.waitForFunction(()=>!!document.pointerLockElement&&window.__pokebonkLocalApp.run?.state==='play');
  await writeFile('evidence/fullscreen-game.json',JSON.stringify({observedAt:new Date().toISOString(),executable:executablePath??'development shell',menuButtonEnteredAndExited:true,labelRestored:true,nativeFullscreen:true,settingsSwitchEnteredAndExited:true,minimizeReleasesAndPauses:true,restoreKeepsPaused:true,resumeReacquiresPointer:true},null,2));
  console.log('Actual game fullscreen menu button entered and exited successfully.');
} catch(error) {
  if(page) {
    await mkdir('evidence',{recursive:true});
    await page.screenshot({path:'evidence/fullscreen-game-failure.png'}).catch(()=>{});
    await writeFile('evidence/fullscreen-game-failure.json',JSON.stringify({error:String(error),startupErrors,url:page.url(),text:await page.locator('body').innerText().catch(()=>''),boot:await page.evaluate(()=>Reflect.get(window,'__pokebonkSmokeBootState')).catch(()=>null)},null,2));
  }
  throw error;
} finally {
  try {
    await app.evaluate(({BrowserWindow})=>{for(const window of BrowserWindow.getAllWindows())window.destroy();}).catch(()=>{});
    await app.close();
  } finally { await rm(userData,{recursive:true,force:true}); }
}
