# ELBUS Voice Notes

A lightweight web application for adding speech-to-text laboratory notes to ELBUS/eLabFTW.

The application allows a user to:
1) Authenticate via API key and start a session.
2) Record a voice note in the browser.
3) Transcribe the recording using OpenAI Whisper running on the server.
4) Review and edit the generated transcript.
5) Select and verify an ELBUS experiment.
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

1) browser recording
2) temporary audio file upload
3) `Whisper` transcription
4) temporary audio file deleted
5) transcript returned to browser
6) user reviews/edits transcript
7) approved transcript send to provided experiment ID in ELBUS

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
1) `export HOST_IP="127.0.0.1"` (for local testing)
2) `python3 main.py`


## Deployment considerations

Deployment within University of Stuttgart infrastructure is currently being investigated. The final hosting environment should provide:
- HTTPS access to users
- access ELBUS from within the University of Stuttgart network
- ability to run Docker containers or an equivalent Python environment
- authentication is currently realized via providing personal ELBUS API key, which is handled on backend and not accessible directly through the frontend
