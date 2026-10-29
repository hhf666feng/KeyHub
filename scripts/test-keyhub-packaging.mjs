import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const source = (file) => fs.readFileSync(path.join(projectRoot, file), "utf8");
const unixOnly = { skip: process.platform === "win32" };
const rootDocumentation = ["README.md", "README.zh-CN.md", "SECURITY.md", "SECURITY.zh-CN.md",
  "PRIVACY.md", "PRIVACY.zh-CN.md", "LICENSE"];
const bundledDocumentation = [...rootDocumentation, "docs/guide.md", "docs/guide.zh-CN.md",
  ...["README.md", "listing.en.md", "listing.zh-CN.md", "privacy-practices.md", "reviewer-instructions.md"]
    .map((file) => `docs/chrome-web-store/${file}`),
  ".github/assets/keyhub-hero.svg"];

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "keyhub packaging-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function write(root, file, content, executable = false) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, { mode: executable ? 0o755 : 0o644 });
  return target;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 30_000, ...options });
  assert.ifError(result.error);
  return result;
}

function succeeded(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function verifyChecksums(root, manifest) {
  for (const line of fs.readFileSync(manifest, "utf8").trim().split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    assert.ok(match, `Invalid checksum line: ${line}`);
    const digest = createHash("sha256").update(fs.readFileSync(path.join(root, match[2]))).digest("hex");
    assert.equal(digest, match[1], `Checksum mismatch: ${match[2]}`);
  }
}

function linuxFixture(t, script) {
  const root = fixture(t);
  write(root, `scripts/${script}`, source(`scripts/${script}`));
  for (const file of bundledDocumentation) write(root, file, source(file));
  for (const file of ["docs/plans/local-verification.md", "docs/brand/local-notes.md", ".github/assets/unrelated.svg"]) {
    write(root, file, "Not for distribution\n");
  }
  for (const file of ["package-lock.json", "src-tauri/Cargo.toml",
    "src-tauri/Cargo.lock", "src-tauri/tauri.conf.json"]) write(root, file, "fixture\n");
  write(root, "package.json", JSON.stringify({ version: "1.2.3" }));
  write(root, "browser-extension/manifest.json", "{}\n");
  for (const directory of ["renderer", "src-tauri/src", "src-tauri/icons"]) {
    fs.mkdirSync(path.join(root, directory), { recursive: true });
  }
  write(root, "bin/uname", '#!/bin/sh\ncase "$1" in -s) echo Linux ;; -m) echo "$FIXTURE_ARCH" ;; esac\n', true);
  write(root, "bin/sha256sum", '#!/bin/sh\nexec shasum -a 256 "$@"\n', true);
  // macOS ships Bash 3; emulate only the mapfile builtin used by Linux scripts.
  const bashEnv = write(root, "bash-env", 'if ! type mapfile >/dev/null 2>&1; then\nmapfile() { local entry; while IFS= read -r entry; do eval "$2+=(\\\"\\$entry\\\")"; done; }\nfi\n');
  const env = { ...process.env, PATH: `${path.join(root, "bin")}:${path.dirname(process.execPath)}:${process.env.PATH}`,
    BASH_ENV: bashEnv, FIXTURE_ARCH: "x86_64" };
  return { root, env, package: () => run("bash", [path.join(root, "scripts", script)], { env }) };
}

for (const [script, suffix, appimage] of [
  ["package-headless-linux.sh", "linux-headless-x64.tar.gz", false],
  ["package-portable-linux.sh", "linux-x64-portable.tar.gz", true],
]) {
  test(`${script}: canonical artifacts, executable aliases and checksums`, unixOnly, (t) => {
    const f = linuxFixture(t, script);
    const binary = appimage
      ? "src-tauri/target/release/bundle/appimage/KeyHub_1.2.3_amd64.AppImage"
      : "src-tauri/target/release/keyhub";
    write(f.root, binary, appimage
      ? '#!/bin/sh\nprintf "%s\\n" "$KEYHUB_LAUNCHER_PATH" "$OPENKEYLET_LAUNCHER_PATH" "$KRU_LAUNCHER_PATH" "$APPIMAGE_EXTRACT_AND_RUN" "$@"\n'
      : '#!/bin/sh\nprintf "keyhub fixture\\n"\n', true);
    succeeded(f.package());
    const archiveName = `KeyHub_1.2.3_${suffix}`;
    const archive = path.join(f.root, "dist", archiveName);
    assert.ok(fs.existsSync(archive), `Missing ${archiveName}`);
    verifyChecksums(path.dirname(archive), `${archive}.sha256`);
    const extracted = path.join(f.root, "extracted");
    fs.mkdirSync(extracted);
    succeeded(run("tar", ["-xzf", archive, "-C", extracted]));
    const roots = fs.readdirSync(extracted);
    assert.equal(roots.length, 1);
    const packageRoot = path.join(extracted, roots[0]);
    assert.equal(roots[0], `KeyHub_1.2.3_${appimage ? "linux-x64" : "linux-headless-x64"}`);
    verifyChecksums(packageRoot, path.join(packageRoot, "SHA256SUMS.txt"));
    const checksums = fs.readFileSync(path.join(packageRoot, "SHA256SUMS.txt"), "utf8");
    const checksummedPaths = new Set(checksums.trim().split(/\r?\n/).map((line) => line.slice(66)));
    for (const file of bundledDocumentation) {
      assert.ok(fs.existsSync(path.join(packageRoot, file)), `Missing bundled documentation: ${file}`);
      assert.deepEqual(fs.readFileSync(path.join(packageRoot, file)), fs.readFileSync(path.join(f.root, file)),
        `Bundled documentation changed: ${file}`);
      assert.ok(checksummedPaths.has(`./${file}`), `Documentation is not checksummed: ${file}`);
    }
    assert.deepEqual(fs.readdirSync(path.join(packageRoot, "docs")).sort(),
      ["chrome-web-store", "guide.md", "guide.zh-CN.md"]);
    assert.deepEqual(fs.readdirSync(path.join(packageRoot, ".github/assets")), ["keyhub-hero.svg"]);
    for (const alias of ["keyhub", "openkeylet", "kru"]) {
      const executable = path.join(packageRoot, alias);
      assert.ok(fs.statSync(executable).mode & 0o111, `${alias} is not executable`);
      assert.match(checksums, new RegExp(`  \\./${alias}\\n`));
      assert.equal(fs.readFileSync(executable, "utf8"), fs.readFileSync(path.join(packageRoot, "keyhub"), "utf8"));
      const launched = run(executable, ["--fixture", "argument with spaces"], { env: f.env });
      succeeded(launched);
      const canonical = path.join(packageRoot, "keyhub");
      assert.equal(launched.stdout, appimage
        ? `${canonical}\n${canonical}\n${canonical}\n1\n--fixture\nargument with spaces\n`
        : "keyhub fixture\n");
    }
    assert.ok(!fs.existsSync(path.join(f.root, "dist", appimage ? ".portable-linux-stage" : ".headless-linux-stage")));

    write(f.root, "scripts/verify-portable-unix.sh", source("scripts/verify-portable-unix.sh"));
    write(f.root, "scripts/smoke-cli.mjs", 'import assert from "node:assert/strict";\nimport path from "node:path";\nassert.equal(path.basename(process.argv[2]), "keyhub");\nconsole.log("fixture canonical smoke");\n');
    const verify = (archivePath) => run("bash", [path.join(f.root, "scripts/verify-portable-unix.sh"),
      archivePath, appimage ? "linux-gui" : "linux-headless"], { env: f.env });
    const valid = verify(archive);
    succeeded(valid);
    assert.match(valid.stdout, /fixture canonical smoke/);

    const corruptArchive = path.join(f.root, "corrupt.tar.gz");
    const corruptAlias = write(packageRoot, "kru", '#!/bin/sh\necho corrupted alias\n', true);
    const repack = () => succeeded(run("tar", ["-czf", corruptArchive, "-C", extracted, roots[0]]));
    repack();
    const badChecksum = verify(corruptArchive);
    assert.notEqual(badChecksum.status, 0, "Verifier accepted a corrupt alias checksum");
    assert.doesNotMatch(badChecksum.stdout, /fixture canonical smoke/);

    const corruptHash = createHash("sha256").update(fs.readFileSync(corruptAlias)).digest("hex");
    fs.writeFileSync(path.join(packageRoot, "SHA256SUMS.txt"), checksums.replace(/^[a-f0-9]{64}(  \.\/kru)$/m, `${corruptHash}$1`));
    repack();
    const badAlias = verify(corruptArchive);
    assert.notEqual(badAlias.status, 0, "Verifier accepted an alias different from keyhub");
    assert.doesNotMatch(badAlias.stdout, /fixture canonical smoke/);
  });
}

test("Linux packaging still rejects stale AppImages and missing canonical binaries", unixOnly, (t) => {
  const gui = linuxFixture(t, "package-portable-linux.sh");
  const app = write(gui.root, "src-tauri/target/release/bundle/appimage/KeyHub.AppImage", "fixture", true);
  fs.utimesSync(app, new Date(0), new Date(0));
  const stale = gui.package();
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /older than its source/);
  assert.ok(!fs.existsSync(path.join(gui.root, "dist")));
  const headless = linuxFixture(t, "package-headless-linux.sh");
  write(headless.root, "src-tauri/target/release/openkeylet", "legacy only", true);
  const missing = headless.package();
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /KeyHub binary is missing/);
});

