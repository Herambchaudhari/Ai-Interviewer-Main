FROM python:3.11-slim

WORKDIR /app

# Install system deps for pdfplumber + faster-whisper
RUN apt-get update && apt-get install -y \
    libpoppler-cpp-dev \
    poppler-utils \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Make startup script executable
RUN chmod +x start.sh

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD python -c "import os,urllib.request; urllib.request.urlopen(f'http://localhost:{os.environ.get(\"PORT\",8000)}/health')" || exit 1

# start.sh is a shell script — PORT always expands correctly regardless
# of how Railway invokes the entrypoint (exec vs shell form debate is moot).
CMD ["./start.sh"]
