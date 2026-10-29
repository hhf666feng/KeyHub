import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = file => readFileSync(new URL(file, import.meta.url), "utf8");
const hash = source => createHash("sha256").update(source).digest("hex");
const rebrand = text => text.replaceAll("OpenKeylet", "KeyHub").replaceAll("an KeyHub", "a KeyHub");
const displayText = {
  "capture.js": ["请先解锁 OpenKeylet / Unlock OpenKeylet first"],
  "content-script.js": ["OpenKeylet · 保存登录信息", "OpenKeylet request failed"],
  "popup.js": [
    "OpenKeylet unavailable",
    "请确认 OpenKeylet 已打开且浏览器连接已启用。 / Check that OpenKeylet and Browser Bridge are running.",
    "已保存到本地密码库 / Saved to OpenKeylet",
    "在 OpenKeylet 安装指引中点击“打开扩展页” / Click Open extensions page in OpenKeylet",
  ],
  "provider.js": ["Open OpenKeylet and connect Browser Bridge first", "OpenKeylet did not respond", "OpenKeylet disconnected"],
  "request.js": [
    "此网站要求身份验证。请先在 OpenKeylet 设置六位 PIN，再重新发起请求。 / Set an OpenKeylet PIN, then retry.",
    "凭据保存在本机 OpenKeylet。确认后完成此网站的请求。 / Stored in your local OpenKeylet vault.",
  ],
  "vault.js": ["已保存到 OpenKeylet / Saved"],
};
const htmlFiles = ["popup.html", "request.html", "privacy.html"];
const privacyParagraphPrefixes = [
  "<p>KeyHub was previously OpenKeylet (originally KRU).",
  "<p>KeyHub 原名 OpenKeylet，更早为 KRU。",
];
const privacyHrefs = [
  "#english", "#chinese",
  "https://github.com/omaekumiko2-create/OpenKeylet/issues",
  "https://github.com/omaekumiko2-create/OpenKeylet/security/advisories/new",
  "https://github.com/omaekumiko2-create/OpenKeylet/blob/main/SECURITY.md",
  "https://github.com/omaekumiko2-create/OpenKeylet/blob/main/SECURITY.zh-CN.md",
  "https://github.com/omaekumiko2-create/OpenKeylet/blob/main/README.md#migration-and-capability-parity",
  "https://github.com/omaekumiko2-create/OpenKeylet/blob/main/README.zh-CN.md#迁移与能力保持",
];

const textContent = html => [...html.matchAll(/(?<=>)[^<]+/g)].map(match => match[0]).join("\n");
function assertPageBranding(file, source) {
  const text = textContent(source);
  assert.match(text, /KeyHub/, file);
  assert.ok([...text.matchAll(/keyhub/gi)].every(match => match[0] === "KeyHub"), file);
  if (file === "privacy.html") {
    for (const prefix of privacyParagraphPrefixes) {
      const paragraphs = [...source.matchAll(/<p>[\s\S]*?<\/p>/g)].map(match => match[0]).filter(p => p.startsWith(prefix));
      assert.equal(paragraphs.length, 1, `${file}: one explicit compatibility paragraph per language`);
      assert.deepEqual([...textContent(paragraphs[0]).matchAll(/dev\.kru\.desktop|openkeylet|kru/gi)].map(match => match[0]),
        ["OpenKeylet", "KRU", "dev.kru.desktop"], `${file}: only exact legacy names in compatibility prose`);
      source = source.replace(paragraphs[0], "");
    }
  }
  assert.doesNotMatch(textContent(source), /openkeylet|kru/i, `${file}: no legacy branding outside compatibility prose`);
}

