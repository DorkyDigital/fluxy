#!/bin/bash
set -e

echo "pulling latest changes"
git pull

echo "installing dependencies part 1"
pnpm i --frozen-lockfile

echo "Building part 1"
pnpm run build:clean

echo "installing dependencies part 2"
cd dashboard/
pnpm i --frozen-lockfile

echo "Building part 2"
pnpm run build
cd ..

echo "restarting"
pm2 delete fluxer-mod-bot 2>/dev/null || true
pnpm run pm2:start

echo "deploy complete"
echo ""
echo "Run 'pm2 monit' to monitor."
