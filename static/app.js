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

const apiKeyInput = document.getElementById("apiKey");
const loginButton = document.getElementById("loginButton");
const logoutButton = document.getElementById("logoutButton");
const loginStatus = document.getElementById("loginStatus");

let mediaRecorder;
let audioStream;
let audioChunks = [];
let latestAudioBlob = null;
let latestAudioUrl = null;
let verifiedExperimentId = null;
let verifiedExperimentTitle = null;
let isAuthenticated = false;



function setAuthenticated(authenticated){
    isAuthenticated = authenticated;
    if(authenticated){
        loginStatus.textContent = "Connected to ELBUS.";

        apiKeyInput.disabled = true;
        loginButton.hidden = true;
        logoutButton.hidden = false;

        recordButton.disabled = false;
        transcript.disabled = false;
        experimentIdInput.disabled = false;
        checkExperimentButton.disabled = false;
    } else {
        loginStatus.textContent = "Not connected to ELBUS.";

        apiKeyInput.disabled = false;
        loginButton.hidden = false;
        logoutButton.hidden = true;

        recordButton.disabled = true;
        stopButton.disabled = true;
        transcribeButton.disabled = true;
        transcript.disabled = true;
        experimentIdInput.disabled = true;
        checkExperimentButton.disabled = true;
        sendButton.disabled = true;
    }

    updateSendButtonState();
}


function disableWorkflowControls(){
    recordButton.disabled = true;
    stopButton.disabled = true;
    transcribeButton.disabled = true;
    transcript.disabled = true;
    experimentIdInput.disabled = true;
    checkExperimentButton.disabled = true;
    sendButton.disabled = true;
}


// --------------------------------------------------
// Handle authenticated requests
// --------------------------------------------------

async function authenticatedFetch(url, options={}){
    const response = await fetch(url,
    {
        ...options,
        // the browser sends our session cookie
        credentials: "same-origin"
    });

    if(response.status === 401){
        resetWorkflow();
        setAuthenticated(false);
        throw new Error("Your ELBUS session has expired. Please connect again.");
    }

    return response;
}


// --------------------------------------------------
// Extract useful FastAPI error messages
// --------------------------------------------------

async function getErrorMessage(response, fallbackMessage){
    try{
        const data = await response.json();
        if (data.detail) {return data.detail;}
    } catch {
        // Response was not JSON.
    }

    return fallbackMessage;
}


// --------------------------------------------------
// Login
// --------------------------------------------------

loginButton.addEventListener("click", async function(){
        const apiKey = apiKeyInput.value.trim();

        if(!apiKey){
            loginStatus.textContent = "Please enter an ELBUS API key.";
            return;
        }

        loginButton.disabled = true;
        apiKeyInput.disabled = true;
        loginStatus.textContent = "Connecting to ELBUS...";

        try {
            const response = await fetch("auth/login",
            {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                credentials: "same-origin",
                body: JSON.stringify({api_key: apiKey})
            });

            if(!response.ok){
                const message = await getErrorMessage(response, "Could not connect to ELBUS.");
                throw new Error(message);
            }

            // Remove the API key from the input
            // as soon as authentication succeeds.
            apiKeyInput.value = "";
            setAuthenticated(true);
            status.textContent = "Ready.";
        } catch (error) {
            setAuthenticated(false);
            loginStatus.textContent = error.message;
        } finally {
            loginButton.disabled = false;
            if(!isAuthenticated){
                apiKeyInput.disabled = false;
            }
        }
    }
);


// --------------------------------------------------
// Allow Enter in API key field
// --------------------------------------------------

apiKeyInput.addEventListener("keydown", function(event){
    if(event.key === "Enter"){
        loginButton.click();
    }
});


// --------------------------------------------------
// Logout
// --------------------------------------------------

logoutButton.addEventListener("click", async function(){
        isAuthenticated = false;
        logoutButton.disabled = true;
        disableWorkflowControls();
        status.textContent = "Disconnecting from ELBUS...";

        try {
            await fetch("auth/logout",
            {
                method: "POST",
                credentials: "same-origin"
            });

        } finally {
            resetWorkflow();
            setAuthenticated(false);
            apiKeyInput.value = "";
            status.textContent = "Connect to ELBUS to begin.";
            logoutButton.disabled = false;
        }
    }
);


// --------------------------------------------------
// Check authentication when page loads
// --------------------------------------------------

async function checkAuthentication(){
    try {
        const response = await fetch("auth/status",
            {
                credentials: "same-origin"
            });

        if(!response.ok){
            throw new Error("Server returned " + response.status);
        }

        const result = await response.json();
        setAuthenticated(result.authenticated);

        if(result.authenticated){
            status.textContent = "Ready.";
        } else {
            status.textContent = "Connect to ELBUS to begin.";
        }
    } catch {
        setAuthenticated(false);
        loginStatus.textContent = "Could not contact the server.";
    }
}





