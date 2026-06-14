#!/bin/bash

echo "Starting build..."

apt-get update && apt-get install -y python3 ffmpeg

mkdir -p /app/operation
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /app/operation/yt-dlp
chmod a+rx /app/operation/yt-dlp

npm install

echo "yt-dlp version: $(/app/operation/yt-dlp --version)"
echo "node version: $(node --version)"
echo "Build complete!"
