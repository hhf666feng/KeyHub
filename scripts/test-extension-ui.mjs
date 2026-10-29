import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { chromium } from 'playwright';

const output = await fs.mkdtemp(path.join(os.tmpdir(), 'keyhub-extension-ui-'));
const root = path.resolve(import.meta.dirname, '../browser-extension');
const server = http.createServer(async (request, response) => {
  const file = path.resolve(root, `.${new URL(request.url, 'http://localhost').pathname}`);
  if (!file.startsWith(root + path.sep)) return response.writeHead(403).end();
  try { response.setHeader('Content-Type', ({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(file)] || 'text/plain'); response.end(await fs.readFile(file)); }
  catch { response.writeHead(404).end(); }
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
const report = [];
try {
  const context = await browser.newContext({ viewport: {width:390,height:850} });
  const externalRequests=[];
  await context.route('**/*',route=>{
    if(new URL(route.request().url()).hostname!=='127.0.0.1'){externalRequests.push(route.request().url());return route.abort();}
    return route.continue();
  });
  const preferences = {uiLanguage:'zh',uiTheme:'light'};
  const writes = [], copied = [], calls = [];
  await context.exposeBinding('fixturePreferences', () => ({...preferences}));
  await context.exposeBinding('fixtureWrite', (_, value) => { writes.push(value); Object.assign(preferences, value); });
  await context.exposeBinding('fixtureCopy', (_, value) => { copied.push(value); });
  await context.exposeBinding('fixtureCall', (_, value) => { calls.push(value); });
  await context.addInitScript(() => {
    const secret = 'SYNTHETIC_ONLY_42!';
    const item = {id:'fixture',name:'Fixture login',itemType:'login',enabled:true,updatedAt:'v1',passwordHistoryCount:1,modules:[],loginUris:[],passkeys:[]};
    window.fixture = { mode:'connected', writes:[], calls:[], copied:[], failStorage:false, operation:'get', verificationRequired:false, pinConfigured:true };
    window.chrome = {storage:{local:{get:async()=>window.fixturePreferences(),set:async value=>{if(fixture.failStorage)throw Error('storage failed');fixture.writes.push(value);await window.fixtureWrite(value);}}},runtime:{sendMessage:async message=>{
      fixture.calls.push(message);
      await window.fixtureCall(message);
      if(fixture.mode==='disconnected')return {ok:false,error:'Bridge unavailable'};
      let result;
      switch(message.action){
        case 'list': result={origin:'https://example.test',pageAvailable:true,locked:fixture.mode==='locked',pinConfigured:true,entries:[{...item,username:'demo'}],personal:[],vault:{items:[item],trash:[{item:{...item,id:'deleted'},deletedAt:'d1'}]},capture:location.search.includes('capture=')?{id:'capture-fixture',origin:'https://example.test'}:null};break;
        case 'vault-get':result={item,fields:[{name:'password',value:secret}]};break;
        case 'vault-history':result={updatedAt:'v1',entries:[{changedAt:0,password:secret}]};break;
        case 'capture-read':result={capture:{id:'capture-fixture',origin:'https://example.test'},entries:[],username:'demo',password:secret,warnings:[]};break;
        case 'info':result={operation:fixture.operation,account:'Demo',origin:'https://example.test',rpId:'example.test',pinConfigured:fixture.pinConfigured,verificationRequired:fixture.verificationRequired,entries:[{name:'Fixture',passkey:{displayName:'Demo',credentialId:'credential-fixture'}}]};break;
        default:result={};
      }
      return {ok:true,result};
    }}};
    Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{fixture.copied.push(text);await window.fixtureCopy(text);}}});
  });
  const page = await context.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  async function shot(name) {
    await page.screenshot({path:path.join(output,`${name}.png`),fullPage:true});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth), `${name}: horizontal overflow`);
    assert.deepEqual(await page.evaluate(()=>[...document.querySelectorAll('button,input,select,textarea')].filter(node=>node.type!=='checkbox'&&node.getClientRects().length).filter(node=>parseFloat(getComputedStyle(node).fontSize)<14||getComputedStyle(node).fontStyle!=='normal').map(node=>node.id)),[],`${name}: control typography`);
    report.push(name);
  }
  await page.goto(`http://127.0.0.1:${server.address().port}/popup.html`);
  await page.locator('#vault-panel').waitFor({state:'visible'});
  assert.equal(await page.locator('#ui-language').count(),1,'explicit language selector');
  await page.locator('#full-vault').evaluate(el=>el.open=true);
  await shot('connected-zh-light');
  await page.setViewportSize({width:276,height:900});
  const narrowControls = await page.evaluate(() => ({
    labels: [...document.querySelectorAll('.ui-preferences label')].map(element => element.getBoundingClientRect().height),
    selects: [...document.querySelectorAll('.ui-preferences select')].map(element => element.getBoundingClientRect().width),
    title: document.querySelector('header strong').getBoundingClientRect().width,
  }));
  assert.ok(narrowControls.labels.every(height => height < 24), `narrow popup labels must remain on one line: ${narrowControls.labels}`);
  assert.ok(narrowControls.selects.every(width => width >= 100), `narrow popup selects need usable width: ${narrowControls.selects}`);
  await shot('connected-zh-276');
  await page.setViewportSize({width:390,height:850});
  await page.locator('[data-vault-edit]').click();
  await page.locator('#vault-item-name').fill('Unsaved draft');
  await page.locator('#ui-language').selectOption('en');
  assert.equal(await page.locator('#vault-item-name').inputValue(),'Unsaved draft');
  assert.equal(await page.locator('[data-vault-field="password"]').inputValue(),'SYNTHETIC_ONLY_42!');
  assert.equal(await page.locator('html').getAttribute('lang'),'en');
  assert.ok(!(await page.locator('body').innerText()).replace('中文','').match(/[\u3400-\u9fff]/u),'English contains no app Chinese: '+await page.locator('body').innerText());
  await shot('editor-en');
  await page.locator('#ui-theme').selectOption('dark');
  await page.setViewportSize({width:320,height:850});await shot('editor-dark-320');
  await page.locator('#vault-editor-cancel').click();
  await page.locator('#ui-language').selectOption('zh');
  await page.locator('#ui-language').selectOption('en');
  assert.equal(await page.locator('[data-vault-field]').count(),0);
  await page.locator('#vault-all-items button').filter({hasText:'History'}).click();
  await shot('history-en');
  await page.locator('#ui-language').selectOption('zh');
  await page.locator('#vault-history-close').click();
  await page.locator('#vault-view').selectOption('trash');await shot('trash-zh');
  await page.evaluate(()=>fixture.failStorage=true);
  await page.locator('#ui-language').selectOption('en');
  await page.waitForFunction(()=>document.querySelector('#ui-language').value==='zh');
  await page.evaluate(()=>{fixture.failStorage=false;fixture.mode='locked';});
  await page.waitForFunction(()=>!document.querySelector('#unlock-form').hidden);
  assert.equal(await page.locator('[data-vault-field]').count(),0);
  await shot('locked');
  await page.evaluate(()=>fixture.mode='disconnected');
  await page.waitForFunction(()=>document.querySelector('#vault-panel').hidden&&document.querySelector('#unlock-form').hidden);await shot('disconnected');
  await page.goto(`http://127.0.0.1:${server.address().port}/popup.html?capture=capture-fixture&tab=7`);
  await page.locator('#save-form').waitFor({state:'visible'});
  await page.locator('#ui-language').selectOption('en');await shot('capture-en-320');
  assert.equal(await page.locator('#username').inputValue(),'demo');
  assert.equal(await page.locator('[autocomplete="new-password"]' ).inputValue(),'SYNTHETIC_ONLY_42!');
  await page.locator('#cancel-save').click();
  await page.goto(`http://127.0.0.1:${server.address().port}/request.html?id=request-fixture`);
  await page.waitForFunction(()=>document.documentElement.lang==='en');
  await page.locator('#ui-language').selectOption('en');
  await page.locator('#pin').fill('123456');
  await page.locator('#ui-language').selectOption('zh');
  assert.equal(await page.locator('#pin').inputValue(),'123456');await shot('passkey-zh-320');
  await page.locator('#confirm').click();assert.equal(await page.locator('#pin').inputValue(),'');
  await page.locator('#ui-theme').selectOption('system');
  await page.emulateMedia({colorScheme:'dark'});
  assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(28, 28, 30)');
  assert.equal(copied.length,0);
  assert.ok(writes.every(value=>Object.keys(value).every(key=>['uiLanguage','uiTheme'].includes(key))));
  assert.ok(!JSON.stringify(writes).includes('SYNTHETIC_ONLY_42!'));
  assert.ok(!calls.some(call=>['vault-save','save','personal-save'].includes(call.action)));
  const confirmation=calls.find(call=>call.type==='credential-ui'&&call.action==='confirm');
  assert.equal(confirmation.credentialId,'credential-fixture');assert.equal(confirmation.pin,'123456');
  await page.evaluate(()=>{fixture.operation='create';fixture.verificationRequired=true;fixture.pinConfigured=false;return load();});
  assert.equal(await page.locator('#credential').isVisible(),false);
  assert.equal(await page.locator('#confirm').isDisabled(),true);
  await page.locator('#ui-language').selectOption('en');
  assert.ok((await page.locator('#note').innerText()).includes('Set a KeyHub PIN'));
  await shot('passkey-create-verification-required');
  await page.goto(`http://127.0.0.1:${server.address().port}/popup.html`);
  await page.locator('#vault-panel').waitFor({state:'visible'});
  await page.locator('#full-vault').evaluate(node=>node.open=true);
  await page.locator('[data-vault-edit]').click();
  await page.locator('#vault-item-name').fill('Saved fixture');
  await page.locator('#vault-editor button[type="submit"]').click();
  await page.waitForFunction(()=>document.querySelector('#vault-editor').hidden);
  const saved=calls.find(call=>call.action==='vault-save');
  assert.equal(saved.expectedUpdatedAt,'v1');assert.equal(saved.input.id,'fixture');
  assert.equal(saved.input.name,'Saved fixture');
  assert.equal(saved.input.secrets.password,'SYNTHETIC_ONLY_42!');
  await page.locator('#ui-language').selectOption('zh');
  assert.equal(await page.locator('[data-vault-field]').count(),0);
  await page.locator('#ui-language').selectOption('en');
  await page.locator('#vault-all-items button').filter({hasText:/^Trash$/}).click();
  await page.locator('#vault-confirm').waitFor({state:'visible'});
  await page.locator('#ui-language').selectOption('zh');
  assert.ok((await page.locator('#vault-confirm-message').innerText()).includes('移入回收站'));
  await page.locator('#vault-confirm-cancel').click();
  assert.ok(!calls.some(call=>call.action==='vault-trash'));
  assert.equal(copied.length,0);assert.deepEqual(externalRequests,[]);
  assert.deepEqual(errors,[]);
  console.log(`PASS ${report.length} extension UI scenarios. Screenshots/report: ${output}`);
} finally { await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));await browser.close();server.close(); }
