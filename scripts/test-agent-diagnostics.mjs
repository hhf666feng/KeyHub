// Synthetic Agent metadata only. Never runs a CLI or reads real Agent configuration.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { startStaticServer } from './fixtures/static-server.mjs';
import { createWorkspaceFixture, installWorkspaceFixture } from './fixtures/workspace.mjs';

const root = path.resolve(import.meta.dirname, '../renderer');
const output = await fs.mkdtemp(path.join(os.tmpdir(), 'keyhub-agent-diagnostics-'));
const server = await startStaticServer(root);
let browser;
const results=[];
async function check(name,run){
  try{await run();results.push({name,ok:true});console.log(`PASS ${name}`);}
  catch(error){results.push({name,ok:false,error:error.message});console.error(`FAIL ${name}: ${error.message}`);}
}
try {
  browser = await chromium.launch({headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {})});
  for(const language of ['zh','en'])for(const width of [1200,390]){
    const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
    await context.addInitScript(installWorkspaceFixture,createWorkspaceFixture({language,theme:width===390?'dark':'light',empty:true}));
    await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
    const page=await context.newPage();page.setDefaultTimeout(2500);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(server.url);
    await page.locator('[data-page="settings"]').click();
    await page.locator('[data-settings-filter="MCP"]').click();
    await page.evaluate(()=>{
      agentClients=[
        {clientId:'codex',displayName:'Codex',state:'registered',message:'KeyHub connected',canRemove:true},
        {clientId:'openclaw',displayName:'OpenClaw',state:'error',message:'Configuration detected, but no callable CLI was found',configPath:'/synthetic/home/.openclaw/openclaw.json',installPath:'',canRegister:false,canRepair:false},
        {clientId:'timeout',displayName:'Timeout fixture',state:'error',message:'Agent CLI status check timed out',installPath:'/synthetic/cli/openclaw'},
        {clientId:'invalid',displayName:'Invalid config fixture',state:'error',message:'Invalid Agent JSON/JSONC configuration'},
        {clientId:'unknown',displayName:'Unknown error fixture',state:'error',message:'Unknown option <img src=x onerror="window.fixtureInjected=true">; Authorization: Bearer synthetic-token-123; api_key=synthetic-api-key-456'},
        {clientId:'empty',displayName:'Empty error fixture',state:'error',message:''},
      ];
      renderAgents();
    });
    const names={openclaw:'OpenClaw',timeout:'Timeout fixture',invalid:'Invalid config fixture',unknown:'Unknown error fixture',empty:'Empty error fixture',codex:'Codex'};
    const row=id=>page.locator('.agent-client-row').filter({has:page.locator('strong').filter({hasText:new RegExp(`^${names[id]}$`)})});
    await check(`${language}-${width}: missing CLI gives a reason, recovery hint and paths`,async()=>{
      assert.match(await row('openclaw').innerText(),language==='zh'?/检测到配置.*未找到.*命令行/:/configuration.*no.*CLI/i);
      assert.match(await row('openclaw').innerText(),language==='zh'?/重新扫描/:/rescan/i);
      assert.equal(await row('openclaw').locator('[data-agent-action="connect"]').count(),0);
      await row('openclaw').locator('summary').click();
      assert.match(await row('openclaw').innerText(),/\/synthetic\/home\/\.openclaw\/openclaw.json/);
      assert.ok(await row('openclaw').evaluate(el=>getComputedStyle(el).opacity==='1'));
      await page.screenshot({path:path.join(output,`${language}-${width}.png`),fullPage:true});
    });
    await check(`${language}-${width}: other errors preserve diagnostics safely and never invent success`,async()=>{
      assert.match(await row('timeout').innerText(),language==='zh'?/超时/:/timed out/i);
      assert.match(await row('invalid').innerText(),language==='zh'?/配置.*格式|格式.*配置/:/Invalid Agent configuration format/);
      await row('unknown').locator('summary').click();
      const text=await row('unknown').innerText();
      assert.match(text,/Unknown option/);
      assert.doesNotMatch(text,/synthetic-token-123|synthetic-api-key-456/);
      assert.equal(await row('unknown').locator('img').count(),0);
      assert.equal(await page.evaluate(()=>window.fixtureInjected),undefined);
      assert.match(await row('empty').innerText(),language==='zh'?/未返回.*原因/:/no.*reason/i);
      assert.equal(await row('codex').locator('[data-agent-action="remove"]').count(),1);
      assert.equal(await page.evaluate(()=>workspaceFixture.calls.some(c=>/register|repair|remove|test_connection/.test(c.command))),false);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      assert.deepEqual(errors,[]);
    });
    await context.close();
  }
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify({checks:results.length,failed:results.filter(r=>!r.ok).length,output}));
  assert.ok(results.every(r=>r.ok));
} finally {
  try { await browser?.close(); } finally { await server.close(); }
}
