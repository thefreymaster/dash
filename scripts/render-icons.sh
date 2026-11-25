#!/bin/sh
# Re-render the PWA icons in public/ from the SVG sources in scripts/icons/.
# macOS only: headless Google Chrome renders each SVG at 512 px (Chrome clamps smaller
# windows, so small sizes are produced by downscaling with `sips`).
#   sh scripts/render-icons.sh            # temp Chrome profile in a fresh mktemp dir
#   ICON_TMP=/some/dir sh scripts/render-icons.sh
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
WORK="${ICON_TMP:-$(mktemp -d)}"
mkdir -p "$WORK/profile"

# render <svg> <out.png>  — 512x512 master
render() {
  "$CHROME" --headless=new --user-data-dir="$WORK/profile" --window-size=512,512 \
    --hide-scrollbars --default-background-color=00000000 --force-device-scale-factor=1 \
    --screenshot="$2" "file://$ROOT/scripts/icons/$1" >/dev/null 2>&1
}

# shrink <master.png> <size> <out.png>
shrink() {
  sips -z "$2" "$2" "$1" --out "$3" >/dev/null
}

render icon-rounded.svg "$WORK/rounded-512.png"
render icon-fullbleed.svg "$WORK/fullbleed-512.png"

cp "$WORK/rounded-512.png" "$ROOT/public/pwa-512.png"
shrink "$WORK/rounded-512.png" 192 "$ROOT/public/pwa-192.png"
shrink "$WORK/rounded-512.png" 64 "$ROOT/public/favicon.png"
cp "$WORK/fullbleed-512.png" "$ROOT/public/pwa-maskable-512.png"
shrink "$WORK/fullbleed-512.png" 180 "$ROOT/public/apple-touch-icon.png"

ls -l "$ROOT"/public/*.png
