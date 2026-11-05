import type {Page} from 'playwright-core';
import type {BuildMetadata} from '../types/metadata.ts';
import assert from 'node:assert/strict';
import {record,text} from '../types/data.ts';
import {writeFile} from 'node:fs/promises';

export async function dismissMenuNotices(page: Page) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const gpu = page.getByRole('button', {name: '知道了', exact: true}).first();
    if (await gpu.isVisible().catch(() => false)) await gpu.click();

    const understood = page.locator('.season-modal .btn.green').first();
    if (await understood.isVisible().catch(() => false)) await understood.click();

    const seasonModal = page.locator('.season-modal').first();
    if (await seasonModal.isVisible().catch(() => false)) {
      const noEsc = await seasonModal.evaluate(el => el.classList.contains('no-esc'));
      if (!noEsc) {
        await page.keyboard.press('Escape');
        await seasonModal.waitFor({state: 'hidden', timeout: 2000}).catch(() => {});
      }
      if (await seasonModal.isVisible().catch(() => false)) {
        await seasonModal.click({position: {x: 8, y: 8}, force: true});
        await seasonModal.waitFor({state: 'hidden', timeout: 2000}).catch(() => {});
      }
    }

    const tour = page.getByRole('button', {name: /^跳過(?:指南)?/}).first();
    if (await tour.waitFor({state: 'visible', timeout: 500}).then(() => true, () => false)) {
      await page.keyboard.press('Escape');
      await tour.waitFor({state: 'hidden', timeout: 5000}).catch(() => {});
    }

    const guideSkip = page.locator('.g-skip, .tour-skip').first();
    if (await guideSkip.isVisible().catch(() => false)) await guideSkip.click();

    const blocking = page.locator('.season-modal, .tour, .pb-guide').first();
    if (!(await blocking.isVisible().catch(() => false))) break;
  }
}

export async function syncPersistedTourMarkers(page: Page) {
  await page.evaluate(async () => {
    const app = window.__pokebonkLocalApp;
    const settings = app.meta.profile.settings as Record<string, unknown>;
    const pb = localStorage.getItem('pb.tours') ?? '';
    const existing = typeof settings['tours'] === 'string' ? settings['tours'] : '';
    const merged = [pb, existing].filter(Boolean).join(',');
    const parts = [...new Set(merged.split(',').map(part => part.trim()).filter(Boolean))];
    if (!parts.includes('gd')) parts.push('gd');
    const withGuide = parts.join(',');
    settings['tours'] = withGuide;
    try { localStorage.setItem('pb.tours', withGuide); } catch {}
    // meta.save is not the persistence path; friends navigation later flushes
    // settings.tours through savePrefs and would otherwise change storage mid-check.
    await app.backend.savePrefs(null, app.meta.profile);
  });
  await page.waitForFunction(
    () => {
      if (document.querySelector('.pb-guide')) return false;
      const pb = localStorage.getItem('pb.tours') ?? '';
      const raw = localStorage.getItem('pokebonk.local.profile.v2');
      if (!raw) return !pb;
      try {
        const tours = (JSON.parse(raw) as {settings?: {tours?: string}}).settings?.tours ?? '';
        return tours.includes('gd') && (!pb || tours === pb);
      } catch { return false; }
    },
    null,
    {timeout: 30000},
  );
}

/** Locked fresh saves hide main-menu chrome until a starter exists. */
export async function ensurePlayableMenu(page: Page) {
  await page.evaluate(async () => {
    const app = window.__pokebonkLocalApp;
    const meta = app.meta as typeof app.meta & { chooseStarter(id: number): Promise<void> };
    if (!meta.profile.starter) await meta.chooseStarter(4);
    if (!meta.profile.starterJ) await meta.chooseStarter(155);
    app.toMenu();
  });
  await page.locator('.mm-nav').waitFor({state:'visible',timeout:120000});
  await dismissMenuNotices(page);
  await syncPersistedTourMarkers(page);
}