test("Windows packaging prefers KEYHUB overrides and keeps legacy aliases", () => {
  const script = source("scripts/package-portable.ps1");
  assert.match(script, /\$packageName = "KeyHub_\$\{version\}_windows-x64"/);
  for (const name of ["RELEASE_EXE", "DIST_ROOT"]) {
    assert.match(script, new RegExp(`if \\(\\$env:KEYHUB_${name}\\)`));
    assert.match(script, new RegExp(`elseif \\(\\$env:OPENKEYLET_${name}\\)`));
    assert.ok(script.indexOf(`$env:KEYHUB_${name}`) < script.indexOf(`$env:OPENKEYLET_${name}`));
  }
  assert.match(script, /release\\keyhub\.exe/);
  for (const alias of ["keyhub.exe", "openkeylet.exe", "kru.exe"]) assert.ok(script.includes(`"${alias}"`));
  assert.match(script, /Portable staging path escaped the dist directory/);
  assert.match(script, /Sort-Object FullName/);
  assert.match(script, /ComputeHash/);
  const verify = source("scripts/verify-portable-windows.ps1");
  for (const alias of ["keyhub.exe", "openkeylet.exe", "kru.exe"]) assert.ok(verify.includes(`"${alias}"`));
  assert.match(verify, /Internal checksum mismatch/);
  assert.match(verify, /scripts\\smoke-cli\.mjs"\) \(Join-Path \$root "keyhub\.exe"\)/);
});

test("Windows packaging bundles offline documentation at README-relative paths before checksumming", () => {
  const script = source("scripts/package-portable.ps1");
  const staging = script.slice(0, script.indexOf("$checksums ="));
  for (const file of rootDocumentation) {
    assert.ok(staging.includes(`Copy-Item -LiteralPath (Join-Path $projectRoot "${file}") -Destination $packageRoot`),
      `Missing root documentation copy: ${file}`);
  }
  for (const file of ["guide.md", "guide.zh-CN.md"]) {
    assert.ok(staging.includes(`Copy-Item -LiteralPath (Join-Path $projectRoot "docs\\${file}") -Destination (Join-Path $packageRoot "docs")`),
      `Missing guide copy: ${file}`);
  }
  assert.ok(staging.includes('Copy-Item -LiteralPath (Join-Path $projectRoot "docs\\chrome-web-store") -Destination (Join-Path $packageRoot "docs") -Recurse'));
  assert.ok(staging.includes('Copy-Item -LiteralPath (Join-Path $projectRoot ".github\\assets\\keyhub-hero.svg") -Destination (Join-Path $packageRoot ".github\\assets")'));
  for (const directory of ["docs", ".github\\assets"]) {
    assert.ok(staging.includes(`New-Item -ItemType Directory -Path (Join-Path $packageRoot "${directory}") -Force`));
  }
  assert.doesNotMatch(staging, /Copy-Item[^\n]*\$projectRoot "(?:docs|\.github|\.github\\assets)"/);
});

test("macOS packaging bundles only public offline documentation before checksumming", () => {
  const script = source("scripts/package-portable-macos.sh");
  const staging = script.slice(0, script.indexOf("signature_details="));
  for (const file of rootDocumentation) {
    assert.ok(staging.includes(`"$project_root/${file}"`), `Missing root documentation: ${file}`);
  }
  assert.ok(staging.includes('mkdir -p "$package_root/docs" "$package_root/.github/assets"'));
  assert.ok(staging.includes('cp "$project_root/docs/guide.md" "$project_root/docs/guide.zh-CN.md" "$package_root/docs/"'));
  assert.ok(staging.includes('cp -R "$project_root/docs/chrome-web-store" "$package_root/docs/chrome-web-store"'));
  assert.ok(staging.includes('cp "$project_root/.github/assets/keyhub-hero.svg" "$package_root/.github/assets/"'));
  assert.doesNotMatch(staging, /cp -R "\$project_root\/(?:docs|\.github|\.github\/assets)"/);
});

test("macOS packaging adds aliases outside the signed KeyHub.app", () => {
  const script = source("scripts/package-portable-macos.sh");
  assert.match(script, /package_name="KeyHub_\$\{version\}_macos-/);
  assert.match(script, /bundle\/macos\/KeyHub\.app/);
  assert.match(script, /cat > "\$package_root\/keyhub"/);
  assert.match(script, /exec "\$package_dir\/KeyHub\.app\/Contents\/MacOS\/keyhub" "\$@"/);
  assert.match(script, /for alias in openkeylet kru/);
  assert.match(script, /(?:cp|ln) "\$package_root\/keyhub" "\$package_root\/\$alias"/);
  assert.match(script, /KEYHUB_REQUIRE_DEVELOPER_ID:-\$\{OPENKEYLET_REQUIRE_DEVELOPER_ID:-0\}/);
  assert.match(script, /Authority=Developer ID Application:/);
  assert.match(script, /codesign --verify --deep --strict/);
  assert.match(script, /codesign --force --deep --sign -/);
  assert.match(script, /--sequesterRsrc --keepParent/);
  const verify = source("scripts/verify-portable-unix.sh");
  assert.match(verify, /KeyHub\.app\/Contents\/MacOS\/keyhub/);
  assert.match(verify, /KEYHUB_REQUIRE_NOTARIZED:-\$\{OPENKEYLET_REQUIRE_NOTARIZED:-0\}/);
  assert.match(verify, /for alias in keyhub openkeylet kru/);
  for (const guard of ["stapler validate", "spctl --assess", "Timestamp=", "runtime"]) assert.ok(verify.includes(guard));
  const notarize = source("scripts/notarize-macos.sh");
  assert.match(notarize, /keyhub-notary\.XXXXXX/);
  assert.match(notarize, /notary_zip="\$work_dir\/KeyHub\.zip"/);
  for (const guard of ["APPLE_API_KEY_PATH", "codesign --verify --deep --strict", "Accepted)", "Invalid|Rejected)", "stapler validate", "deadline="]) {
    assert.ok(notarize.includes(guard));
  }
});

test("Chrome store packaging preserves its allowlist, permissions and cleanup guard", () => {
  const script = source("scripts/package-chrome-store.ps1");
  assert.match(script, /'keyhub-store-'/);
  assert.match(script, /"keyhub-chrome-store-"/);
  assert.match(script, /\^keyhub-store-\[a-f0-9\]\{32\}\$/);
  for (const guard of ["TEMP must be inside MYENV_ROOT", "Manifest V3 is required", "@('scripting', 'storage')",
    "Desktop/package and extension versions differ", "Properties.Remove('key')", "Properties.Remove('update_url')",
    "Unexpected ZIP contents", "Refusing cleanup outside packaging stage", "SHA256SUMS.txt"]) assert.ok(script.includes(guard));
  assert.match(script, /'ui\.js'/, 'The explicit package allowlist must include the local presentation helper');
});

function versionFixture(t, name = "keyhub", extensionVersion = "1.2.3", lockVersion = "1.2.3") {
  const root = fixture(t);
  write(root, "package.json", JSON.stringify({ version: "1.2.3" }));
  write(root, "package-lock.json", JSON.stringify({ version: "1.2.3", packages: { "": { version: "1.2.3" } } }));
  write(root, "src-tauri/tauri.conf.json", JSON.stringify({ version: "1.2.3" }));
  write(root, "browser-extension/manifest.json", JSON.stringify({ version: extensionVersion }));
  write(root, "src-tauri/Cargo.toml", `[package]\nversion = "1.2.3"\nname = "${name}"\n[dependencies]\nversion = "9.9.9"\n`);
  write(root, "src-tauri/Cargo.lock", `[[package]]\nname = "other"\nversion = "9.9.9"\n\n[[package]]\nname = "${name}"\nversion = "${lockVersion}"\n`);
  return (tag = "v1.2.3") => run(process.execPath, [path.join(projectRoot, "scripts/check-version.mjs")], {
    cwd: root, env: { ...process.env, GITHUB_REF: `refs/tags/${tag}` },
  });
}

test("version check resolves the Cargo package dynamically, including name after version", (t) => {
  for (const name of ["keyhub", "openkeylet", "fixture-renamed-package"]) {
    const result = versionFixture(t, name)();
    succeeded(result);
    assert.match(result.stdout, /KeyHub version 1\.2\.3 is consistent/);
  }
});

test("version check rejects extension, Cargo lock and release-tag mismatches", (t) => {
  for (const [invoke, expected] of [
    [versionFixture(t, "keyhub", "1.2.4"), /browser-extension\/manifest\.json=1\.2\.4/],
    [versionFixture(t, "keyhub", "1.2.3", "1.2.4"), /Cargo\.lock=1\.2\.4/],
    [() => versionFixture(t)("v2.0.0"), /tag v2\.0\.0 does not match v1\.2\.3/],
  ]) {
    const result = invoke();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, expected);
  }
});

test("CLI and GUI smoke guards still reject non-CI execution before launching anything", () => {
  for (const file of ["smoke-cli.mjs", "smoke-gui.mjs"]) {
    const script = source(`scripts/${file}`);
    const result = run(process.execPath, [path.join(projectRoot, "scripts", file), "nonexistent-keyhub-fixture"], {
      env: { ...process.env, CI: "false", GITHUB_ACTIONS: "false" },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Refusing to .* outside an ephemeral GitHub Actions runner/);
    assert.ok(script.includes('process.env.CI !== "true" || process.env.GITHUB_ACTIONS !== "true"'));
    assert.match(script, /<keyhub executable>/);
    for (const override of ["KEYHUB_DATA_DIR", "OPENKEYLET_DATA_DIR", "KRU_DATA_DIR"]) assert.ok(script.includes(`"${override}"`));
    for (const directory of ["HOME", "XDG_DATA_HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME"]) {
      assert.match(script, new RegExp(`${directory}: path\\.join\\(smokeRoot,`));
    }
  }
  const cli = source("scripts/smoke-cli.mjs");
  assert.match(cli, /mcpServers\?\.keyhub\?\.args/);
  assert.ok(cli.includes('/\\[mcp_servers\\.keyhub\\]/'));
  for (const guard of ["FOLDERID_RoamingAppData", "Refusing to reuse an existing vault", '"mcp-vault", "v2"', "0o700", "0o600"]) {
    assert.ok(cli.includes(guard));
  }
});

test("smoke scripts discard inherited data and launcher overrides in an in-memory sandbox", async () => {
  const overrides = ["KEYHUB_DATA_DIR", "OPENKEYLET_DATA_DIR", "KRU_DATA_DIR",
    "KEYHUB_LAUNCHER_PATH", "OPENKEYLET_LAUNCHER_PATH", "KRU_LAUNCHER_PATH"];
  for (const file of ["smoke-cli.mjs", "smoke-gui.mjs"]) {
    let capturedEnv;
    const stop = new Error("fixture stopped before executable launch");
    const captureSpawn = (_command, _args, options) => {
      capturedEnv = options.env;
      throw stop;
    };
    const inheritedEnv = { CI: "true", GITHUB_ACTIONS: "true", HOME: "/real/home",
      ...Object.fromEntries(overrides.map((name) => [name, "/real/private/location"])) };
    const sandbox = {
      assert, path: path.posix,
      os: { tmpdir: () => "/fixture" },
      process: { platform: "linux", argv: ["node", file, "/fixture/keyhub"], env: inheritedEnv },
      fs: { mkdtempSync: () => "/fixture/smoke", mkdirSync() {}, rmSync() {},
        existsSync: (filePath) => filePath === "/fixture/keyhub" },
      spawn: captureSpawn, spawnSync: captureSpawn,
    };
    // Execute the actual smoke source with only in-memory filesystem/process adapters.
    const script = source(`scripts/${file}`).replace(/^import .*;\r?\n/gm, "");
    await assert.rejects(vm.runInNewContext(`(async () => {\n${script}\n})()`, sandbox), (error) => error === stop);
    assert.ok(capturedEnv, `${file} did not reach the fixture spawn`);
    assert.equal(capturedEnv.HOME, "/fixture/smoke/home");
    assert.equal(capturedEnv.XDG_DATA_HOME, "/fixture/smoke/data");
    for (const name of overrides) {
      assert.equal(capturedEnv[name], undefined, `${file} inherited ${name}`);
      assert.equal(inheritedEnv[name], "/real/private/location", `${file} mutated its parent's environment`);
    }
  }
});

test("release workflow consumes canonical KeyHub artifacts without weakening signing or checksums", () => {
  const workflow = source(".github/workflows/release.yml");
  assert.match(workflow, /name: KeyHub portable release/);
  assert.match(workflow, /archives=\(KeyHub_\*\)/);
  assert.match(workflow, /--title "KeyHub \$GITHUB_REF_NAME"/);
  assert.match(workflow, /KEYHUB_REQUIRE_DEVELOPER_ID: '1'/);
  assert.match(workflow, /KEYHUB_REQUIRE_NOTARIZED: '1'/);
  assert.match(workflow, /scripts\/test-keyhub-packaging\.mjs/);
  assert.doesNotMatch(workflow, /OpenKeylet|openkeylet/);
  for (const guard of ["--verify-tag", "stapler validate", "spctl --assess", "--deep --strict", "Expected exactly four release archives", "sha256sum -c SHA256SUMS.txt"]) {
    assert.ok(workflow.includes(guard));
  }
});
