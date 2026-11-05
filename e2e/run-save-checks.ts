import type {Page} from 'playwright-core';
import assert from 'node:assert/strict';
import {dismissMenuNotices} from './game-checks.ts';

// Both restarts terminate the actual native process and reopen its disposable
// profile. A renderer reload cannot prove a saved run survives process loss.
export async function checkRunSaves(page:Page,restart:()=>Promise<Page>,focus:()=>Promise<void>) {
  const baseline=await page.evaluate(()=>({runs:window.__pokebonkLocalApp.meta.profile.runs.length,hold:window.__pokebonkLocalApp.meta.profile.counters['holdSecs']??0}));
  let previousHold=baseline.hold;
  for(const kind of ['manual','auto'] as const) {
    await page.evaluate(()=>window.__pokebonkLocalApp.startRun({species:4,biome:'forest',tier:0,boosts:[]}));
    await page.waitForFunction(()=>(window.__pokebonkLocalApp.run?.time??0)>3,null,{timeout:30000});
    if(kind==='manual') {
      await page.evaluate(()=>{const run=window.__pokebonkLocalApp.run;if(!run)throw Error('Missing run');run.input.releaseLock();run.pause();});
      await page.waitForFunction(()=>document.pointerLockElement===null&&window.__pokebonkLocalApp.run?.state==='paused');
      await focus();
      await page.getByRole('button',{name:'儲存並退出',exact:true}).click();
      await page.waitForFunction(()=>!window.__pokebonkLocalApp.run,null,{timeout:15000});
    } else {
      await page.evaluate(()=>{const run=window.__pokebonkLocalApp.run;if(!run)throw Error('Missing run');run.nextAuto=0;run.checkpoint();});
      await page.waitForFunction(()=>localStorage.getItem('pb.runauto.local-sandbox')!==null,null,{timeout:15000});
    }
    const key=kind==='manual'?'pb.runsave.local-sandbox':'pb.runauto.local-sandbox';
    const saved=await page.evaluate(key=>{
      const raw:unknown=JSON.parse(localStorage.getItem(key)??'null');
      if(typeof raw!=='object'||raw===null||!('save' in raw)||typeof raw.save!=='string')throw Error('Missing saved run');
      const body:unknown=JSON.parse(raw.save);
      if(typeof body!=='object'||body===null||!('summary' in body)||typeof body.summary!=='object'||body.summary===null||!('time' in body.summary)||typeof body.summary.time!=='number')throw Error('Missing saved time');
      return {raw:localStorage.getItem(key),time:body.summary.time};
    },key);
    page=await restart();
    // A restarted process has a new native focus target. Establish it before
    // sending the recovery click, as for the initial gameplay input checks.
    await focus();
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),saved.raw,'Startup must preserve the saved blob');
    // This resumes a scene in the same document. Chromium's post-input
    // navigation epilogue can stall with the CI software-GPU notice behind it.
    // Wait for actual recovery below instead of an unrelated navigation.
    await page.locator('.sv-card').getByRole('button',{name:'繼續',exact:true}).click({noWaitAfter:true});
    const restoreStarted=Date.now();
    // Observe the owning document and simulation together. A locator-world
    // checkpoint can remain pending while this native scene is already restored.
    await page.waitForFunction(()=>{const run=window.__pokebonkLocalApp.run;return !document.querySelector('.sv-card')&&run&&(run.state==='play'||run.state==='paused');},null,{timeout:90000,polling:100});
    console.log('Native',kind,'restored scene ready after',Date.now()-restoreStarted,'ms');
    await dismissMenuNotices(page);
    await focus();
    await page.evaluate(()=>window.__pokebonkLocalApp.run?.resume());
    await page.waitForFunction(time=>(window.__pokebonkLocalApp.run?.time??0)>time+.5,saved.time,{timeout:30000});
    const time=await page.evaluate(async()=>{
      const app=window.__pokebonkLocalApp,run=app.run;if(!run)throw Error('Missing restored run');
      const time=run.time;run.endHow='quit';await run.finish(false,true);app.toMenu();return time;
    });
    const profile=await page.evaluate(()=>window.__pokebonkLocalApp.meta.profile);
    assert.equal(profile.runs.length,baseline.runs+(kind==='manual'?1:2));
    const hold=profile.counters['holdSecs']??0;
    assert.ok(Math.abs(hold-previousHold-Math.floor(time))<=1,'Recovered play time must be awarded once');
    previousHold=hold;
    assert.equal(await page.evaluate(()=>localStorage.getItem('pokebonk.local.pending.v1')),null);
    assert.equal(await page.evaluate(()=>localStorage.getItem('pb.runauto.local-sandbox')),null);
    console.log('Native',kind,'save, process restart, recovery and settlement passed');
  }
  page=await restart();
  assert.equal(await page.locator('.sv-card').count(),0,'Settled saves must not be offered again');
  assert.equal((await page.evaluate(()=>window.__pokebonkLocalApp.meta.profile)).runs.length,baseline.runs+2);
  return page;
}

export async function checkCorruptRecovery(page:Page,restart:()=>Promise<Page>) {
  const before=await page.evaluate(()=>{
    localStorage.setItem('pb.runauto.local-sandbox','{');
    return Object.fromEntries(Object.keys(localStorage).map(key=>[key,localStorage.getItem(key)]));
  });
  page=await restart();
  await page.getByRole('heading',{name:'無法載入本機遊戲資料',exact:true}).waitFor({timeout:15000});
  await page.getByRole('button',{name:'重試',exact:true}).waitFor();
  assert.match(await page.locator('body').innerText(),/原始資料已保留/);
  assert.doesNotMatch(await page.locator('body').innerText(),/進度儲存在伺服器/);
  assert.equal(await page.evaluate(()=>Boolean(window.__pokebonkLocalApp?.meta?.profile)),false);
  assert.deepEqual(await page.evaluate(()=>Object.fromEntries(Object.keys(localStorage).map(key=>[key,localStorage.getItem(key)]))),before);
  await page.screenshot({path:'evidence/electron-corrupt-recovery.png'});
  console.log('Corrupt recovery blocks startup with truthful local copy and preserves all raw storage');
  return page;
}