export async function loadAchievementCards(page:Page,limit:number) {
  for(let batch=0;batch<=limit;batch++) {
    const count=await page.locator('.q-card').count();
    const more=await page.evaluate(()=>{const marker=document.querySelector('.q-more');marker?.scrollIntoView({block:'end'});return Boolean(marker);});
    if(!more)return;
    await page.waitForFunction(count=>document.querySelectorAll('.q-card').length>count||!document.querySelector('.q-more'),count,{timeout:5000});
  }
  throw new Error('Achievement pagination did not finish');
}

export async function checkGame(page: Page,metadata: BuildMetadata,label: string,{gameplay=true,pointerLock=false,focusPointerInput}:{gameplay?:boolean;pointerLock?:boolean;focusPointerInput?:()=>Promise<void>}={}) {
  await page.addInitScript(()=>{
    const key='pokebonk.local.profile.v2';
    const value: unknown=JSON.parse(localStorage.getItem(key)||'{}');
    if (typeof value!=='object' || value===null || Array.isArray(value)) throw new Error('Invalid saved profile');
    const profile=value as Record<string,unknown>;
    const settings=profile['settings'];
    if(settings!==undefined && (typeof settings!=='object' || settings===null || Array.isArray(settings)))throw new Error('Invalid saved settings');
    profile['settings']={...settings,quality:'low',pixel:2,tips:false};
    localStorage.setItem(key,JSON.stringify(profile));
  });
  await page.reload();
  await page.waitForFunction(()=>window.__pokebonkLocalApp?.meta?.profile?.localSandbox,null,{timeout:120000});
  await page.getByRole('button',{name:/^成就 /}).waitFor({state:'visible',timeout:120000});
  await dismissMenuNotices(page);
  await page.getByRole('button',{name:'寶藏',exact:true}).click();
  const treasureTabs=page.locator('.tz-tab');
  await treasureTabs.first().waitFor({state:'visible'});
  assert.equal(await treasureTabs.count(),3);
  assert.equal(await page.locator('.tz-tab.done').count(),0,'A fresh locked profile has no completed treasure wheels');
  for(let index=0;index<3;index++) {
    await treasureTabs.nth(index).click();
    assert.doesNotMatch(await treasureTabs.nth(index).innerText(),/10\/10/);
    await page.locator('.tz-stage').evaluate(async stage=>{
      const background=getComputedStyle(stage).getPropertyValue('--bg').trim();
      const url=/^url\(["']?(.*?)["']?\)$/.exec(background)?.[1];
      if(!url)return;
      const image=new Image();image.src=url;await image.decode();
      if(!image.naturalWidth)throw new Error('Undecoded treasure background');
    });
  }
  await page.getByRole('button',{name:'Esc 返回',exact:true}).click();
  // The fresh-version badge pulses continuously, so its bounds never settle.
  await page.locator('.logo-ver').click({force:true});
  await page.locator('.rel-cat-h img').first().waitFor({state:'visible'});
  await page.locator('.rel-cat-h img').evaluateAll(async images=>{
    await Promise.all(images.map(async image=>{if(!(image instanceof HTMLImageElement))throw new Error('Invalid release icon');await image.decode();if(!image.naturalWidth)throw new Error('Undecoded release icon: '+image.src);}));
  });
  await page.getByRole('button',{name:'關閉',exact:true}).click();
  const profile=await page.evaluate(()=>window.__pokebonkLocalApp.meta.profile);
  assert.ok(profile.league.includes(4)&&profile.league.includes(155),'Menu bootstrap keeps the two chosen starters');
  assert.ok(profile.league.length<metadata.league);
  assert.ok(profile.league.every(id=>(profile.wins[id]??0)===0));
  assert.equal(Object.keys(profile.lab).length,0);
  assert.equal(profile.itemsOwned.length,0);
  assert.equal(profile.stardust,0);
  assert.equal(Object.values(profile.treasures).reduce((sum,wheel)=>sum+wheel.won.length,0),0);
  assert.equal(Object.keys(profile.quests).length,0);
  assert.equal(Object.values(profile.medals).filter(rank=>rank===metadata.medalRank).length,0);
  for(const period of ['daily','weekly'] as const)assert.deepEqual(profile[period].claimed,[1,1,1,1]);
  assert.equal(await page.evaluate(()=>window.__pokebonkLocalApp.meta.tasksReady()),0);
  assert.equal(await page.evaluate(()=>typeof Reflect.get(window,'process')),'undefined');
  assert.equal(await page.evaluate(()=>typeof Reflect.get(window,'require')),'undefined');
  assert.equal(await page.evaluate(()=>Boolean(navigator.serviceWorker?.controller)),false);
  assert.ok(metadata.statusIcons.length>0);
  assert.ok(metadata.reactionIcons.length>0);
  assert.ok(metadata.itemIcons.length>0);
  await page.evaluate(async paths=>{await Promise.all(paths.map(async path=>{const image=new Image();image.src='/'+path;await image.decode();if(!image.naturalWidth)throw new Error('Undecoded catalog icon: '+path);}));},[...metadata.statusIcons,...metadata.reactionIcons,...metadata.itemIcons]);
  await page.getByRole('button',{name:/^成就 /}).click();
  await loadAchievementCards(page,metadata.achievements);
  const general=await page.locator('.q-card.done').count();
  await page.getByRole('button',{name:'外觀',exact:true}).click();
  await loadAchievementCards(page,metadata.achievements);
  assert.equal(general+await page.locator('.q-card.done').count(),0,'Locked profiles do not start with completed achievements');
  await page.getByRole('button',{name:'Esc 返回',exact:true}).click();
  await page.evaluate(async()=>{await window.__pokebonkLocalApp.backend.chooseStarter(null,150);localStorage.setItem('native-proof','saved');});
  await page.reload();
  await page.waitForFunction(()=>window.__pokebonkLocalApp?.meta?.profile?.lastSpecies===150,null,{timeout:120000});
  assert.equal(await page.evaluate(()=>localStorage.getItem('native-proof')),'saved');
  assert.equal(await page.evaluate(()=>Object.keys(window.__pokebonkLocalApp.meta.profile.quests).length),0);
  await dismissMenuNotices(page);
  await page.getByRole('button',{name:/^開始遊戲/}).click();
  await page.locator('.ls-tile').first().waitFor({state:'visible'});
  assert.equal(await page.locator('.ls-tile').count(),metadata.league);
  await page.getByRole('button',{name:'超夢',exact:true}).click();
  assert.equal(await page.locator('.ls-won').count(),3);
  assert.equal(await page.locator('.ls-won.on').count(),0);
  await page.waitForFunction(()=>(window.__pokebonkLocalApp.menuScene?.sprites.batches.get(150)?.mesh.count??0)>0);
  const previewMesh=await page.evaluateHandle(()=>{
    const mesh=window.__pokebonkLocalApp.menuScene?.sprites.batches.get(150)?.mesh;
    if(!mesh?.parent)throw new Error('Expected visible Mewtwo preview');
    return mesh;
  });
  await page.getByRole('button',{name:'Esc 返回',exact:true}).click();
  const runs=[];
  if(gameplay)for(const config of [
    {species:4,biome:'forest',tier:0},
    {species:150,biome:'desert',tier:2},
    {species:7,biome:'coast',tier:1},
    {species:144,biome:'glacier',tier:2},
    {species:92,biome:'graveyard',tier:0,mode:'tower'},
    {species:155,biome:'canela',tier:0},
    {species:158,biome:'cave',tier:1},
    {species:152,biome:'encina',tier:0},
    {species:249,biome:'iris',tier:1},
  ]) {
    await page.evaluate(async config=>{
      const app=window.__pokebonkLocalApp;
      const profile=app.meta.profile;
      if(!profile.league.includes(config.species)&&!profile.unlocked.includes(config.species))await app.backend.chooseStarter(null,config.species);
    },config);
    assert.equal(await page.evaluate(config=>window.__pokebonkLocalApp.startRun({...config,boosts:[]}),config),true);
    await page.waitForFunction(()=>(window.__pokebonkLocalApp.run?.time ?? 0)>3,null,{timeout:90000});
    assert.equal(await previewMesh.evaluate(mesh=>mesh.parent===null),true,'Character preview must be removed from the gameplay scene');
    if(pointerLock&&config.biome==='forest') {
      await focusPointerInput?.();
      // Keyboard input also acquires lock when the game has armed it. Avoid
      // locator hit-testing while native capture has already hidden the cursor.
      await page.keyboard.press('w');
      await page.waitForFunction(()=>document.pointerLockElement?.tagName==='CANVAS');
      assert.equal(await page.evaluate(()=>window.__pokebonkLocalApp.run?.state),'play');
      const yaw=await page.evaluate(()=>window.__pokebonkLocalApp.run?.camYaw);
      await page.mouse.move(640,360);
      await page.mouse.move(680,370,{steps:8});
      await page.waitForFunction(yaw=>window.__pokebonkLocalApp.run?.camYaw!==yaw,yaw);
      await page.keyboard.press('Escape');
      await page.waitForFunction(()=>document.pointerLockElement===null&&window.__pokebonkLocalApp.run?.state==='paused');
      await page.evaluate(()=>window.__pokebonkLocalApp.run?.resume());
      await page.keyboard.press('w');
      await page.waitForFunction(()=>document.pointerLockElement?.tagName==='CANVAS'&&window.__pokebonkLocalApp.run?.state==='play');
      // Upstream can mangle private method names. Exercise the player's map
      // shortcut and verify the visible map as well as native pointer release.
      await page.keyboard.press('KeyM');
      await page.locator('.bigmap').waitFor({state:'visible',timeout:5000});
      await page.waitForFunction(()=>document.pointerLockElement===null&&window.__pokebonkLocalApp.run?.state==='paused');
      await page.keyboard.press('KeyM');
      await page.locator('.bigmap').waitFor({state:'hidden',timeout:5000});
      await page.waitForFunction(()=>window.__pokebonkLocalApp.run?.state==='play');
      await page.keyboard.press('w');
      await page.waitForFunction(()=>document.pointerLockElement?.tagName==='CANVAS');
      console.log(label,'pointer lock, camera movement, Escape, resume and map release passed');
      // Invoke the real gameplay checkpoint, including its meta report adapter,
      // without holding native pointer capture during a long timer wait.
      await page.evaluate(()=>{const run=window.__pokebonkLocalApp.run;if(!run)throw new Error('Missing active run');run.checkpoint();});
      await page.waitForFunction(()=>localStorage.getItem('pokebonk.local.pending.v1')!==null);
      const pending=record(JSON.parse(await page.evaluate(()=>localStorage.getItem('pokebonk.local.pending.v1')??'null')),'live checkpoint');
      assert.match(text(record(pending['ticket'])['id']),/^local-/);
      record(pending['result'],'live checkpoint result');
      console.log(label,'live checkpoint persisted locally');
    }
    if(config.biome==='glacier') {
      await page.evaluate(()=>{const r=window.__pokebonkLocalApp.run;if(!r)throw new Error('Expected active run');r.boss.spawn(91,r.player.pos.x+8,r.player.pos.z,false);const i=r.boss.bossIndex;for(const key of ['poison','sleep','para'] as const)r.enemies[key][i]=20;r.enemies.poisonStacks[i]=3;});
      await page.waitForFunction(()=>{const images=[...document.querySelectorAll<HTMLImageElement>('.bossbar .bb-sti img')];return images.length>=3&&images.every(image=>image.complete&&image.naturalWidth>0);},null,{timeout:15000});
    }
    runs.push(await page.evaluate(()=>{const r=window.__pokebonkLocalApp.run;if(!r)throw new Error('Expected active run');return {species:r.startSpecies,biome:r.biome.id,time:r.time,mode:r.mode};}));
    await page.evaluate(async()=>{const a=window.__pokebonkLocalApp;if(!a.run)throw new Error('Expected active run');a.run.endHow='quit';await a.run.finish(false,true);a.toMenu();});
    if(pointerLock)await page.waitForFunction(()=>document.pointerLockElement===null);
    console.log(label,'gameplay passed:',config.biome);
  }
  await previewMesh.dispose();
  await page.waitForFunction(()=>document.getAnimations().filter(a=>Number.isFinite(a.effect?.getTiming().iterations)).every(a=>a.playState!=='running'),null,{timeout:10000});
  await page.screenshot({path:`evidence/${label}.png`});
  await writeFile(`evidence/${label}.json`,JSON.stringify({metadata,runs,persistence:true,achievements:metadata.achievements,medals:metadata.medals,tasksClaimed:true,pointerLock},null,2));
}
