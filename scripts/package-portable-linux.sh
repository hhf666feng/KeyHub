#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "This packaging script must run on Linux." >&2
  exit 1
fi

script_dir="$(cd "$(dirname "$0")" && pwd)"
project_root="$(cd "$script_dir/.." && pwd)"
version="$(node -p "require('$project_root/package.json').version")"

case "$(uname -m)" in
  x86_64) package_arch="x64" ;;
  aarch64|arm64) package_arch="arm64" ;;
  *) echo "Unsupported Linux architecture: $(uname -m)" >&2; exit 1 ;;
esac

appimage_dir="$project_root/src-tauri/target/release/bundle/appimage"
mapfile -t app_sources < <(find "$appimage_dir" -maxdepth 1 -type f -name '*.AppImage' -print | sort)
if [[ ${#app_sources[@]} -ne 1 ]]; then
  echo "Expected exactly one freshly built KeyHub AppImage, found ${#app_sources[@]}. Remove stale bundle output and rebuild." >&2
  exit 1
fi
app_source="${app_sources[0]}"
if find "$project_root/renderer" "$project_root/browser-extension" "$project_root/src-tauri/src" "$project_root/src-tauri/icons" \
  "$project_root/package.json" "$project_root/package-lock.json" "$project_root/src-tauri/Cargo.toml" \
  "$project_root/src-tauri/Cargo.lock" "$project_root/src-tauri/tauri.conf.json" \
  -type f -newer "$app_source" -print -quit | grep -q .; then
  echo "KeyHub AppImage is older than its source. Run npm run build:linux again." >&2
  exit 1
fi

package_name="KeyHub_${version}_linux-${package_arch}"
dist_root="$project_root/dist"
stage_root="$dist_root/.portable-linux-stage"
package_root="$stage_root/$package_name"
archive_path="$dist_root/${package_name}-portable.tar.gz"
checksum_path="$archive_path.sha256"

case "$stage_root" in
  "$dist_root"/*) ;;
  *) echo "Portable staging path escaped the dist directory." >&2; exit 1 ;;
esac

rm -rf "$stage_root"
mkdir -p "$package_root"
cp "$app_source" "$package_root/KeyHub.AppImage"
chmod +x "$package_root/KeyHub.AppImage"
cat > "$package_root/keyhub" <<'EOF'
#!/bin/sh
set -eu
package_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
export APPIMAGE_EXTRACT_AND_RUN=1
export KEYHUB_LAUNCHER_PATH="$package_dir/keyhub"
export OPENKEYLET_LAUNCHER_PATH="$KEYHUB_LAUNCHER_PATH"
export KRU_LAUNCHER_PATH="$KEYHUB_LAUNCHER_PATH"
exec "$package_dir/KeyHub.AppImage" "$@"
EOF
chmod +x "$package_root/keyhub"
for alias in openkeylet kru; do
  cp "$package_root/keyhub" "$package_root/$alias"
done
cp "$project_root/README.md" "$project_root/README.zh-CN.md" \
  "$project_root/SECURITY.md" "$project_root/SECURITY.zh-CN.md" \
  "$project_root/PRIVACY.md" "$project_root/PRIVACY.zh-CN.md" "$project_root/LICENSE" "$package_root/"
mkdir -p "$package_root/docs" "$package_root/.github/assets"
cp "$project_root/docs/guide.md" "$project_root/docs/guide.zh-CN.md" "$package_root/docs/"
cp -R "$project_root/docs/chrome-web-store" "$package_root/docs/chrome-web-store"
cp "$project_root/.github/assets/keyhub-hero.svg" "$project_root/.github/assets/keyhub-demo.gif" \
  "$project_root/.github/assets/keyhub-demo.zh-CN.gif" "$package_root/.github/assets/"
cp -R "$project_root/browser-extension" "$package_root/browser-extension"

(
  cd "$package_root"
  find . -type f ! -name SHA256SUMS.txt -print0 \
    | sort -z \
    | xargs -0 sha256sum \
    > SHA256SUMS.txt
)

rm -f "$archive_path" "$checksum_path"
tar -C "$stage_root" -czf "$archive_path" "$package_name"
sha256sum "$archive_path" | sed "s#  .*#  $(basename "$archive_path")#" > "$checksum_path"
rm -rf "$stage_root"

ls -lh "$archive_path" "$checksum_path"
