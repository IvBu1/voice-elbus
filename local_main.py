import sys

from elbus import append_voice_note
from transcription import transcribe_audio
from mic import record_audio

# audio_file = sys.argv[1]
experiment_id = int(sys.argv[1])

audio_file = record_audio()

print ("Transcribing...")

transcript = transcribe_audio(audio_file)

print("\nTranscript:")
print("-" * 60)
print(transcript)
print("-" * 60)

answer = input("\nAdd this to ELBUS? [y/N]: ").strip().lower()

if answer in ("y", "yes"):
    append_voice_note(experiment_id, transcript)
    print("Added to ELBUS.")
else:
    print("Cancelled.")
