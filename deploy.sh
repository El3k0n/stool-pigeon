#!/usr/bin/env bash
# Publish to the VPS. Usage: ./deploy.sh
# Copies only the public files into /var/www/dilemma (served at donotpissmeoff.com/dilemma/);
# anything else there is removed. The Caddy route lives in the main site's repo, see deploy/README.md.
set -euo pipefail

HOST="${DEPLOY_HOST:-vex-vps}"   # SSH alias from ~/.ssh/config
DEST="/var/www/dilemma/"

cd "$(dirname "$0")"

# Never ship a broken engine.
node --test tests/*.test.js > /dev/null || { echo "Tests failed: not deploying." >&2; exit 1; }

rsync -rlptz --delete --delete-excluded \
  --exclude='.DS_Store' \
  --include='/index.html' \
  --include='/css/***' \
  --include='/js/***' \
  --include='/assets/***' \
  --exclude='*' \
  ./ "$HOST:$DEST"

echo "Deployed to $HOST:$DEST"
