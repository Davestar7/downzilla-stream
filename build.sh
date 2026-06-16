#!/bin/bash

echo "Starting build..."

NODE_PATH=$(which node)
if [ ! -f /usr/local/bin/node ]; then ln -s $NODE_PATH /usr/local/bin/node; fi
if [ ! -f /usr/bin/node ]; then ln -s $NODE_PATH /usr/bin/node; fi

apt-get update && apt-get install -y python3 python3-pip ffmpeg

# Install yt-dlp
mkdir -p /app/operation
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /app/operation/yt-dlp
chmod a+rx /app/operation/yt-dlp

# Install bgutil pip plugin for yt-dlp
pip3 install bgutil-ytdlp-pot-provider --break-system-packages

# Download bgutil-pot Rust binary (no build needed)
curl -L https://github.com/jim60105/bgutil-ytdlp-pot-provider-rs/releases/latest/download/bgutil-pot-x86_64-unknown-linux-musl.tar.gz -o /tmp/bgutil.tar.gz
tar -xzf /tmp/bgutil.tar.gz -C /app/operation/
chmod +x /app/operation/bgutil-pot

npm install

echo "yt-dlp version: $(/app/operation/yt-dlp --version)"
echo "bgutil-pot: $(/app/operation/bgutil-pot --version 2>/dev/null || echo 'installed')"
echo "node version: $(node --version)"
echo "Build complete!"
