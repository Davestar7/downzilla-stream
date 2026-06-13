#!/bin/bash

echo "Starting build..."

# Install Python and ffmpeg
apt-get update && apt-get install -y python3 python3-pip ffmpeg

# Download latest yt-dlp binary
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
chmod a+rx /usr/local/bin/yt-dlp

# Install npm dependencies
npm install

# Verify installations
echo "yt-dlp version: $(yt-dlp --version)"
echo "ffmpeg version: $(ffmpeg -version | head -n 1)"
echo "node version: $(node --version)"

echo "Build complete!"
