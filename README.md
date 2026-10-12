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


## Dependencies
- **python**:
	- see `requirements.txt`
- **system**:
	- `ffmpeg`


## Configuration
Configuration and secrets (such as `HOST_IP` and `ELBUS_BASE_URL`) should be supplied through environment variables.


## Docker
- Build image via: `docker build -t voice-elbus .`
- Run container via `docker run --rm -p 8000:8000 -e HOST_IP="0.0.0.0" voice-elbus`

The application is then available on: `http://localhost:8000`


## Execution for local testing

Start the application directly with python from the root directory: 
1) `export HOST_IP="127.0.0.1" export ELBUS_BASE_URL="<elabftw_api_base_url>"`
2) `python3 main.py`
3) open `http://localhost:8000`

## Hosting on server

[Release Docker images](https://github.com/IvBu1/voice-elbus/pkgs/container/voice-elbus) can be used to run a Docker container on the server. The server-side configuration is not part of this repository.


## Deployment considerations

Deployment within University of Stuttgart infrastructure is currently being investigated. The final hosting environment should provide:
- HTTPS access to users
- access ELBUS from within the University of Stuttgart network
- ability to run Docker containers or an equivalent Python environment
- authentication is currently realized via providing personal ELBUS API key, which is handled on backend and not accessible directly through the frontend

Uploaded audio is written only to a temporary file required for transcription and is deleted immediately after the transcription attempt, including when transcription fails.

The browser may temporarily retain the recording in memory so that the user can replay it. The recording is discarded when it is replaced, the workflow is reset, or the page is closed.

The application does not require its own database.
