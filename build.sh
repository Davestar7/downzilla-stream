#!/bin/bash

echo "Starting build..."

# Find where node is and symlink it to a standard path
NODE_PATH=$(which node)
echo "node found at: $NODE_PATH"

# Symlink to /usr/local/bin if not already there
if [ ! -f /usr/local/bin/node ]; then
    ln -s $NODE_PATH /usr/local/bin/node
fi

# Install ffmpeg
apt-get update && apt-get install -y ffmpeg

# Download latest yt-dlp binary
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /app/operation/yt-dlp
chmod a+rx /app/operation/yt-dlp

npm install

echo "node path: $(which node)"
echo "yt-dlp version: $(/app/operation/yt-dlp --version)"
echo "Build complete!"
