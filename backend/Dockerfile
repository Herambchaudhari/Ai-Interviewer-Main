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

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD python -c "import os,urllib.request; urllib.request.urlopen(f'http://localhost:{os.environ.get(\"PORT\",8000)}/health')" || exit 1

# Python reads PORT from env and passes it to uvicorn — no shell expansion
# needed, no CRLF line-ending issues from Windows-authored shell scripts.
CMD ["python", "-c", "import os,subprocess,sys; port=os.environ.get('PORT','8000'); sys.exit(subprocess.run(['uvicorn','main:app','--host','0.0.0.0','--port',port]).returncode)"]
