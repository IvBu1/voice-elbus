import requests
from dataclasses import dataclass, field
from datetime import datetime
from threading import Lock
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo
from html import escape, unescape

BASE_URL = "https://elbustest.uni-stuttgart.de/api/v2"
VOICE_NOTE_TIMESTAMP_FORMAT = "%Y-%m-%d %H:%M"
REQUEST_TIMEOUT = (5, 15) # first number refers to connection timeout, second to data timeout

AUDIO_EXTENSIONS = {
    "audio/webm": ".webm", "video/webm": ".webm",
    "audio/mp4": ".m4a", "video/mp4": ".mp4",
    "audio/ogg": ".ogg", "audio/wav": ".wav",
    "audio/mpeg": ".mp3", "application/octet-stream": ".audio",
}


def get_headers(api_key: str) -> dict:
    return {
        "Authorization": api_key,
        "Content-Type": "application/json"
    }


def get_experiments(api_key: str) -> list[dict]:
    """Read every page of experiments visible to the API key's user."""
    experiments = {}
    offset = 0
    try:
        while True:
            response = requests.get(
                f"{BASE_URL}/experiments",
                headers=get_headers(api_key),
                params={"scope": 3, "limit": 100, "offset": offset,
                        "order": "id", "sort": "asc"},
                timeout=REQUEST_TIMEOUT,
            )
            response.raise_for_status()
            page = response.json()
            if not isinstance(page, list):
                raise RuntimeError("ELBUS returned an invalid experiment list.")
            if not page:
                break
            for experiment in page:
                experiment_id = int(experiment["id"])
                experiments[experiment_id] = {
                    "id": experiment_id,
                    "title": experiment["title"],
                    "fullname": experiment.get("fullname") or "",
                }
            offset += len(page)
    except requests.exceptions.Timeout:
        raise RuntimeError("ELBUS request timed out.")
    except requests.exceptions.ConnectionError:
        raise RuntimeError("ELBUS cannot be reached from this network.")
    return list(experiments.values())


def format_voice_note_timestamp(created_at: datetime) -> str:
    return created_at.strftime(VOICE_NOTE_TIMESTAMP_FORMAT)


def format_voice_note(transcript: str, created_at: datetime | None = None,
                      audio_filename: str | None = None,
                      submission_id: UUID | None = None) -> str:
    created_at = created_at or datetime.now(ZoneInfo("Europe/Berlin"))
    timestamp = format_voice_note_timestamp(created_at)
    # Text-only notes need an invisible identifier for lost-response reconciliation.
    retry_marker = (f"<!-- voice-note-id{submission_id} -->"
                    if submission_id is not None and not audio_filename else "")
    audio_reference = (f"<br><small>Original audio: {escape(audio_filename)}</small>"
                       if audio_filename else "")
    formatted_transcript = f"""
    {retry_marker}<p>
        <strong>Voice note — {timestamp}</strong><br>
        {transcript}{audio_reference}
    </p>
    """
    return formatted_transcript


def append_voice_note(experiment_id: int,
					  transcript: str,
					  api_key: str,
                      created_at: datetime | None = None,
                      audio_filename: str | None = None,
                      submission_id: UUID | None = None):
	url = f"{BASE_URL}/experiments/{experiment_id}"
	safe_transcript = escape(transcript)

	try:
		response = requests.patch(
		    url,
		    headers=get_headers(api_key),
		    json={"bodyappend": format_voice_note(safe_transcript, created_at, audio_filename, submission_id)},
		    timeout=REQUEST_TIMEOUT
		)
		response.raise_for_status()
	except requests.exceptions.Timeout:
		raise RuntimeError("ELBUS request timed out.")
	except requests.exceptions.ConnectionError:
		raise RuntimeError("ELBUS cannot be reached from this network.")


