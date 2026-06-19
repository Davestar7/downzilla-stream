#!/bin/bash

echo "Starting build..."
set -e

NODE_PATH=$(which node)
if [ ! -f /usr/local/bin/node ]; then ln -s $NODE_PATH /usr/local/bin/node; fi
if [ ! -f /usr/bin/node ]; then ln -s $NODE_PATH /usr/bin/node; fi

apt-get update && apt-get install -y python3 python3-pip ffmpeg git

mkdir -p /app/operation
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /app/operation/yt-dlp
chmod a+rx /app/operation/yt-dlp

cd /app
npm install

echo "yt-dlp version: $(/app/operation/yt-dlp --version)"
echo "Build complete!"
