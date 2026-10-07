import requests
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
		    json={"bodyappend": format_voice_note(safe_transcript)},
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
