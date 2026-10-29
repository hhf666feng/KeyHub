#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This packaging script must run on macOS." >&2
  exit 1
fi

script_dir="$(cd "$(dirname "$0")" && pwd)"
project_root="$(cd "$script_dir/.." && pwd)"
version="$(node -p "require('$project_root/package.json').version")"

case "$(uname -m)" in
  arm64) package_arch="arm64" ;;
  x86_64) package_arch="x64" ;;
  *) echo "Unsupported macOS architecture: $(uname -m)" >&2; exit 1 ;;
esac

package_name="KeyHub_${version}_macos-${package_arch}"
app_source="$project_root/src-tauri/target/release/bundle/macos/KeyHub.app"
dist_root="$project_root/dist"
stage_root="$dist_root/.portable-macos-stage"
package_root="$stage_root/$package_name"
archive_path="$dist_root/${package_name}-portable.zip"
checksum_path="$archive_path.sha256"

if [[ ! -d "$app_source" ]]; then
  echo "KeyHub.app is missing. Run npm run build:mac first." >&2
  exit 1
fi

case "$stage_root" in
  "$dist_root"/*) ;;
  *) echo "Portable staging path escaped the dist directory." >&2; exit 1 ;;
esac

rm -rf "$stage_root"
mkdir -p "$package_root"
/usr/bin/ditto "$app_source" "$package_root/KeyHub.app"
cat > "$package_root/keyhub" <<'EOF'
#!/bin/sh
set -eu
package_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
exec "$package_dir/KeyHub.app/Contents/MacOS/keyhub" "$@"
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
cp "$project_root/.github/assets/keyhub-hero.svg" "$project_root/.github/assets/keyhub-demo.gif" "$package_root/.github/assets/"
cp -R "$project_root/browser-extension" "$package_root/browser-extension"

signature_details="$(/usr/bin/codesign --display --verbose=4 "$package_root/KeyHub.app" 2>&1 || true)"
if grep -Fq "Authority=Developer ID Application:" <<<"$signature_details"; then
  echo "Preserving the existing Developer ID signature."
  /usr/bin/codesign --verify --deep --strict --verbose=2 "$package_root/KeyHub.app"
elif [[ "${KEYHUB_REQUIRE_DEVELOPER_ID:-${OPENKEYLET_REQUIRE_DEVELOPER_ID:-0}}" == "1" ]]; then
  echo "A Developer ID signature is required for this release package." >&2
  exit 1
else
  # Apple Silicon requires a structurally signed bundle even for local builds.
  /usr/bin/codesign --force --deep --sign - "$package_root/KeyHub.app"
fi

(
  cd "$package_root"
  find . -type f ! -name SHA256SUMS.txt -print0 \
    | sort -z \
    | xargs -0 shasum -a 256 \
    > SHA256SUMS.txt
)

rm -f "$archive_path" "$checksum_path"
(
  cd "$stage_root"
  /usr/bin/ditto -c -k --sequesterRsrc --keepParent "$package_name" "$archive_path"
)
archive_hash="$(shasum -a 256 "$archive_path" | awk '{print $1}')"
printf '%s  %s\n' "$archive_hash" "$(basename "$archive_path")" > "$checksum_path"
rm -rf "$stage_root"

ls -lh "$archive_path" "$checksum_path"
