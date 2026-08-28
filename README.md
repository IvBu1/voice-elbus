# Remarks for python
1) `export ELBUS_API_WRITE_KEY="MY_KEY"`
2) `export HOST="127.0.0.1"`
3) `python3 main.py`

# Remarks for docker
- Build image via: `docker build -t voice-elbus .`
- Run container via `docker run --rm -p 8000:8000 -e ELBUS_API_WRITE_KEY="MY_KEY" -e HOST="0.0.0.0" -v "$(pwd)/recordings:/app/recordings" voice-elbus`

# Dependencies
- **pip**:
	- see `requirements.txt`
- **system**:
	- see `apt.txt`
