#!/usr/bin/env bash
# Run by T3 Code (t3.json "Setup Worktree") right after it creates a worktree for a new thread.
# Links the main checkout's gitignored local files into the worktree, clones main's Rust build, then installs dependencies.
set -euo pipefail

root="${T3CODE_PROJECT_ROOT:?T3CODE_PROJECT_ROOT is not set - run this through T3 Code}"
worktree="${T3CODE_WORKTREE_PATH:-$PWD}"
cd "$worktree"

# Clicked from the scripts menu in the main checkout: nothing to set up, and `npm ci` would wipe node_modules.
if [ "$(cd "$root" && pwd -P)" = "$(pwd -P)" ]; then
  echo "This is the main checkout, not a worktree - nothing to do."
  exit 0
fi

# Symlinks, not copies, so a change in the main checkout reaches every worktree.
for file in references; do
  [ -e "$root/$file" ] || continue
  # A real file or folder here is worktree-specific config; a rerun must not replace it.
  if [ -e "$file" ] && [ ! -L "$file" ]; then
    echo "Kept existing $file"
    continue
  fi
  mkdir -p "$(dirname "$file")"
  ln -sfn "$root/$file" "$file"
  echo "Linked $file"
done

# Copy-on-write clone (APFS clonefile): no extra disk until files change. Skipped if the worktree already has one.
clone() {
  if [ ! -d "$root/$1" ] || [ -e "$1" ]; then return 0; fi
  echo "Cloning $1"
  mkdir -p "$(dirname "$1")"
  cp -cR "$root/$1" "$1" || { rm -rf "$1"; echo "Warning: couldn't clone $1, so the first build starts from scratch"; }
}

# Main's debug build, so `npm run tauri dev` only recompiles Jottr itself, not every dependency.
clone src-tauri/target/debug

# T3 Code may run this without your shell profile; fall back to nvm's default Node.
if ! command -v npm >/dev/null; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # --no-use: sourcing nvm.sh otherwise runs its own `nvm use`, which can abort under set -e.
  . "$NVM_DIR/nvm.sh" --no-use
  nvm use default
fi

npm ci --prefer-offline --no-audit --no-fund
