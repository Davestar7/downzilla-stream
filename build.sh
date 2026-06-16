#!/bin/bash

echo "Starting build..."

echo "Build timestamp: $(date)"

NODE_PATH=$(which node)
if [ ! -f /usr/local/bin/node ]; then ln -s $NODE_PATH /usr/local/bin/node; fi
if [ ! -f /usr/bin/node ]; then ln -s $NODE_PATH /usr/bin/node; fi

# Install dependencies including libssl3 for bgutil binary
apt-get update && apt-get install -y python3 python3-pip ffmpeg libssl3 libssl-dev

# Install bgutil pip plugin
pip3 install bgutil-ytdlp-pot-provider --break-system-packages

# Install yt-dlp
mkdir -p /app/operation
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /app/operation/yt-dlp
chmod a+rx /app/operation/yt-dlp

npm install

echo "yt-dlp version: $(/app/operation/yt-dlp --version)"
echo "node version: $(node --version)"
echo "Build complete!"
