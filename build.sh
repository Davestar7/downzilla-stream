#!/bin/bash

set -e  # Exit on any error

echo "📁 Creating operation directory..."
mkdir -p /app/operation

apt-get install -y python3

echo "⬇️ Downloading yt-dlp..."
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /app/operation/yt-dlp

# Make it executable
chmod a+rx /app/operation/yt-dlp

echo "✅ yt-dlp ready: $(/app/operation/yt-dlp --version)"

echo "⬇️ Downloading ffmpeg..."
curl -L https://github.com/eugeneware/ffmpeg-static/releases/latest/download/ffmpeg-linux-x64 \
  -o /app/operation/ffmpeg
chmod +x /app/operation/ffmpeg
echo "✅ ffmpeg ready"

echo "🎉 All binaries installed"