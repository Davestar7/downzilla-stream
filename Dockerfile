FROM node:20-bookworm

# Install system deps (python3, pip, ffmpeg, git, curl)
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Download yt-dlp standalone binary
RUN mkdir -p /app/operation && \
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /app/operation/yt-dlp && \
    chmod a+rx /app/operation/yt-dlp

# Install node deps (copy package files first for layer caching)
COPY package*.json ./
RUN npm install

# Copy rest of the app
COPY . .

RUN /app/operation/yt-dlp --version

EXPOSE 3000

CMD ["node", "index.js"]
