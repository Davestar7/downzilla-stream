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

# Add a build arg that changes each time you want a fresh yt-dlp binary
ARG YTDLP_CACHE_BUST=1

RUN mkdir -p /app/operation && \
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /app/operation/yt-dlp && \
    chmod a+rx /app/operation/yt-dlp
# Install node deps (copy package files first for layer caching)
COPY package*.json ./
RUN npm install

#ytdlp plugin assiant
RUN pip3 install --break-system-packages yt-dlp-invidious

# Copy rest of the app
COPY . .

RUN /app/operation/yt-dlp --version

EXPOSE 3000

CMD ["node", "stream.mjs"]
