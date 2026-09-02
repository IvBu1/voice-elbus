import secrets
from datetime import datetime, timedelta, timezone
from dataclasses import dataclass
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
from fastapi import Cookie, Depends
from fastapi import Response
from pydantic import BaseModel

from backend.elbus import append_voice_note, get_experiment_title, validate_api_key
from backend.transcription import transcribe_audio

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"

@dataclass
class Session:
    api_key: str
    expires_at: datetime

sessions: dict[str, Session] = {}

class LoginRequest(BaseModel):
    api_key: str

def create_app():

    app = FastAPI()
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    # web operation for displaying the website
    @app.get("/")
    def index():
        return FileResponse(STATIC_DIR / "index.html")


    # web operation for transcribing; we do not use api_key here but this protects this function from being called if there is no valid session
    @app.post("/transcribe")
    def transcribe(file: UploadFile = File(...),
                   _api_key: str = Depends(current_api_key)):
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
    def append(request: AppendRequest,
               api_key: str = Depends(current_api_key)):
        try:
            append_voice_note(request.experiment_id, request.text, api_key)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=(f"ELBUS request failed: {exc}"))
        return {"ok": True}


    # web operation for fetching experiment info from ELBUS
    @app.get("/experiment/{experiment_id}")
    def experiment_info(experiment_id: int,
                        api_key: str = Depends(current_api_key)):
        try:
            title = get_experiment_title(experiment_id, api_key)

        except Exception as exc:
            raise HTTPException(status_code=500, detail=(f"Could not read experiment: {exc}"))

        return {"experiment_id": experiment_id, "title": title}


    # web operation for fetching logo
    @app.get("/favicon.ico", include_in_schema=False)
    def favicon():
        return FileResponse(STATIC_DIR / "logo" / "favicon.ico")


    @app.post("/auth/login")
    def login(request: LoginRequest,
              response: Response):
        api_key = request.api_key.strip()

        if not api_key:
            raise HTTPException(status_code=400, detail="API key is required.")

        try:
            valid = validate_api_key(api_key)
        except RuntimeError as exc:
            raise HTTPException(status_code=502, detail=str(exc))

        if not valid:
            raise HTTPException(status_code=401, detail="Invalid ELBUS API key.")

        session_id = secrets.token_urlsafe(32)
        sessions[session_id] = Session(api_key=api_key, expires_at=(datetime.now(timezone.utc) + timedelta(hours=2)))

        response.set_cookie(
            key="voice_elbus_session",
            value=session_id,
            httponly=True,
            secure=False, # TODO: change to `TRUE` when using HTTPS protocol
            samesite="lax"
        )

        return {
            "ok": True
        }


    @app.post("/auth/logout")
    def logout(response: Response,
               voice_elbus_session: str | None = Cookie(default=None)):
        if voice_elbus_session:
            sessions.pop(voice_elbus_session, None)
        response.delete_cookie("voice_elbus_session")

        return {"ok": True}


    @app.get("/auth/status")
    def auth_status(voice_elbus_session: str | None = Cookie(default=None)):
        try:
            get_api_key_from_session(voice_elbus_session)
        except HTTPException:
            return {"authenticated": False}

        return {"authenticated": True}


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


def get_api_key_from_session(session_id: str | None) -> str:
    if session_id is None:
        raise HTTPException(status_code=401, detail="Not authenticated.")

    session = sessions.get(session_id)

    if session is None:
        raise HTTPException(status_code=401, detail="Session expired.")

    if (session.expires_at < datetime.now(timezone.utc)):
        sessions.pop(session_id, None)
        raise HTTPException(status_code=401, detail="Session expired.")

    return session.api_key


def current_api_key(voice_elbus_session: str | None = Cookie(default=None)) -> str:
    return get_api_key_from_session(voice_elbus_session)
