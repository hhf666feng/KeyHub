// Optional read-only structural probe. Fresh profile, no typing, clicks, or login submissions.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "openkeylet-public-login-probe-"));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const targets = [
  ["GitHub", "https://github.com/login"],
  ["Google", "https://accounts.google.com/v3/signin/identifier"],
  ["Microsoft", "https://login.live.com/"],
  ["GitLab", "https://gitlab.com/users/sign_in"],
];
try {
  const context = await browser.newContext();
  const results = await Promise.all(targets.map(async ([name, url]) => {
    const page = await context.newPage();
    const result = { name, url, browserVersion: browser.version(), scope: "read-only public form structure; no authentication tested" };
    try {
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
      result.status = response?.status();
      await page.locator("input:visible").first().waitFor({ timeout: 8000 }).catch(() => {});
      result.finalOrigin = new URL(page.url()).origin;
      result.fields = await page.locator("input:visible").evaluateAll(inputs => inputs.map(input => ({
        type: input.type, name: input.name.slice(0, 100), id: input.id.slice(0, 100),
        autocomplete: input.autocomplete, label: (input.getAttribute("aria-label")
          || [...(input.labels || [])].map(label => label.textContent).join(" ")).trim().slice(0, 120),
      })));
      result.observed = result.status < 400 && result.fields.some(input => ["text", "email", "password"].includes(input.type));
    } catch (error) { result.observed = false; result.error = error.message.split("\n")[0]; }
    await page.close(); return result;
  }));
  await fs.writeFile(path.join(root, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ artifacts: root, results }, null, 2));
} finally { await browser.close(); }
