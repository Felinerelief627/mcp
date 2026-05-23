#!/usr/bin/env bash
# Build wireboard-mcp-<version>.mcpb from the source tree.
#
# One file, all platforms. Claude Desktop ships Node, so the bundle is just
# the esbuild-bundled JS + manifest + icon.
#
# Output: dist/wireboard-mcp-<version>.mcpb
#
# Requires: node, npm, zip.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

VERSION="$(node -p "require('./package.json').version")"
MANIFEST_VERSION="$(node -p "require('./mcpb/manifest.json').version")"

if [[ "$VERSION" != "$MANIFEST_VERSION" ]]; then
    echo "[build-mcpb] ERROR: version mismatch" >&2
    echo "  package.json:       $VERSION" >&2
    echo "  mcpb/manifest.json: $MANIFEST_VERSION" >&2
    exit 1
fi

BUILD_DIR="dist/mcpb-build"
OUTPUT="dist/wireboard-mcp-${VERSION}.mcpb"

echo "[build-mcpb] Building wireboard-mcp ${VERSION}"

# Bundle TypeScript → single JS file with all deps inlined.
npm run --silent build

# Stage manifest, icon, and the bundled entry point.
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/dist"
cp mcpb/manifest.json "$BUILD_DIR/"
cp mcpb/icon.png      "$BUILD_DIR/"
cp dist/index.js      "$BUILD_DIR/dist/"

rm -f "$OUTPUT"
(cd "$BUILD_DIR" && zip -r -q "../../$OUTPUT" .)

rm -rf "$BUILD_DIR"

SIZE="$(du -h "$OUTPUT" | cut -f1)"
echo "[build-mcpb] Wrote $OUTPUT ($SIZE)"
echo ""
echo "Install locally: double-click $OUTPUT or use"
echo "Claude Desktop → Settings → Extensions → Advanced Settings → Install Extension."
