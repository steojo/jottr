#!/bin/sh
# Builds Jottr.app from this checkout and replaces the copy in /Applications.
set -e
cd "$(dirname "$0")/.."

npx tauri build --bundles app

app=/Applications/Jottr.app
binary="$app/Contents/MacOS/jottr"

# Quit gracefully so pending saves finish, and wait for it to exit so `open` starts the new build.
if pgrep -qf "$binary"; then
  osascript -e 'quit app "Jottr"'
  for _ in $(seq 50); do
    pgrep -qf "$binary" || break
    sleep 0.2
  done
  if pgrep -qf "$binary"; then
    echo "Jottr didn't quit. Quit it and run this again." >&2
    exit 1
  fi
fi

rm -rf "$app"
cp -R src-tauri/target/release/bundle/macos/Jottr.app /Applications/
open "$app"
echo "Installed $(git rev-parse --short HEAD) ($(git branch --show-current)) to $app"
