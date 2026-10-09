import os
import secrets
import shutil
import tempfile
import traceback
from datetime import datetime, timedelta, timezone
from dataclasses import dataclass, field
from pathlib import Path
from threading import Lock
from uuid import UUID
from pydantic import BaseModel

from fastapi import FastAPI, File, HTTPException, UploadFile, Cookie, Depends, Response, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from backend.elbus import (
    AUDIO_EXTENSIONS, VoiceNote, append_voice_note,
    get_experiment_title, get_experiments, validate_api_key,
)
from backend.transcription import transcribe_audio

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "false").strip().lower() == "true"

@dataclass
class Session:
    api_key: str
    expires_at: datetime
    notes: dict[str, VoiceNote] = field(default_factory=dict)
    notes_lock: Lock = field(default_factory=Lock)

sessions: dict[str, Session] = {}

class LoginRequest(BaseModel):
    api_key: str

class AppendRequest(BaseModel):
    experiment_id: int
    text: str

class VoiceNoteRequest(AppendRequest):
    submission_id: UUID
    audio_type: str | None = None

MAX_ATTACHMENT_BYTES = 50_000_000

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

def current_session(voice_elbus_session: str | None = Cookie(default=None)) -> Session:
    get_api_key_from_session(voice_elbus_session)
    return sessions[voice_elbus_session]


def create_app():
    app = FastAPI()
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


    # web operation for displaying the website
    @app.get("/")
    def index():
        return FileResponse(STATIC_DIR / "index.html")


    # web operation for transcribing; we do not use api_key here but depending on it protects this function from being called if there is no valid session
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


    @app.post("/voice-notes")
    def save_voice_note(request: VoiceNoteRequest,
                        session: Session = Depends(current_session)):
        if request.experiment_id <= 0 or not request.text.strip():
            raise HTTPException(status_code=400, detail="Select an experiment and enter a transcript.")
        if request.audio_type is not None and request.audio_type not in AUDIO_EXTENSIONS:
            raise HTTPException(status_code=400, detail="Unsupported audio format.")
        submission_id = str(request.submission_id)
        with session.notes_lock:
            note = session.notes.get(submission_id)
            if note is None:
                note = VoiceNote(request.experiment_id, request.text, request.audio_type,
                                 submission_id=request.submission_id)
                session.notes[submission_id] = note
            elif (note.experiment_id, note.text, note.audio_type) != (
                    request.experiment_id, request.text, request.audio_type):
                raise HTTPException(status_code=409, detail="A retry must use the original note and destination.")
        try:
            note.save_transcript(session.api_key)
        except Exception:
            # Keep progress so retrying the same submission can reconcile a lost response.
            raise HTTPException(status_code=502, detail="Could not confirm the transcript was saved. Retry this submission.")
        return {"ok": True, **note.progress()}

    @app.post("/voice-notes/{submission_id}/audio")
    async def save_voice_note_audio(submission_id: UUID, request: Request,
                                    session: Session = Depends(current_session)):
        note = session.notes.get(str(submission_id))
        if note is None:
            raise HTTPException(status_code=404, detail="Voice note submission not found in this session.")
        if not note.transcript_saved or note.audio_type is None:
            raise HTTPException(status_code=409, detail="Save the transcript with audio enabled first.")
        media_type = request.headers.get("content-type", "").split(";")[0].strip().lower()
        if media_type != note.audio_type:
            raise HTTPException(status_code=400, detail="Audio format does not match this submission.")
        # Receive raw audio in bounded memory, avoiding multipart temporary files.
        audio = bytearray()
        async for chunk in request.stream():
            if len(audio) + len(chunk) > MAX_ATTACHMENT_BYTES:
                raise HTTPException(status_code=413, detail="Audio attachments must be no larger than 50 MB.")
            audio.extend(chunk)
        if not audio:
            raise HTTPException(status_code=400, detail="The audio recording is empty.")
        try:
            await run_in_threadpool(note.save_audio, bytes(audio), session.api_key)
        except Exception:
            raise HTTPException(status_code=502, detail="The transcript is saved, but the audio upload could not be confirmed. Retry the audio upload.")
        return {"ok": True, **note.progress()}

    @app.get("/experiments")
    def experiments(api_key: str = Depends(current_api_key)):
        try:
            return {"experiments": get_experiments(api_key)}
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Could not load experiments: {exc}")


    # web operation for fetching experiment info from ELBUS
    @app.get("/experiment/{experiment_id}")
    def experiment_info(experiment_id: int,
                        api_key: str = Depends(current_api_key)):
        try:
            title = get_experiment_title(experiment_id, api_key)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=(f"Could not read experiment: {exc}")) # error code: internal server error

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
            raise HTTPException(status_code=400, detail="API key is required.") # error code: bad request

        try:
            valid = validate_api_key(api_key)
        except RuntimeError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) # error code: bad gateway

        if not valid:
            raise HTTPException(status_code=401, detail="Invalid ELBUS API key.") # error code: not authorized

        session_id = secrets.token_urlsafe(32)
        sessions[session_id] = Session(api_key=api_key, expires_at=(datetime.now(timezone.utc) + timedelta(hours=2)))

        response.set_cookie(
            key="voice_elbus_session",
            value=session_id,
            httponly=True,
            secure=COOKIE_SECURE,
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
        response.delete_cookie("voice_elbus_session", secure=COOKIE_SECURE, httponly=True, samesite="lax")

        return {"ok": True}


    @app.get("/auth/status")
    def auth_status(voice_elbus_session: str | None = Cookie(default=None)):
        try:
            get_api_key_from_session(voice_elbus_session)
        except HTTPException as exc:
            return {"authenticated": False, "reason": exc.detail}

        return {"authenticated": True}


    # web operation for checkong on FastAPI
    @app.get("/health")
    def health():
        return {"status": "ok"}


    return app