// Independently render the small Markdown subset used by the published policies; no file writes.
function renderPolicy(markdown) {
  const inline = text => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
      const target = href.startsWith("https://") ? href : `https://github.com/omaekumiko2-create/OpenKeylet/blob/main/${href}`;
      return `<a href="${target}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    });
  return markdown.trim().split(/\r?\n\r?\n/).map(block => {
    if (block.startsWith("# ")) return `<h1>${inline(block.slice(2))}</h1>`;
    if (block.startsWith("## ")) return `<h2>${inline(block.slice(3))}</h2>`;
    if (block.startsWith("- ")) return `<ul>${block.split(/\r?\n/).map(line => `<li>${inline(line.slice(2))}</li>`).join("")}</ul>`;
    return `<p>${inline(block)}</p>`;
  }).join("\n");
}

function assertPrivacyHrefs(source) {
  const hrefs = [...new Set([...source.matchAll(/href="([^"]+)"/g)].map(match => match[1]))];
  assert.deepEqual(hrefs.sort(), [...privacyHrefs].sort(), "privacy upstream provenance href set stays frozen");
}

// Freeze the unauthorised protocol/data surfaces. Popup/vault/request presentation
// is intentionally editable for the requested localization and visual parity pass;
// its command and element contracts are asserted separately below.
const compatibility = {
  "capture.js": "1b0d138c5e0a9f4194e5e7e0cc03eff473c9d6d1229d764b32c636f41f024962",
  "content-script.js": "b23c7839c727c176c43292d2b78a8a3b586aad2f027af44320122f0dbaeb66ce",
  "popup.js": "879a21d298c5bd5c2b1c01766439009199dd8aeda6fa6b409f721761e41c273a",
  "provider.js": "496920d67c4c831af402434bc67735d8e45907af94f16f084e4a0ee5d483449c",
  "request.js": "e4ea03cf32a331b935d36ea631e62ffce2f138e40f34d0f7fd5482299f0f1355",
  "vault.js": "db49dd573e0a99080b1d78fdb3f21e448c63df6aed999410207d1e42517e3a4c",
  "popup.html": "d71b7bb58424988592b8989ce33752cfd2ecbd758338b12cf641fb5a9036f341",
  "request.html": "5a061bfe3f3381c4ca4e6d858445da0b2b7c472032ee141fd0ef5cba4a13d6d0",
  "service-worker.js": "dd9981eb142f1a0c3a959b9d4ce837559f7c43f32335f99971ac4b816032254d",
  "form-reader.js": "f0cfbae2851917ccfe5081404be027eef285f518bd60c8c0c894add2951bc6fc",
  "webauthn-main.js": "3de9c231aeaaa19111aa252d708bfbf04b6149c33461b3319baa08db874014ca",
  "popup.css": "4f58e6094514ad9383f104fbfad53d9b788026e4fcb773377a0bfb8127189afb",
};

test("manifest display name, title and description use exact KeyHub branding", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.equal(manifest.name, "KeyHub");
  assert.equal(manifest.action.default_title, "KeyHub");
  assert.equal(manifest.description, "Local passwords, passkeys and autofill with your KeyHub desktop vault. Requires the KeyHub desktop app.");
});

test("manifest key, fixed ID, version, permissions and every non-display field stay frozen", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const id = createHash("sha256").update(Buffer.from(manifest.key, "base64")).digest("hex").slice(0, 32)
    .replace(/[0-9a-f]/g, char => String.fromCharCode(97 + parseInt(char, 16)));
  assert.equal(id, "knkjojeijgalhpdkfapohofobfomenmi");
  delete manifest.name;
  delete manifest.description;
  delete manifest.action.default_title;
  assert.equal(hash(JSON.stringify(manifest)), "3fc8948f50314d39bce80b6e21b7845717c2d432f8e38799f33884c753a280e2");
});

test("popup, passkey and privacy page text uses KeyHub without rewriting link targets", () => {
  for (const file of htmlFiles) assertPageBranding(file, read(file));
});

test("privacy prose exactly matches both generated root policies and the HTML shell stays frozen", () => {
  const source = read("privacy.html");
  for (const [id, document] of [["english", "PRIVACY.md"], ["chinese", "PRIVACY.zh-CN.md"]]) {
    const section = source.match(new RegExp(`<section id="${id}" lang="[^"]+">([\\s\\S]*?)</section>`));
    assert.ok(section?.[1] === renderPolicy(read(`../${document}`)), `${id}: regenerate privacy.html from ${document}`);
  }
  const shell = source.replace(/(<section id="(?:english|chinese)" lang="[^"]+">)[\s\S]*?(<\/section>)/g, "$1POLICY$2");
  assert.equal(hash(shell), "bdcc987e3af9f94e904cbc80494f25a6b6e40501482fef39c25847da96a782c7");
});

test("privacy links retain the exact upstream href set including migration provenance", () => {
  assertPrivacyHrefs(read("privacy.html"));
});

