# SPDX-FileCopyrightText: 2026 Ivan Buntic
# SPDX-License-Identifier: MIT

import whisper

model = whisper.load_model("base")

def transcribe_audio(filename: str) -> str:
    result = model.transcribe(str(filename))
    return result["text"].strip()
