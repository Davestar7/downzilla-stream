#!/bin/bash

echo "Starting build..."

# Install Python and ffmpeg
apt-get update && apt-get install -y python3 python3-pip ffmpeg

# Create operation directory
mkdir -p /app/operation

# Download latest yt-dlp binary to /app/operation
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /app/operation/yt-dlp

# Make it executable
chmod a+rx /app/operation/yt-dlp

# Install npm dependencies
npm install

# Verify installations
echo "yt-dlp version: $(/app/operation/yt-dlp --version)"
echo "ffmpeg version: $(ffmpeg -version | head -n 1)"
echo "node version: $(node --version)"

echo "Build complete!"