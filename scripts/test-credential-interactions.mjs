// Synthetic renderer only: never reads the native vault or contacts a real host.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';
import { startStaticServer } from './fixtures/static-server.mjs';
import { createWorkspaceFixture, installWorkspaceFixture } from './fixtures/workspace.mjs';

const root = path.resolve(import.meta.dirname, '../renderer');
const output = await fs.mkdtemp(path.join(os.tmpdir(), 'keyhub-credential-interactions-'));
const server = await startStaticServer(root);
let browser;
const results = [];
async function check(name, run) {
  try { await run(); results.push({name, ok:true}); console.log(`PASS ${name}`); }
  catch (error) { results.push({name, ok:false, error:error.message, stack:error.stack}); console.error(`FAIL ${name}: ${error.stack}`); }
}
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  for (const language of ['zh','en']) for (const width of [1440,760,390]) {
    const fixture = createWorkspaceFixture({language,theme:width === 760 ? 'dark' : 'light'});
    fixture.state.connections[2].modules[0].name = 'apiCredential';
    fixture.state.connections[3].enabled = true;
    fixture.state.connections[3].modules.push({kind:'port',name:'port',value:'22',agentVisible:true});
    fixture.state.connections.push({...fixture.state.connections[3],id:'ssh-incomplete',name:'Incomplete server',itemType:'ssh',capabilities:[],canTest:false,modules:[{kind:'host',name:'host',value:'incomplete.example.test',agentVisible:true},{kind:'port',name:'port',value:'0',agentVisible:true},{kind:'username',name:'username',value:'',secret:true,configured:false,agentVisible:false}]});
    const context = await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
    await context.addInitScript(installWorkspaceFixture, fixture);
    await context.addInitScript(() => {
      const invoke = window.__TAURI__.core.invoke;
      window.__TAURI__.core.invoke = async (command,args) => {
        if (command === 'copy_owner_value') { workspaceFixture.copied = args.value; return; }
        return invoke(command,args);
      };
    });
    const page = await context.newPage(); page.setDefaultTimeout(2500);
    const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    await page.goto(server.url);
    await page.locator('.connection-card').first().waitFor();
    const row = id => page.locator(`.connection-card[data-item-id="${id}"]`);
    const prefix=`${language}-${width}`;
    await check(`${prefix}: localized metadata, readable counts and leading drag handle`,async()=>{
      await row('api-build').locator('.connection-name').click();
      assert.equal(await page.locator('.workspace-detail-section h3 span').first().innerText(),language==='zh'?'1 个字段':'1 field');
      assert.equal(await page.locator('.workspace-detail-modules .workspace-field-label').first().innerText(),language==='zh'?'API 凭据':'API CREDENTIAL');
      assert.equal(await row('api-build').locator('[data-action="delete"]').isVisible(),false);
      const drag=await row('api-build').locator('[data-item-reorder]').boundingBox();
      const icon=await row('api-build').locator('.connection-type').boundingBox();
      assert.ok(drag.x+drag.width<=icon.x+1,'Reorder handle must lead the type icon');
      assert.equal(await row('api-build').locator('[data-action="edit"]').innerText(),language==='zh'?'编辑':'Edit');
      assert.equal(await page.evaluate(async()=>{
        const row=document.querySelector('.connection-card[data-item-id="api-build"]');
        await refresh(false);
        return row===document.querySelector('.connection-card[data-item-id="api-build"]');
      }),true,'Metadata selection must not cause the next refresh to replace the list or dismiss menus');
      assert.equal(await page.evaluate(()=>workspaceFixture.calls.filter(c=>c.command==='owner_secret_view').length),0);
      await page.screenshot({path:path.join(output,`${prefix}-detail.png`)});
    });
    await check(`${prefix}: Agent use is explicit and never executes or reads a secret`,async()=>{
      await row('ssh-operations').locator('[data-action="use"]').click();
      await page.locator('#workspace-use-dialog').waitFor({state:'visible'});
      await page.screenshot({path:path.join(output,`${prefix}-agent-use.png`)});
      assert.match(await page.locator('#workspace-use-prompt').inputValue(),/use Operations host/);
      assert.equal(await page.evaluate(()=>workspaceFixture.calls.filter(c=>['owner_secret_view','test_connection','ssh_exec'].includes(c.command)).length),0);
      await page.locator('#workspace-use-copy').click();
      assert.match(await page.evaluate(()=>workspaceFixture.copied),/KeyHub MCP/);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#workspace-use-dialog').isVisible(),false);
      assert.equal(await row('ssh-incomplete').locator('[data-action="use"]').isDisabled(),true);
      await row('ssh-incomplete').locator('.connection-name').click();
      assert.match(await page.locator('.workspace-action-help').innerText(),language==='zh'?/账号.*密码.*私钥/:/account.*password.*private key/i);
      assert.deepEqual(await page.locator('.workspace-field-value').allTextContents(),['incomplete.example.test',language==='zh'?'未设置':'Not set',language==='zh'?'未设置':'Not set']);
    });
    await check(`${prefix}: More popover, cancel-safe delete, direct edit and double-click`,async()=>{
      await row('api-build').locator('.workspace-more').click();
      await page.screenshot({path:path.join(output,`${prefix}-more.png`)});
      await row('api-build').locator('.workspace-more').click();
      assert.equal(await row('api-build').locator('[data-action="delete"]').isVisible(),false,'Repeated More click closes its popover');
      await row('api-build').locator('.workspace-more').click();
      await row('api-build').locator('[data-action="delete"]').click();
      await page.locator('#confirmation-cancel').click();
      assert.equal(await page.evaluate(()=>workspaceFixture.deleted.length),0);
      assert.equal(await row('api-build').locator('.workspace-more').evaluate(node=>node===document.activeElement),true,'Cancel restores focus to the visible More button');
      await row('api-build').locator('.workspace-more').click();
      await page.keyboard.press('End');
      assert.equal(await row('api-build').locator('[data-action="delete"]').evaluate(node=>node===document.activeElement),true);
      await page.keyboard.press('Escape');
      assert.equal(await row('api-build').locator('[data-action="delete"]').isVisible(),false);
      await row('api-build').locator('[data-action="edit"]').click();
      await page.locator('#connection-modal').waitFor({state:'visible'});
      assert.equal(await page.locator('#connection-name').inputValue(),'Build API');
      await page.locator('#connection-modal [data-close-modal]').first().click();
      await row('api-build').locator('.connection-name').dblclick();
      await page.locator('#connection-modal').waitFor({state:'visible'});
      assert.equal(await page.locator('#connection-name').inputValue(),'Build API');
      await page.locator('#connection-modal [data-close-modal]').first().click();
      await page.evaluate(()=>{
        workspaceFixture.state.connections[1].name='Updated during pending refresh';
        state=structuredClone(workspaceFixture.state);
      });
      await row('api-build').locator('.connection-name').click();
      await page.evaluate(()=>renderConnections());
      assert.match(await row('login-personal').locator('.connection-name').innerText(),/Updated during pending refresh/);
      await page.emulateMedia({reducedMotion:'no-preference'});
      await page.evaluate(()=>openEditor(state.connections.find(item=>item.id==='api-build')));
      await row('api-build').locator('[data-action="use"]').click();
      await page.evaluate(async()=>{
        await Promise.all(document.getAnimations().map(animation=>animation.finished.catch(()=>{})));
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      });
      assert.equal(await page.locator('#workspace-use-dialog').evaluate(node=>node.contains(document.activeElement)),true,'Animated editor cannot steal modal focus');
      assert.equal(await page.locator('.app-shell').evaluate(node=>node.inert),true,'Usage dialog makes background inert');
      await page.keyboard.press('Escape');
      await page.locator('#connection-modal [data-close-modal]').first().click();
      await row('api-build').locator('[data-action="use"]').click();
      await page.evaluate(async()=>{workspaceFixture.owner.unlocked=false;await refreshOwnerLock();});
      assert.equal(await page.locator('#workspace-use-dialog').isVisible(),false);
      assert.equal(await page.locator('#workspace-use-prompt').inputValue(),'');
      assert.deepEqual(errors,[]);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    });
    await context.close();
  }
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify({checks:results.length,failed:results.filter(r=>!r.ok).length,output}));
  assert.ok(results.every(r=>r.ok));
} finally {
  try { await browser?.close(); } finally { await server.close(); }
}
