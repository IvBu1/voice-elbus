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

ARG APP_VERSION=development
ARG APP_REVISION=
ARG APP_REPOSITORY_URL=
ENV APP_VERSION=${APP_VERSION} \
    APP_REVISION=${APP_REVISION} \
    APP_REPOSITORY_URL=${APP_REPOSITORY_URL}

EXPOSE 8000

CMD ["python3", "main.py"]