def get_experiment_title(experiment_id: int,
						 api_key: str) -> str:
	url = f"{BASE_URL}/experiments/{experiment_id}"

	try:
		response = requests.get(
			url, 
			headers=get_headers(api_key),
			timeout=REQUEST_TIMEOUT
		)
		response.raise_for_status()
		experiment = response.json()
		title_and_name = f"{experiment['title']} by {experiment['fullname']}"
		return title_and_name
	except requests.exceptions.Timeout:
		raise RuntimeError("ELBUS request timed out.")
	except requests.exceptions.ConnectionError:
		raise RuntimeError("ELBUS cannot be reached from this network.")


def validate_api_key(api_key: str) -> bool:
    url = f"{BASE_URL}/info"

    try:
        response = requests.get(
            url,
            headers=get_headers(api_key),
            timeout=REQUEST_TIMEOUT
        )

        # 401: not authenticated, 403: authenticated but access forbidden
        if response.status_code in (401, 403):
            return False
        response.raise_for_status()
        return True
    except requests.exceptions.Timeout:
        raise RuntimeError("ELBUS request timed out.")
    except requests.exceptions.ConnectionError:
        raise RuntimeError("ELBUS cannot be reached from this network.")


@dataclass
class VoiceNote:
    """Session-scoped submission progress. Audio bytes are never retained here."""

    experiment_id: int
    text: str
    audio_type: str | None
    created_at: datetime = field(default_factory=lambda: datetime.now(ZoneInfo("Europe/Berlin")))
    submission_id: UUID = field(default_factory=uuid4)
    transcript_saved: bool = False
    audio_saved: bool = False
    append_attempted: bool = False
    append_response_uncertain: bool = False
    upload_attempted: bool = False
    lock: Lock = field(default_factory=Lock)

    @property
    def timestamp(self):
        return format_voice_note_timestamp(self.created_at)

    @property
    def filename(self):
        if self.audio_type is None:
            return None
        timestamp = self.timestamp.replace(" ", "_").replace(":", "-")
        return f"voice-note-{timestamp}_id{self.submission_id}{AUDIO_EXTENSIONS[self.audio_type]}"

    def progress(self):
        return {"transcript_saved": self.transcript_saved,
                "audio_saved": self.audio_saved, "audio_filename": self.filename}

    def save_transcript(self, api_key):
        with self.lock:
            if self.transcript_saved:
                return
            if self.append_attempted:
                # A lost response may still mean the remote append succeeded.
                response = requests.get(f"{BASE_URL}/experiments/{self.experiment_id}",
                                        headers=get_headers(api_key), timeout=REQUEST_TIMEOUT)
                response.raise_for_status()
                if f"id{self.submission_id}" in unescape(response.json()["body"] or ""):
                    self.transcript_saved = True
                    return
                if self.append_response_uncertain and self.audio_type is None:
                    # ELBUS may strip HTML comments. Do not repeat an uncertain
                    # text-only write when its invisible marker cannot be found.
                    raise RuntimeError("Check ELBUS before resubmitting this text-only note.")
            self.append_attempted = True
            try:
                append_voice_note(self.experiment_id, self.text, api_key,
                                  self.created_at, self.filename, self.submission_id)
            except Exception as exc:
                self.append_response_uncertain = not isinstance(exc, requests.exceptions.HTTPError)
                raise
            self.transcript_saved = True

    def save_audio(self, audio: bytes, api_key):
        with self.lock:
            if not self.transcript_saved or self.audio_type is None:
                raise ValueError("Save the transcript with audio enabled before uploading audio.")
            if self.audio_saved:
                return
            url = f"{BASE_URL}/experiments/{self.experiment_id}/uploads"
            if self.upload_attempted:
                response = requests.get(url, headers=get_headers(api_key), timeout=REQUEST_TIMEOUT)
                response.raise_for_status()
                if any(upload["real_name"] == self.filename for upload in response.json()):
                    self.audio_saved = True
                    return
            self.upload_attempted = True
            # requests sets the multipart boundary; do not set a JSON Content-Type.
            response = requests.post(
                url, headers={"Authorization": api_key},
                files={"file": (self.filename, audio, self.audio_type)},
                data={"comment": f"Original recording for Voice note — {self.timestamp}"},
                timeout=(5, 60),
            )
            response.raise_for_status()
            self.audio_saved = True
