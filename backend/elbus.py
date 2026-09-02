import os
import requests
from pprint import pprint
from datetime import datetime
from zoneinfo import ZoneInfo
from html import escape

BASE_URL = "https://elbustest.uni-stuttgart.de/api/v2"
NOW = datetime.now(ZoneInfo("Europe/Berlin"))
REQUEST_TIMEOUT = (5, 15) # first number refers to connection timeout, second to data timeout

def get_headers(api_key: str) -> dict:
    return {
        "Authorization": api_key,
        "Content-Type": "application/json"
    }


def format_voice_note(transcript: str) -> str:
    formatted_transcript = f"""
    <p>
        <strong>Voice note — {NOW:%Y-%m-%d %H:%M:%S}</strong><br>
        {transcript}
    </p>
    """
    return formatted_transcript

def append_voice_note(experiment_id: int,
					  transcript: str,
					  api_key: str):
	url = f"{BASE_URL}/experiments/{experiment_id}"
	safe_transcript = escape(transcript)

	try:
		response = requests.patch(
		    url,
		    headers=get_headers(api_key),
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
    url = f"{BASE_URL}/experiments"

    try:
        response = requests.get(
            url,
            headers=get_headers(api_key),
            params={"limit": 1},
            timeout=REQUEST_TIMEOUT
        )

        if response.status_code in (401, 403):
            return False
        response.raise_for_status()
        return True

    except requests.exceptions.HTTPError:
        raise

    except requests.exceptions.RequestException as exc:
        raise RuntimeError("ELBUS could not be reached.") from exc
