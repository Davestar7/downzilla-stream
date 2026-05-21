#!/bin/bash

set -e  # Exit on any error

echo "📁 Creating operation directory..."
mkdir -p /app/operation

echo "⬇️ Downloading yt-dlp..."
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
  -o /app/operation/yt-dlp
chmod +x /app/operation/yt-dlp
echo "✅ yt-dlp ready: $(/app/operation/yt-dlp --version)"

echo "⬇️ Downloading ffmpeg..."
curl -L https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz \
  -o /tmp/ffmpeg.tar.xz
tar -xf /tmp/ffmpeg.tar.xz --wildcards '*/ffmpeg' --strip-components=1 -C /tmp
mv /tmp/ffmpeg /app/operation/ffmpeg
chmod +x /app/operation/ffmpeg
rm /tmp/ffmpeg.tar.xz
echo "✅ ffmpeg ready"

echo "🎉 All binaries installed"