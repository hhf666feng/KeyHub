// Synthetic forms only. This never connects to an app or a real vault.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";
const source = await fs.readFile(new URL("../browser-extension/provider.js", import.meta.url), "utf8");
const helpers = await fs.readFile(new URL("../browser-extension/form-reader.js", import.meta.url), "utf8")
  + source.slice(source.indexOf("function usePersonalForm("), source.indexOf("function finishCredentialRequest("));
const browser = await chromium.launch({headless:true});
try {
  const page = await browser.newPage();
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await page.goto("about:blank");
  await page.addScriptTag({content:helpers});
  await page.setContent(`<form id="billing">
    <label>Card number<input id="number" name="payment[cardNumber]"></label>
    <input id="expiry" name="expiry" type="month">
    <input id="code" name="cvv" type="password">
    <input id="short-year" autocomplete="cc-exp-year" maxlength="2">
    <input id="long-exp" autocomplete="cc-exp" placeholder="MM/YYYY">
    <input id="compact-exp" autocomplete="cc-exp" maxlength="4">
    <select id="month" name="exp_month"><option value=""></option><option value="jul">July</option></select>
    <input id="hidden" name="cardNumber" type="hidden">
    <input id="check" autocomplete="cc-number" type="checkbox">
    <input id="disabled" autocomplete="cc-number" disabled>
    <input id="readonly" autocomplete="cc-number" readonly>
    <div style="opacity:0"><input id="transparent" autocomplete="cc-number"></div>
    <input id="wrong-autocomplete" name="cardNumber" autocomplete="username">
    </form><form><input id="other-card" autocomplete="cc-number"></form>`);
  await page.locator("#number").focus();
  const filled = await page.evaluate(()=>usePersonalForm(location.origin,"card",{cardNumber:"4111111111111111",cardSecurityCode:"987",cardExpMonth:"7",cardExpYear:"2030"}));
  assert.equal(filled.filled,7);
  for (const [id,expected] of Object.entries({number:"4111111111111111",expiry:"2030-07",code:"987","short-year":"30","long-exp":"07/2030","compact-exp":"0730",month:"jul"}))
    assert.equal(await page.locator(`#${id}`).inputValue(),expected,id);
  for (const id of ["hidden","disabled","readonly","transparent","wrong-autocomplete","other-card"])
    assert.equal(await page.locator(`#${id}`).inputValue(),"",id);
  assert.equal(await page.locator("#check").isChecked(),false);
  await page.setContent(`<form><label for="first">First name</label><input id="first"><input id="last" name="last_name"><input id="full" name="fullName"><input id="address" name="shipping_address_line1"><input id="postal" name="postal_code"><input id="unknown" name="passportNumber"></form>`);
  await page.evaluate(()=>usePersonalForm(location.origin,"identity",{firstName:"Ada",lastName:"Lovelace",address1:"Example street",postalCode:"12345",passportNumber:"never-fill"}));
  for (const [id,expected] of Object.entries({first:"Ada",last:"Lovelace",full:"Ada Lovelace",address:"Example street",postal:"12345",unknown:""}))
    assert.equal(await page.locator(`#${id}`).inputValue(),expected,id);
  await page.setContent(`<form><input id="city" name="city"></form>`);
  assert.equal(await page.evaluate(()=>{try{useLoginForm("fill",location.origin,{username:"alice",password:"secret"},location.href);return false;}catch{return true;}}),true);
  assert.equal(await page.locator("#city").inputValue(),"");
  await page.setContent(`<form><input id="username"><input type="password" autocomplete="section-signup new-password"></form>`);
  assert.equal(await page.evaluate(()=>{try{useLoginForm("fill",location.origin,{username:"alice",password:"secret"},location.href);return false;}catch{return true;}}),true);
  await page.setContent(`<form><input autocomplete="username" value="another-account" readonly><input id="password" type="password"></form>`);
  assert.equal(await page.evaluate(()=>{try{useLoginForm("fill",location.origin,{username:"alice",password:"secret"},location.href);return false;}catch{return true;}}),true);
  assert.equal(await page.locator("#password").inputValue(),"", "Never put a password under a different fixed account");
  await page.setContent(`<form><input autocomplete="username" value="alice" readonly><input id="current" type="password" autocomplete="current-password"><input id="new" type="password" autocomplete="new-password" value="user-chosen-new-secret"></form>`);
  await page.locator("#current").focus();
  await page.evaluate(()=>useLoginForm("fill",location.origin,{username:"alice",password:"old-secret"},location.href));
  assert.equal(await page.locator("#current").inputValue(),"old-secret");
  assert.equal(await page.locator("#new").inputValue(),"user-chosen-new-secret", "Current-password fill preserves the new password");
  await page.setContent(`<div id="host"></div>`);
  await page.evaluate(()=>{
    const shadow=document.querySelector("#host").attachShadow({mode:"open"});
    shadow.innerHTML='<form><input id="username" autocomplete="username"><input id="password" type="password" autocomplete="current-password"></form>';
    window.inputEvents=0;document.addEventListener("input",()=>inputEvents++);
    useLoginForm("fill",location.origin,{username:"alice",password:"synthetic-password"},location.href);
  });
  assert.equal(await page.locator("#host #password").inputValue(),"synthetic-password");
  assert.equal(await page.evaluate(()=>inputEvents),2);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,checks:["legacy card/identity fields","month input","expiry formats","month names","focused form only","hidden/readonly/disabled controls excluded","explicit autocomplete respected","unrelated text fields untouched","new-password forms rejected","readonly account mismatch rejected","new password preserved during current-password fill","shadow DOM and input events"]}));
} finally { await browser.close(); }
