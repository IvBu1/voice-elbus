const recordButton = document.getElementById("recordButton");
const stopButton = document.getElementById("stopButton");
const status = document.getElementById("status");
const audioPlayer = document.getElementById("audioPlayer");

const transcribeButton = document.getElementById("transcribeButton");
const transcript = document.getElementById("transcript");

const experimentIdInput = document.getElementById("experimentId");
const sendButton = document.getElementById("sendButton");

let mediaRecorder;
let audioStream;
let audioChunks = [];
let latestAudioBlob = null;

recordButton.addEventListener("click", async function (){
        try {
            audioStream = await navigator.mediaDevices.getUserMedia({audio: true});
            mediaRecorder = new MediaRecorder(audioStream);

            audioChunks = [];

            mediaRecorder.addEventListener("dataavailable", function (event){
                    audioChunks.push(event.data);
                }
            );


            mediaRecorder.addEventListener("stop", function (){
                latestAudioBlob = new Blob(audioChunks, {type: mediaRecorder.mimeType});
                const audioUrl = URL.createObjectURL(latestAudioBlob);
                audioPlayer.src = audioUrl; // assign blob to audio player for playing
                audioPlayer.hidden = false;
                transcribeButton.disabled = false;
                status.textContent = "Recording ready.";
                }
            );



            mediaRecorder.start();

            recordButton.disabled = true;
            stopButton.disabled = false;

            status.textContent = "Recording...";
        }
        catch(error){
            status.textContent = "Could not access microphone.";
            console.error(error);
        }
    }
);


stopButton.addEventListener("click", function (){
        mediaRecorder.stop();
        audioStream.getTracks().forEach(function (track){
                    track.stop();
                }
            );

        recordButton.disabled = false;
        stopButton.disabled = true;

        status.textContent = "Recording stopped.";
    }
);


function getFileExtension() {
    const mimeType = latestAudioBlob.type;

    if (mimeType.includes("mp4")) {return "m4a";}
    if (mimeType.includes("ogg")) {return "ogg";}
    if (mimeType.includes("webm")) {return "webm";}

    return "audio";
}


async function transcribeRecording() {

    if (latestAudioBlob === null){
        status.textContent = "No recording available.";
        return;
    }

    const formData = new FormData();
    const extension = getFileExtension();

    formData.append("file", latestAudioBlob, "recording." + extension); // exactly "file" is requested by our FastAPI function
    status.textContent = "Uploading and transcribing...";
    transcribeButton.disabled = true;

    try {
        const response = await fetch("/transcribe", {method: "POST", body: formData});

        if (!response.ok) {
            const errorResult = await response.json();
            throw new Error(errorResult.detail || ("Server returned " + response.status));
        }

        const result = await response.json();
        transcript.value = result.text;
        sendButton.disabled = false;
        status.textContent = "Transcription complete. Saved as " + result.filename;
    }
    catch (error){
        status.textContent = "Transcription failed: " + error.message;
        console.error(error);
        transcribeButton.disabled = false;
    }
}


transcribeButton.addEventListener("click", transcribeRecording);


async function sendToElbus(){
    const experimentId = Number(experimentIdInput.value);
    const text = transcript.value.trim();


    if (!experimentId){
        status.textContent = "Please enter a valid experiment ID.";
        return;
    }

    if (!text){
        status.textContent = "The transcript is empty.";
        return;
    }

    status.textContent = "Sending transcript to ELBUS...";
    sendButton.disabled = true;

    try {
        const response = await fetch("/append", {
                method: "POST", 
                headers: {"Content-Type": "application/json"}, 
                body: JSON.stringify({experiment_id: experimentId, text: text})
                }
            );

        if (!response.ok){
            const errorResult = await response.json();
            throw new Error(errorResult.detail || ("Server returned "+ response.status));
        }

        status.textContent = "Transcript added to ELBUS.";
    }
    catch (error){
        status.textContent = "Could not add transcript: " + error.message;
        console.error(error);
        sendButton.disabled = false;
    }
}


sendButton.addEventListener("click", sendToElbus);
