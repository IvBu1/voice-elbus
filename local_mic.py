import sounddevice as sd
import numpy as np
from scipy.io.wavfile import write

# or try sample_rate=44100
def record_audio(filename="recording.wav", sample_rate=44100):
    chunks = []

    def callback(indata, frames, time, status):
        if status:
            print(status)

        chunks.append(indata.copy())

    input("Press ENTER to start recording...")
    print("Recording... Press ENTER to stop.")

    with sd.InputStream(
        samplerate=sample_rate,
        channels=1,
        dtype="int16",
        callback=callback,
    ):
        input()

    audio = np.concatenate(chunks, axis=0)
    write(filename, sample_rate, audio)

    print(f"Recording saved to {filename}")

    return filename

if __name__ == "__main__":
	record_audio()
