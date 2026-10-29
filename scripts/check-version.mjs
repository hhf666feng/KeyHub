import fs from "node:fs";

function fail(message) {
  console.error(`version check failed: ${message}`);
  process.exit(1);
}

const packageVersion = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
const packageLock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
const packageLockVersion = packageLock.version;
const packageLockRootVersion = packageLock.packages?.[""]?.version;
const tauriVersion = JSON.parse(
  fs.readFileSync("src-tauri/tauri.conf.json", "utf8"),
).version;
const extensionVersion = JSON.parse(
  fs.readFileSync("browser-extension/manifest.json", "utf8"),
).version;

const cargoLines = fs.readFileSync("src-tauri/Cargo.toml", "utf8").split(/\r?\n/);
let inPackage = false;
let cargoVersion;
let cargoName;
for (const line of cargoLines) {
  const trimmed = line.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    inPackage = trimmed === "[package]";
    continue;
  }
  if (inPackage) {
    const versionMatch = trimmed.match(/^version\s*=\s*"([^"]+)"(?:\s*#.*)?$/);
    const nameMatch = trimmed.match(/^name\s*=\s*"([^"]+)"(?:\s*#.*)?$/);
    if (versionMatch) cargoVersion = versionMatch[1];
    if (nameMatch) cargoName = nameMatch[1];
  }
}

const cargoLock = fs.readFileSync("src-tauri/Cargo.lock", "utf8");
const cargoLockPackage = cargoLock.split(/^\[\[package\]\]\s*$/m).slice(1).find(
  (block) => block.match(/^name\s*=\s*"([^"]+)"\s*$/m)?.[1] === cargoName,
);
const cargoLockVersion = cargoLockPackage?.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];

const versions = {
  "package.json": packageVersion,
  "package-lock.json": packageLockVersion,
  "package-lock.json root": packageLockRootVersion,
  "Cargo.toml": cargoVersion,
  "Cargo.lock": cargoLockVersion,
  "tauri.conf.json": tauriVersion,
  "browser-extension/manifest.json": extensionVersion,
};
if (Object.values(versions).some((version) => !version)) {
  fail(`could not read every source version: ${JSON.stringify(versions)}`);
}
if (new Set(Object.values(versions)).size !== 1) {
  fail(Object.entries(versions).map(([file, version]) => `${file}=${version}`).join(", "));
}

const tag = process.env.GITHUB_REF?.startsWith("refs/tags/")
  ? process.env.GITHUB_REF.slice("refs/tags/".length)
  : "";
if (tag && tag !== `v${packageVersion}`) {
  fail(`tag ${tag} does not match v${packageVersion}`);
}

console.log(`KeyHub version ${packageVersion} is consistent${tag ? ` (${tag})` : ""}.`);
