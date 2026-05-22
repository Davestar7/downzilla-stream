#!/bin/bash

set -e  # Exit on any error

echo "📁 Creating operation directory..."
mkdir -p /app/operation

echo "⬇️ Downloading yt-dlp..."
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
  -o /app/operation/yt-dlp
chmod +x /app/operation/yt-dlp
echo "✅ yt-dlp ready: $(/app/operation/yt-dlp --version)"

echo "⬇️ Downloading ffmpeg..."
curl -L https://github.com/eugeneware/ffmpeg-static/releases/latest/download/ffmpeg-linux-x64 \
  -o /app/operation/ffmpeg
chmod +x /app/operation/ffmpeg
echo "✅ ffmpeg ready"

echo "🎉 All binaries installed"