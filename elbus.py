import os
import requests
from pprint import pprint
from datetime import datetime
from zoneinfo import ZoneInfo
from html import escape

BASE_URL = "https://elbustest.uni-stuttgart.de/api/v2"
API_WRITE_KEY = os.environ["ELBUS_API_WRITE_KEY"]
now = datetime.now(ZoneInfo("Europe/Berlin"))
headers={
	"Authorization": API_WRITE_KEY,
	"Accept": "application/json",
}

def format_voice_note(transcript: str) -> str:
    formatted_transcript = f"""
    <p>
        <strong>Voice note — {now:%Y-%m-%d %H:%M:%S}</strong><br>
        {transcript}
    </p>
    """
    return formatted_transcript

def append_voice_note(experiment_id: int,
					  transcript: str):
	url = f"{BASE_URL}/experiments/{experiment_id}"
	safe_transcript = escape(transcript)

	response = requests.patch(
	    url,
	    headers=headers,
	    json = {
	        "bodyappend": format_voice_note(safe_transcript)
	    }
	)
	response.raise_for_status()




