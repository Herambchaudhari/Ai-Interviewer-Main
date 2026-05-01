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

# Railway injects $PORT at runtime; shell form expands it. Falls back to 8000 locally.
EXPOSE ${PORT:-8000}

# Health check uses same dynamic port
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD python -c "import os,urllib.request; urllib.request.urlopen(f'http://localhost:{os.environ.get(\"PORT\",8000)}/health')" || exit 1

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
