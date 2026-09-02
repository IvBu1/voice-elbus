from datetime import datetime
from pathlib import Path
import shutil
import tempfile
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

from backend.elbus import append_voice_note, get_experiment_title
from backend.transcription import transcribe_audio

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"


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
        tmp_path = None

        try:
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp_file:
                shutil.copyfileobj(file.file, tmp_file)
                tmp_path = Path(tmp_file.name)
                transcript = transcribe_audio(tmp_path)
                return {"text": transcript}
        except Exception as exc:
            print("\n--- TRANSCRIPTION ERROR ---")
            traceback.print_exc()
            print("---------------------------\n")
            raise HTTPException(status_code=500, detail=(f"Transcription failed: {exc}"))
        finally:
            if tmp_path is not None:
                tmp_path.unlink(missing_ok=True)


    # web operation for appending text to ELBUS
    @app.post("/append")
    def append(request: AppendRequest):
        try:
            append_voice_note(request.experiment_id, request.text)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=(f"ELBUS request failed: {exc}"))
        return {"ok": True}

    # web operation for fetching experiment info from ELBUS
    @app.get("/experiment/{experiment_id}")
    def experiment_info(experiment_id: int):
        try:
            title = get_experiment_title(experiment_id)

        except Exception as exc:
            raise HTTPException(status_code=500, detail=(f"Could not read experiment: {exc}"))

        return {"experiment_id": experiment_id, "title": title}

    # web operation for fetching logo
    @app.get("/favicon.ico", include_in_schema=False)
    def favicon():
        return FileResponse(STATIC_DIR / "logo" / "favicon.ico")

    # web operation for checkong on FastAPI
    @app.get("/health")
    def health():
        return {"status": "ok"}


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
