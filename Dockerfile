FROM node:20-bullseye-slim

# System deps: python3 + ffmpeg
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 ffmpeg curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install node deps first (better layer caching)
COPY package*.json ./
RUN npm install

# Copy rest of app
COPY . .

# Download yt-dlp binary
RUN mkdir -p /app/operation && \
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /app/operation/yt-dlp && \
    chmod a+rx /app/operation/yt-dlp

# Verify (optional, shows in build logs)
RUN echo "Python: $(python3 --version)" && \
    echo "yt-dlp: $(/app/operation/yt-dlp --version)" && \
    echo "ffmpeg: $(ffmpeg -version | head -n1)" && \
    echo "node: $(node --version)"

EXPOSE 3000
CMD ["node", "stream.mjs"]