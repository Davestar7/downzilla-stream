#!/bin/bash

echo "Starting build..."
set -e  # stop immediately if any step fails, so Build Logs show the real error

NODE_PATH=$(which node)
if [ ! -f /usr/local/bin/node ]; then ln -s $NODE_PATH /usr/local/bin/node; fi
if [ ! -f /usr/bin/node ]; then ln -s $NODE_PATH /usr/bin/node; fi

apt-get update && apt-get install -y python3 python3-pip ffmpeg git

mkdir -p /app/operation
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /app/operation/yt-dlp
chmod a+rx /app/operation/yt-dlp

# Clone and build the ORIGINAL TypeScript bgutil server (Node-based, no glibc issues)
rm -rf /app/bgutil
git clone --depth 1 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /app/bgutil
cd /app/bgutil/server
npm ci
npx tsc

echo "Checking bgutil build output:"
ls -la /app/bgutil/server/build/

cd /app
npm install

echo "yt-dlp version: $(/app/operation/yt-dlp --version)"
echo "Build complete!"
