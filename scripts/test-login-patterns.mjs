import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { chromium } from "playwright";
import { loginPatterns } from "./fixtures/login-patterns.mjs";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "openkeylet-pattern-tests-"));
const reader = await fs.readFile(new URL("../browser-extension/form-reader.js", import.meta.url), "utf8");
const results = [];
for (const channel of process.argv.includes("--all-browsers") ? ["chromium", "chrome", "msedge"] : ["chromium"]) {
  const browser = await chromium.launch({ channel, headless: true });
  try {
    const page = await browser.newPage();
    await page.goto("about:blank");
    await page.addScriptTag({ content: reader });
    for (const pattern of loginPatterns) {
      const result = { browser: channel, version: browser.version(), name: pattern.name, ok: true };
      try {
        await page.setContent(pattern.html);
        if (pattern.focus) await page.locator(pattern.focus).focus();
        const scan = await page.evaluate(() => readLoginForms(location.origin, location.href));
        assert.equal(scan.forms.length, pattern.count ?? 1, "form count");
        const selected = scan.forms[scan.selectedIndex];
        if (pattern.blocked) { assert.equal(selected.password, ""); assert.ok(selected.warnings.length); }
        if (pattern.expected) for (const [key, value] of Object.entries(pattern.expected)) assert.equal(selected[key], value, key);
        if (pattern.fill) {
          await page.evaluate(() => { for (const input of document.querySelectorAll("input")) if (!input.readOnly) input.value = ""; });
          if (pattern.focus) await page.locator(pattern.focus).focus();
          await page.evaluate(() => useLoginForm("fill", location.origin, { username: "test-user", password: "synthetic-password" }, location.href));
          assert.equal(await page.locator("#u").inputValue(), "test-user", "filled account");
          assert.equal(await page.locator("#p").inputValue(), "synthetic-password", "filled password");
        }
      } catch (error) { result.ok = false; result.error = error.message; }
      results.push(result);
    }
  } finally { await browser.close(); }
}
await fs.writeFile(path.join(root, "results.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify({ artifacts: root, total: results.length, passed: results.filter(result => result.ok).length,
  failures: results.filter(result => !result.ok).map(({ browser, name, error }) => ({ browser, name, error })) }, null, 2));
if (results.some(result => !result.ok)) process.exitCode = 1;
