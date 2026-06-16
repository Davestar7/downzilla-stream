#!/bin/bash

echo "Starting build..."

NODE_PATH=$(which node)

if [ ! -f /usr/local/bin/node ]; then
    ln -s $NODE_PATH /usr/local/bin/node
fi

if [ ! -f /usr/bin/node ]; then
    ln -s $NODE_PATH /usr/bin/node
fi

apt-get update && apt-get install -y python3 python3-pip ffmpeg git

# Install yt-dlp
mkdir -p /app/operation
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /app/operation/yt-dlp
chmod a+rx /app/operation/yt-dlp

# Install bgutil PO token provider plugin for yt-dlp
pip3 install bgutil-ytdlp-pot-provider --break-system-packages

# Clone bgutil and build
rm -rf /app/bgutil
git clone https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /app/bgutil
cd /app/bgutil/server
npm ci
node_modules/.bin/tsc

# Verify
if [ -f "/app/bgutil/server/build/main.js" ]; then
    echo "bgutil build success"
else
    echo "bgutil build FAILED - trying alternative"
    # Try direct node run of ts files as fallback
    npm install ts-node
fi

ls -la /app/bgutil/server/build/ 2>/dev/null || echo "build dir not found"

cd /app
npm install

echo "yt-dlp version: $(/app/operation/yt-dlp --version)"
echo "node version: $(node --version)"
echo "Build complete!"