function clearRecording(){
    latestAudioBlob = null;
    audioChunks = [];

    if(latestAudioUrl !== null){
        URL.revokeObjectURL(latestAudioUrl);
        latestAudioUrl = null;
    }

    audioPlayer.pause();
    audioPlayer.removeAttribute("src");
    audioPlayer.load();
    audioPlayer.hidden = true;
    transcribeButton.disabled = true;
}


function resetWorkflow(){
    transcript.value = "";
    experimentIdInput.value = "";

    verifiedExperimentId = null;
    verifiedExperimentTitle = null;
    experimentInfo.textContent = "No experiment confirmed.";

    if(audioStream){
        audioStream.getTracks().forEach(function (track){
            track.stop();
        });
        audioStream = null;
    }

    clearRecording();
}

recordButton.addEventListener("click", async function (){
    try {
        clearRecording();
        audioStream = await navigator.mediaDevices.getUserMedia({audio: true});

        if(!isAuthenticated){
            audioStream.getTracks().forEach(function (track){
                track.stop();
            });
            audioStream = null;
            return;
        }

        mediaRecorder = new MediaRecorder(audioStream);
        audioChunks = [];

        mediaRecorder.addEventListener("dataavailable", function (event){
                audioChunks.push(event.data);
        });

        mediaRecorder.addEventListener("stop", function (){
            if(!isAuthenticated){
                clearRecording();
                return;
            }

            latestAudioBlob = new Blob(audioChunks, {type: mediaRecorder.mimeType});

            if(latestAudioUrl !== null){
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

        recordButton.disabled = !isAuthenticated;
        stopButton.disabled = true;

        status.textContent = "Recording stopped.";
});


function getFileExtension(){
    const mimeType = latestAudioBlob.type;

    if(mimeType.includes("mp4")){return "m4a";}
    if(mimeType.includes("ogg")){return "ogg";}
    if(mimeType.includes("webm")){return "webm";}

    return "audio";
}


async function transcribeRecording(){
    if(latestAudioBlob === null){
        status.textContent = "No recording available.";
        return;
    }

    const formData = new FormData();
    const extension = getFileExtension();

    formData.append("file", latestAudioBlob, "recording." + extension); // exactly "file" is requested by our FastAPI function
    status.textContent = "Uploading and transcribing...";
    transcribeButton.disabled = true;

    try {
        const response = await authenticatedFetch("transcribe", {method: "POST", body: formData});

        if(!response.ok){
            const errorResult = await response.json();
            throw new Error(errorResult.detail || ("Server returned " + response.status));
        }

        const result = await response.json();
        transcript.value = result.text;
        updateSendButtonState();
        status.textContent = "Transcription complete.";
    }
    catch (error){
        status.textContent = "Transcription failed: " + error.message;
        console.error(error);
        transcribeButton.disabled = !isAuthenticated || latestAudioBlob === null;
    }
}


transcribeButton.addEventListener("click", transcribeRecording);
transcript.addEventListener("input", updateSendButtonState);


async function sendToElbus(){
    if(verifiedExperimentId === null){
        status.textContent = "Please confirm an experiment first.";
        return;
    }

    const text = transcript.value.trim();
    if(!text){
        status.textContent = "The transcript is empty.";
        return;
    }

    const confirmed = window.confirm('Add this voice note to "' + verifiedExperimentTitle + '" (ID ' + verifiedExperimentId + ')?');
    if(!confirmed){
        status.textContent = "Send cancelled.";
        return;
    }

    status.textContent = "Sending transcript to ELBUS...";
    sendButton.disabled = true;

    try {
        const response = await authenticatedFetch("append", {
            method: "POST", 
            headers: {"Content-Type": "application/json"}, 
            body: JSON.stringify({experiment_id: verifiedExperimentId, text: text})
        });

        if(!response.ok){
            const errorResult = await response.json();
            throw new Error(errorResult.detail || ("Server returned "+ response.status));
        }

        resetFormAfterSend();
    }
    catch (error){
        status.textContent = "Could not add transcript: " + error.message;
        console.error(error);
        updateSendButtonState();
    }
}


sendButton.addEventListener("click", sendToElbus);


function updateSendButtonState(){
    const hasExperiment = verifiedExperimentId !== null;
    const hasTranscript = transcript.value.trim() !== "";
    sendButton.disabled = !isAuthenticated || !(hasExperiment && hasTranscript);
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
        const response = await authenticatedFetch("experiment/" + experimentId);

        if(!response.ok){
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
        checkExperimentButton.disabled = !isAuthenticated;
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

    clearRecording()   

    recordButton.disabled = !isAuthenticated;
    stopButton.disabled = true;
    sendButton.disabled = true;

    status.textContent = "Voice note added to ELBUS. " + "Ready for a new recording.";
}

// initial page state
setAuthenticated(false);
checkAuthentication();
