from datetime import datetime
from pathlib import Path
import shutil
import traceback

from fastapi import (
    FastAPI,
    File,
    HTTPException,
    UploadFile,
)

from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from elbus import append_voice_note
from transcription import transcribe_audio

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
RECORDINGS_DIR = BASE_DIR / "recordings"
RECORDINGS_DIR.mkdir(exist_ok=True)


def create_app():

    app = FastAPI()
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    # web operation for displaying the website
    @app.get("/")
    def index():
        return FileResponse(STATIC_DIR / "index.html")

    # web operation for transcribing
    @app.post("/transcribe")
    def transcribe(file: UploadFile = File(...)):

        suffix = get_audio_suffix(file.content_type)
        timestamp = (datetime.now().strftime("%Y%m%d_%H%M%S_%f"))
        recording_path = (RECORDINGS_DIR/ f"voice_note_{timestamp}{suffix}")

        with recording_path.open("wb") as output_file:
            shutil.copyfileobj(file.file, output_file)
        try:
            transcript = transcribe_audio(recording_path)
        # except Exception as exc:
        #     raise HTTPException(status_code=500, detail=(f"Transcription failed: {exc}"))
        except Exception as exc:
            print("\n--- TRANSCRIPTION ERROR ---")
            traceback.print_exc()
            print("---------------------------\n")

            raise HTTPException(status_code=500, detail=(f"Transcription failed: {exc}"))
        return {"text": transcript, "filename": recording_path.name}


    # web operation for appending text to ELBUS
    @app.post("/append")
    def append(request: AppendRequest):
        try:
            append_voice_note(request.experiment_id, request.text)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=(f"ELBUS request failed: {exc}"))
        return {"ok": True}

    return app


class AppendRequest(BaseModel):
    experiment_id: int
    text: str


def get_audio_suffix(content_type: str | None) -> str:

    if not content_type:
        return ".audio"

    media_type = (content_type.split(";")[0].strip().lower())

    extensions = {
        "audio/webm": ".webm",
        "video/webm": ".webm",
        "audio/mp4": ".m4a",
        "video/mp4": ".mp4",
        "audio/ogg": ".ogg",
        "audio/wav": ".wav",
    }

    return extensions.get(media_type, ".audio")
