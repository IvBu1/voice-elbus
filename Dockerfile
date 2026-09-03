FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# download and store the Whisper model in the image
RUN python3 -c "import whisper; whisper.load_model('base')"

COPY main.py .
COPY backend ./backend
COPY static ./static

EXPOSE 8000

CMD ["python3", "main.py"]
