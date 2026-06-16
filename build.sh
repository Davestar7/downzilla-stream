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

apt-get update && apt-get install -y python3 python3-pip ffmpeg

# Install yt-dlp
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /app/operation/yt-dlp
chmod a+rx /app/operation/yt-dlp

# Install bgutil PO token provider plugin for yt-dlp
pip3 install bgutil-ytdlp-pot-provider --break-system-packages

# Clone and build bgutil server
git clone --single-branch --branch 1.3.1 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /app/bgutil
cd /app/bgutil/server
npm ci
npx tsc

npm install

echo "yt-dlp version: $(/app/operation/yt-dlp --version)"
echo "node version: $(node --version)"
echo "Build complete!"
