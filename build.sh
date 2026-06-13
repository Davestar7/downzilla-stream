#!/bin/bash

echo "Starting build..."

NODE_PATH=$(which node)
echo "node found at: $NODE_PATH"

if [ ! -f /usr/local/bin/node ]; then
    ln -s $NODE_PATH /usr/local/bin/node
fi

if [ ! -f /usr/bin/node ]; then
    ln -s $NODE_PATH /usr/bin/node
fi

apt-get update && apt-get install -y python3 ffmpeg

mkdir -p /app/operation
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /app/operation/yt-dlp
chmod a+rx /app/operation/yt-dlp

npm install

echo "node path: $(which node)"
echo "node version: $(node --version)"
echo "yt-dlp version: $(/app/operation/yt-dlp --version)"
echo "Build complete!"
