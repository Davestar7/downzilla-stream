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

# Install yt-dlp with EJS scripts
pip3 install "yt-dlp[default]" --break-system-packages

mkdir -p /app/operation

# Download yt-dlp binary
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /app/operation/yt-dlp
chmod a+rx /app/operation/yt-dlp

# Pre-download EJS challenge solver scripts during build (not at runtime)
mkdir -p /root/.cache/yt-dlp
/app/operation/yt-dlp --update-to nightly 2>/dev/null || true
/app/operation/yt-dlp --remote-components ejs:github -j --skip-download "https://www.youtube.com/watch?v=jNQXAC9IVRw" 2>/dev/null || true

npm install

echo "node version: $(node --version)"
echo "yt-dlp version: $(/app/operation/yt-dlp --version)"
echo "Build complete!"
