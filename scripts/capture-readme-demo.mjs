// Record the real renderer against the synthetic Tauri fixture, never a local vault.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { startStaticServer } from './fixtures/static-server.mjs';
import { createWorkspaceFixture, installWorkspaceFixture } from './fixtures/workspace.mjs';

const repo = path.resolve(import.meta.dirname, '..');
const renderer = path.join(repo, 'renderer');
const requestedLanguage = process.argv.find(argument => argument.startsWith('--language='))?.split('=')[1] || 'en';
if (!['en', 'zh-CN'].includes(requestedLanguage)) {
  throw new Error('Usage: node scripts/capture-readme-demo.mjs --language=<en|zh-CN>');
}
const language = requestedLanguage === 'zh-CN' ? 'zh' : 'en';
const suffix = language === 'zh' ? '.zh-CN' : '';
const output = path.join(repo, `.github/assets/keyhub-demo${suffix}.gif`);
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), `keyhub-readme-demo-${language}-`));
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const server = await startStaticServer(renderer);
let browser;
let video = null;

async function showCursor(page) {
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = `
      #keyhub-demo-cursor{position:fixed;z-index:2147483647;left:0;top:0;width:22px;height:22px;
        border:2px solid #f1a24a;border-radius:50%;background:rgba(255,255,255,.6);
        box-shadow:0 2px 8px rgba(0,0,0,.32);pointer-events:none;transform:translate(-50%,-50%);
        transition:left 160ms ease-out,top 160ms ease-out,transform 100ms ease-out}
      #keyhub-demo-cursor.is-clicking{transform:translate(-50%,-50%) scale(.62)}`;
    document.head.append(style);
    const cursor = document.createElement('div');
    cursor.id = 'keyhub-demo-cursor';
    document.body.append(cursor);
    window.demoCursor = cursor;
  });
}

async function moveTo(page, selector) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`Demo target is not visible: ${selector}`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y, { steps: 12 });
  await page.locator('#keyhub-demo-cursor').evaluate((cursor, point) => {
    cursor.style.left = `${point.x}px`;
    cursor.style.top = `${point.y}px`;
  }, { x, y });
  await pause(260);
  return { x, y };
}

async function click(page, selector) {
  const point = await moveTo(page, selector);
  await page.locator('#keyhub-demo-cursor').evaluate(cursor => cursor.classList.add('is-clicking'));
  await page.mouse.down();
  await pause(110);
  await page.mouse.up();
  await page.locator('#keyhub-demo-cursor').evaluate(cursor => cursor.classList.remove('is-clicking'));
  await pause(300);
  return point;
}

try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
    args: ['--disable-background-networking', '--disable-component-update', '--no-first-run'],
  });
  const context = await browser.newContext({
    viewport: { width: 1200, height: 800 },
    reducedMotion: 'no-preference',
    recordVideo: { dir: temporary, size: { width: 1200, height: 800 } },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === server.url) return route.continue();
    return route.abort('blockedbyclient');
  });
  await page.addInitScript(installWorkspaceFixture, createWorkspaceFixture({ language, theme: 'dark' }));
  await page.goto(server.url);
  await page.locator('.connection-card[data-item-id="login-acme"]').waitFor();
  await showCursor(page);
  await page.mouse.move(600, 400);
  await page.locator('#keyhub-demo-cursor').evaluate(cursor => {
    cursor.style.left = '600px';
    cursor.style.top = '400px';
  });
  await pause(1000);

  await click(page, '#title-search-input');
  await page.locator('#title-search-input').pressSequentially('Build', { delay: 95 });
  await pause(800);
  await click(page, '.connection-card[data-item-id="api-build"] .connection-name');
  await pause(900);
  await click(page, '#workspace-detail [data-action="use"]');
  await pause(1800);
  await click(page, '#workspace-use-close');
  await click(page, '.nav [data-page="activity"]');
  await pause(1300);
  await click(page, '.nav [data-page="settings"]');
  await pause(1300);

  video = page.video();
  await context.close();
  const input = await video.path();
  await fs.mkdir(path.dirname(output), { recursive: true });
  const ffmpeg = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', input,
    '-vf', 'fps=10,scale=960:-1:flags=lanczos,split[frames][palette];[palette]palettegen=max_colors=128:stats_mode=diff[colors];[frames][colors]paletteuse=dither=bayer:bayer_scale=4',
    '-loop', '0', output,
  ], { stdio: 'inherit' });
  if (ffmpeg.error) throw ffmpeg.error;
  if (ffmpeg.status !== 0) throw new Error(`ffmpeg exited with ${ffmpeg.status}`);
  const size = (await fs.stat(output)).size;
  if (size > 10 * 1024 * 1024) throw new Error(`Demo GIF is too large for README: ${size} bytes`);
  console.log(`Wrote ${path.relative(repo, output)} (${(size / 1024 / 1024).toFixed(2)} MiB)`);
} finally {
  if (video) await video.delete().catch(() => {});
  await browser?.close();
  await server.close();
  await fs.rm(temporary, { recursive: true, force: true });
}
