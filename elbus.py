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
REQUEST_TIMEOUT = (5, 15) # first number refers to connection timeout, second to data timeout

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

	try:
		response = requests.patch(
		    url,
		    headers=headers,
		    json={
		        "bodyappend": format_voice_note(safe_transcript)
		    },
		    timeout=REQUEST_TIMEOUT
		)
		response.raise_for_status()
	except requests.exceptions.Timeout:
		raise RuntimeError("ELBUS request timed out.")
	except requests.exceptions.ConnectionError:
		raise RuntimeError("ELBUS cannot be reached from this network.")

def get_experiment_title(experiment_id: int) -> str:
	url = f"{BASE_URL}/experiments/{experiment_id}"

	try:
		response = requests.get(
			url, 
			headers=headers,
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



