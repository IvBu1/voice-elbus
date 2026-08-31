const recordButton = document.getElementById("recordButton");
const stopButton = document.getElementById("stopButton");
const status = document.getElementById("status");
const audioPlayer = document.getElementById("audioPlayer");

const transcribeButton = document.getElementById("transcribeButton");
const transcript = document.getElementById("transcript");

const experimentIdInput = document.getElementById("experimentId");
const checkExperimentButton = document.getElementById("checkExperimentButton");
const experimentInfo = document.getElementById("experimentInfo");
const sendButton = document.getElementById("sendButton");

let mediaRecorder;
let audioStream;
let audioChunks = [];
let latestAudioBlob = null;
let latestAudioUrl = null;
let verifiedExperimentId = null;
let verifiedExperimentTitle = null;

recordButton.addEventListener("click", async function (){
    try {
        audioStream = await navigator.mediaDevices.getUserMedia({audio: true});
        mediaRecorder = new MediaRecorder(audioStream);
        audioChunks = [];

        mediaRecorder.addEventListener("dataavailable", function (event){
                audioChunks.push(event.data);
        });

        mediaRecorder.addEventListener("stop", function (){
            latestAudioBlob = new Blob(audioChunks, {type: mediaRecorder.mimeType});

            if (latestAudioUrl !== null) {
                URL.revokeObjectURL(latestAudioUrl);
            }
            latestAudioUrl = URL.createObjectURL(latestAudioBlob);
            audioPlayer.src = latestAudioUrl;

            audioPlayer.hidden = false;
            transcribeButton.disabled = false;
            status.textContent = "Recording ready.";
        });

        mediaRecorder.start();

        recordButton.disabled = true;
        stopButton.disabled = false;

        status.textContent = "Recording...";
    }
    catch(error){
        status.textContent = "Could not access microphone.";
        console.error(error);
    }
});


stopButton.addEventListener("click", function (){
        mediaRecorder.stop();
        audioStream.getTracks().forEach(function (track){
            track.stop();
        });

        recordButton.disabled = false;
        stopButton.disabled = true;

        status.textContent = "Recording stopped.";
});


function getFileExtension(){
    const mimeType = latestAudioBlob.type;

    if (mimeType.includes("mp4")) {return "m4a";}
    if (mimeType.includes("ogg")) {return "ogg";}
    if (mimeType.includes("webm")) {return "webm";}

    return "audio";
}


async function transcribeRecording(){
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
        const response = await fetch("transcribe", {method: "POST", body: formData});

        if (!response.ok) {
            const errorResult = await response.json();
            throw new Error(errorResult.detail || ("Server returned " + response.status));
        }

        const result = await response.json();
        transcript.value = result.text;
        updateSendButtonState();
        status.textContent = "Transcription complete. Saved as " + result.filename;
    }
    catch (error){
        status.textContent = "Transcription failed: " + error.message;
        console.error(error);
        transcribeButton.disabled = false;
    }
}


transcribeButton.addEventListener("click", transcribeRecording);
transcript.addEventListener("input", updateSendButtonState);


async function sendToElbus(){
    if (verifiedExperimentId === null){
        status.textContent = "Please confirm an experiment first.";
        return;
    }

    const text = transcript.value.trim();
    if (!text){
        status.textContent = "The transcript is empty.";
        return;
    }

    const confirmed = window.confirm('Add this voice note to "' + verifiedExperimentTitle + '" (ID ' + verifiedExperimentId + ')?');
    if (!confirmed){
        status.textContent = "Send cancelled.";
        return;
    }

    status.textContent = "Sending transcript to ELBUS...";
    sendButton.disabled = true;

    try {
        const response = await fetch("append", {
            method: "POST", 
            headers: {"Content-Type": "application/json"}, 
            body: JSON.stringify({experiment_id: verifiedExperimentId, text: text})
        });

        if (!response.ok){
            const errorResult = await response.json();
            throw new Error(errorResult.detail || ("Server returned "+ response.status));
        }

        resetFormAfterSend();
    }
    catch (error){
        status.textContent = "Could not add transcript: " + error.message;
        console.error(error);
        sendButton.disabled = false;
    }
}


sendButton.addEventListener("click", sendToElbus);


function updateSendButtonState(){
    const hasExperiment = verifiedExperimentId !== null;
    const hasTranscript = transcript.value.trim() !== "";
    sendButton.disabled = !(hasExperiment && hasTranscript);
}


async function checkExperiment(){
    const experimentId = Number(experimentIdInput.value);

    if(!Number.isInteger(experimentId) || experimentId<=0){
        experimentInfo.textContent = "Please enter a valid experiment ID.";
        verifiedExperimentId = null;
        verifiedExperimentTitle = null;
        updateSendButtonState();
        return;
    }

    experimentInfo.textContent = "Checking experiment...";
    checkExperimentButton.disabled = true;

    try{
        const response = await fetch("experiment/" + experimentId);

        if (!response.ok){
            const errorResult = await response.json();
            throw new Error(errorResult.detail || ("Server returned " + response.status));
        }

        const result = await response.json();
        verifiedExperimentId = result.experiment_id;
        verifiedExperimentTitle = result.title;

        experimentInfo.textContent = 'Selected experiment: "' + result.title + '" (ID ' + result.experiment_id + ')';

        updateSendButtonState();

    }
    catch (error){
        verifiedExperimentId = null;
        verifiedExperimentTitle = null;
        experimentInfo.textContent = "Could not find experiment: " + error.message;
        updateSendButtonState();
    }

    finally {
        checkExperimentButton.disabled = false;
    }
}


checkExperimentButton.addEventListener("click", checkExperiment);


experimentIdInput.addEventListener("input", function () {
    verifiedExperimentId = null;
    verifiedExperimentTitle = null;
    experimentInfo.textContent = "Experiment not confirmed.";
    updateSendButtonState();
});


function resetFormAfterSend() {
    transcript.value = "";
    experimentIdInput.value = "";

    verifiedExperimentId = null;
    verifiedExperimentTitle = null;

    experimentInfo.textContent = "No experiment confirmed.";

    latestAudioBlob = null;
    audioChunks = [];

    audioPlayer.pause();
    audioPlayer.removeAttribute("src");
    audioPlayer.load();
    audioPlayer.hidden = true;
    if (latestAudioUrl !== null){
        URL.revokeObjectURL(latestAudioUrl);
        latestAudioUrl = null;
    }

    recordButton.disabled = false;
    stopButton.disabled = true;
    transcribeButton.disabled = true;
    sendButton.disabled = true;

    status.textContent = "Voice note added to ELBUS. " + "Ready for a new recording.";
}
