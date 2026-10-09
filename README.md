# ELBUS Voice Notes

A lightweight web application for adding speech-to-text laboratory notes to ELBUS/eLabFTW.

The application allows a user to:
1) Authenticate via API key and start a session.
2) Record a voice note in the browser.
3) Automatically transcribe after stopping the recording using OpenAI Whisper running on the server.
4) Review and edit the generated transcript.
5) Select an accessible ELBUS experiment from the dropdown.
6) Append the approved transcript to the experiment using the eLabFTW REST API.
7) Logout of session.


## Project status

This project is currently a prototype.

The main application workflow has been implemented and tested locally and from a mobile browser.

The application has also been containerized using Docker.


## Project structure

The application consists of a small browser frontend and a Python backend.

- `main.py`: application entry point, creates the FastAPI application and starts Uvicorn
- `backend/`: defines HTTP endpoints, performs speech-to-text transcription and handles communication with the ELBUS/eLabFTW REST API
- `static/`: contains browser frontend 


## Application workflow

1) browser recording (Stop automatically starts transcription)
2) temporary audio file upload
3) `Whisper` transcription
4) temporary audio file deleted
5) transcript returned to browser
6) user reviews/edits transcript
7) approved transcript sent to the selected experiment in ELBUS

Uploaded audio is written only to a temporary file required for transcription and is deleted immediately after the transcription attempt, including when transcription fails.

The browser may temporarily retain the recording in memory so that the user can replay it. The recording is discarded when it is replaced, the workflow is reset, or the page is closed.

The application does not require its own database.


## Dependencies
- **python**:
	- see `requirements.txt`
- **system**:
	- `ffmpeg`


## Configuration
Configuration and secrets should be supplied through environment variables and must not be committed to the repository, e.g.:
- `HOST_IP`: e.g. `127.0.0.1` for access within same machine, or `0.0.0.0` for listering on all IPv4 network interfaces


## Docker
- Build image via: `docker build -t voice-elbus .`
- Run container via `docker run --rm -p 8000:8000 -e HOST_IP="0.0.0.0" voice-elbus`

The application is then available on: `http://localhost:8000`


## Execution

Start the application directly with python from the root directory: 
1) `export HOST_IP="127.0.0.1" export ELBUS_BASE_URL="<elabftw_api_base_url>"` (for local testing)
2) `python3 main.py`


## Deployment considerations

Deployment within University of Stuttgart infrastructure is currently being investigated. The final hosting environment should provide:
- HTTPS access to users
- access ELBUS from within the University of Stuttgart network
- ability to run Docker containers or an equivalent Python environment
- authentication is currently realized via providing personal ELBUS API key, which is handled on backend and not accessible directly through the frontend


## Experiment selection

After connecting, the application loads accessible experiments using the personal API key held in the server session. The authenticated `GET /experiments` route retrieves all pages from eLabFTW with `scope=3` (all accessible experiments of the user). Options show the title, owner (when available), and ID. Use **Refresh experiments** to reload the list or retry a failed request.

Recording and transcript review share one step, with audio playback and an editable transcript. During transcription, recording and sending are disabled. Failed transcription keeps the audio available and shows **Retry transcription**. Sending clears the note and recording while retaining the selected experiment for the next note.

## Original audio attachments

**Attach original audio** is enabled by default. The recording size is displayed before sending, and the confirmation includes the audio when selected. Uncheck this option to send only the transcript. Attachments have a 50 MiB limit.

The note header, audio filename, and attachment comment share a timestamp generated at submission time in Europe/Berlin. The note also names the matching audio file. For example, `Voice note — 2026-10-07 15:42:08.123456` corresponds to `voice-note-2026-10-07_15-42-08.123456.webm`.

The browser sends the transcript to authenticated `POST /voice-notes`, then sends the recording as raw audio to `POST /voice-notes/{submission_id}/audio`. The backend forwards it to the experiment's eLabFTW uploads endpoint using multipart upload. Attachment bytes are held only in bounded request memory; this upload path creates no server files and retains no audio in the session. Transcription still uses the existing temporary file, which is deleted after processing.

If audio upload fails after the text is saved, the recording stays available and **Retry audio upload** retries that part. **Continue without audio** clears the local note so the user can record again; an unconfirmed upload may already exist in ELBUS, so the status advises checking there before uploading manually. A note submitted with audio enabled names its intended attachment even when the upload is not completed.

Submission progress is kept in the existing in-memory session. Retries reuse the same submission ID, timestamp, and destination. After an unconfirmed request, the backend checks the experiment body or attachment list before repeating the write. Progress is lost on logout, session expiry, or server restart, and the browser recording and retry ID are lost on page reload. Check ELBUS before resubmitting after those events.