test("privacy allowlist rejects legacy branding elsewhere, altered legacy names and renamed upstream links", () => {
  const source = read("privacy.html");
  assertPageBranding("privacy.html", source);
  assert.throws(() => assertPageBranding("privacy.html", source.replace("<h1>KeyHub privacy policy</h1>", "<h1>OpenKeylet privacy policy</h1>")));
  assert.throws(() => assertPageBranding("privacy.html", source.replace("(originally KRU)", "(originally kru)")));
  assert.throws(() => assertPageBranding("privacy.html", source.replace("dev.kru.desktop", "dev.KRU.desktop")));
  assert.throws(() => assertPrivacyHrefs(source.replaceAll("/OpenKeylet/", "/KeyHub/")));
});

test("save, vault, passkey and bridge status messages use KeyHub", () => {
  for (const [file, labels] of Object.entries(displayText)) {
    const source = read(file);
    for (const label of labels) assert.ok(source.includes(rebrand(label)), `${file}: ${rebrand(label)}`);
    assert.doesNotMatch(source, /OpenKeylet\b/, file);
  }
});

for (const [file, expected] of Object.entries(compatibility)) {
  if (["popup.js", "vault.js", "request.js", "popup.html", "request.html", "popup.css"].includes(file)) continue;
  test(`${file}: no changes beyond approved display text`, () => {
    let source = read(file);
    for (const label of displayText[file] || []) source = source.replaceAll(label, rebrand(label));
    if (htmlFiles.includes(file)) source = source.replace(/(?<=>)[^<]+/g, rebrand);
    assert.equal(hash(source), expected, `${file}: review compatibility before changing this baseline`);
  });
}

test("localized extension pages load the local UI adapter and preserve native page boundaries", () => {
  for (const file of ["popup.html", "request.html"]) {
    const html = read(file);
    assert.match(html, /<script src="ui\.js"><\/script>/);
    for (const id of ["ui-language", "ui-theme", "error"]) assert.ok(html.includes(`id="${id}"`), `${file}: ${id}`);
    assert.doesNotMatch(html, /<script[^>]+src="https?:|<link[^>]+href="https?:/);
  }
  const ui = read('ui.js');
  for (const key of ['uiLanguage', 'uiTheme']) assert.ok(ui.includes(key));
  assert.doesNotMatch(ui, /localStorage|fetch\(|XMLHttpRequest|MutationObserver/);
  assert.match(read('vault.js'), /const OpenKeyletVaultUI/);
});

test("extension presentation changes retain every RPC action and trusted message envelope", () => {
  const actions = {
    'popup.js': ['capture-dismiss','capture-read','fill','generate','list','lock','personal-edit','personal-fill','personal-save','read-form','unlock'],
    'vault.js': ['vault-clear-history','vault-get','vault-history','vault-purge','vault-restore','vault-save','vault-trash'],
    'request.js': ['confirm','info'],
  };
  for (const [file, expected] of Object.entries(actions)) {
    const source = read(file);
    const actual = [...new Set([...source.matchAll(/\b(?:call|mutate)\("([\w-]+)"/g)].map(match => match[1]))].sort();
    assert.deepEqual(actual, expected, `${file}: RPC actions`);
  }
  for (const text of ['type: "vault-ui"', 'origin: currentOrigin', 'captureTabId']) assert.ok(read('popup.js').includes(text));
  for (const text of ['type:"credential-ui"', '"fallback","cancel"', 'credentialId:', 'pin:']) assert.ok(read('request.js').includes(text));
});

test("extension UI keeps lock clearing, stale-write tokens and confirmation gates", () => {
  const popup = read('popup.js'), vault = read('vault.js'), request = read('request.js');
  assert.match(popup, /if \(state\.locked\) \{ closeSave\(\); closePersonal\(\); OpenKeyletVaultUI\.close\(\); \}/);
  for (const text of ['expectedUpdatedAt:item.updatedAt', 'deletedAt:entry.deletedAt', 'if(await ask(', 'confirmResolver']) assert.ok(vault.includes(text), text);
  assert.match(request, /finally\{\$\("#pin"\)\.value="";\}/);
  assert.match(popup, /\/\/ Vault access is handled by the authenticated extension service worker/);
});
