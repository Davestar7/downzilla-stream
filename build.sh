#!/bin/bash

echo "Starting build..."

# Create operation directory
mkdir -p /app/operation

# Download latest yt-dlp binary
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /app/operation/yt-dlp

# Make it executable
chmod a+rx /app/operation/yt-dlp

# Install npm dependencies
npm install

# Verify installations
echo "Python version: $(python3 --version)"
echo "yt-dlp version: $(/app/operation/yt-dlp --version)"
echo "ffmpeg version: $(ffmpeg -version | head -n 1)"
echo "node version: $(node --version)"

echo "Build complete!"