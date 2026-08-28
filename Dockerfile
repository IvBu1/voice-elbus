FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .
COPY api.py .
COPY elbus.py .
COPY transcription.py .
COPY static ./static

RUN mkdir -p /app/recordings

EXPOSE 8000

CMD ["python3", "main.py"]
