import assert from 'node:assert/strict';
import type {Page} from 'playwright-core';
import {syncPersistedTourMarkers} from './game-checks.ts';

export async function checkOfflineFriends(page:Page):Promise<void> {
  await syncPersistedTourMarkers(page);
  const storage=await page.evaluate(()=>JSON.stringify({...localStorage}));
  await page.getByRole('button',{name:'好友',exact:true}).click();
  await page.getByRole('heading',{name:'好友功能僅適用線上版',exact:true}).waitFor();
  assert.match(await page.locator('body').innerText(),/你的遊戲進度仍保留在此裝置/);
  assert.doesNotMatch(await page.locator('body').innerText(),/undefined/);
  assert.equal(await page.locator('.fr-list,.fr-add,.bd-search').count(),0);
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'好友',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage})),storage,'Friends navigation must preserve all local storage');
}
