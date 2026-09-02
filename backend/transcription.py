import whisper

model = whisper.load_model("base")

def transcribe_audio(filename: str) -> str:
    result = model.transcribe(str(filename))
    return result["text"].strip()
