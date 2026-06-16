#!/bin/bash

echo "Starting build..."

apt-get update && apt-get install -y python3 ffmpeg

mkdir -p /app/operation
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /app/operation/yt-dlp
chmod a+rx /app/operation/yt-dlp

# Install PO Token provider plugin for YouTube SABR bypass
pip3 install bgutil-ytdlp-pot-provider --break-system-packages

# Install bgutil server
npm install -g @imputnet/bgutil-ytdlp-pot-provider

npm install

echo "yt-dlp version: $(/app/operation/yt-dlp --version)"
echo "node version: $(node --version)"
echo "Build complete!"
