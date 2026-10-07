#!/usr/bin/env bash
# Ensure apps/api/.env is a symlink to the repo-root .env (single source of truth).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_ENV="$ROOT/apps/api/.env"
ROOT_ENV="$ROOT/.env"

if [[ ! -f "$ROOT_ENV" ]]; then
  echo "Missing $ROOT_ENV — copy from .env.example first: cp .env.example .env"
  exit 1
fi

if [[ -L "$API_ENV" ]]; then
  target="$(readlink "$API_ENV")"
  if [[ "$target" == "../../.env" || "$target" == "$ROOT_ENV" ]]; then
    echo "OK: apps/api/.env already links to root .env"
    exit 0
  fi
fi

if [[ -e "$API_ENV" && ! -L "$API_ENV" ]]; then
  echo "Found a real file at apps/api/.env (not a symlink)."
  echo "To avoid two sources of truth, backing it up to apps/api/.env.backup.$(date +%s)"
  mv "$API_ENV" "$API_ENV.backup.$(date +%s)"
fi

ln -sfn ../../.env "$API_ENV"
echo "Linked apps/api/.env -> ../../.env"
echo "Edit ONLY the root .env going forward."
