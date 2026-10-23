const instanceName = document.body.dataset.instanceName;

const recordButton = document.getElementById("recordButton");
const stopButton = document.getElementById("stopButton");
const status = document.getElementById("status");
const audioPlayer = document.getElementById("audioPlayer");

const transcribeButton = document.getElementById("transcribeButton");
const transcript = document.getElementById("transcript");

const experimentIdInput = document.getElementById("experimentId");
const refreshExperimentsButton = document.getElementById("refreshExperimentsButton");
const experimentInfo = document.getElementById("experimentInfo");
const sendButton = document.getElementById("sendButton");
const sendDestination = document.getElementById("sendDestination");
const attachAudio = document.getElementById("attachAudio");
const audioSize = document.getElementById("audioSize");
const continueWithoutAudioButton = document.getElementById("continueWithoutAudioButton");

const apiKeyInput = document.getElementById("apiKey");
const loginButton = document.getElementById("loginButton");
const logoutButton = document.getElementById("logoutButton");
const loginStatus = document.getElementById("loginStatus");
const loginSection = document.getElementById("loginSection");
const workflow = document.getElementById("workflow");

let mediaRecorder;
let audioStream;
let latestAudioBlob = null;
let latestAudioUrl = null;
let verifiedExperimentId = null;
let verifiedExperimentTitle = null;
let isAuthenticated = false;
let experimentsRequestVersion = 0;
let noteVersion = 0;
let isRecording = false;
let isTranscribing = false;
let isSending = false;
let pendingSubmission = null;
let isLoadingExperiments = false;

function updateNoteControls(){
    const busy = isRecording || isTranscribing || isSending;
    const isActionDisabled = !isAuthenticated || busy || pendingSubmission !== null;
    recordButton.disabled = isActionDisabled;
    transcript.disabled = isActionDisabled;
    transcribeButton.disabled = isActionDisabled || latestAudioBlob === null;
    attachAudio.disabled = isActionDisabled || latestAudioBlob === null;
    experimentIdInput.disabled = isActionDisabled || isLoadingExperiments || experimentIdInput.options.length <= 1;
    refreshExperimentsButton.disabled = isActionDisabled || isLoadingExperiments;
    if(!pendingSubmission){
        sendButton.textContent = "Add voice note";
    } else if(pendingSubmission.transcriptSaved){
        sendButton.textContent = "Retry audio upload";
    } else {
        sendButton.textContent = "Retry sending voice note";
    }
    if(pendingSubmission !== null && pendingSubmission.transcriptSaved && !busy){
        continueWithoutAudioButton.hidden = false;
    } else {
        continueWithoutAudioButton.hidden = true;
    }
    continueWithoutAudioButton.disabled = !isAuthenticated || busy;
    updateSendButtonState();
}

// +++++++ state management +++++++
function updateSendButtonState(){
    if(pendingSubmission !== null){
        sendDestination.textContent = 'Send to: ' + pendingSubmission.experiment_title + ' (ID ' + pendingSubmission.experiment_id + ')';
    } else if(verifiedExperimentId !== null){
        sendDestination.textContent = 'Send to: ' + verifiedExperimentTitle + ' (ID ' + verifiedExperimentId + ')';
    } else {
        sendDestination.textContent = "Select an experiment before sending.";
    }
    const hasExperiment = verifiedExperimentId !== null;
    const hasTranscript = transcript.value.trim() !== "";
    sendButton.disabled = !isAuthenticated || isRecording || isTranscribing || isSending
        || (!pendingSubmission && !(hasExperiment && hasTranscript));
}

function setAuthenticated(authenticated){
    isAuthenticated = authenticated;
    loginSection.hidden = authenticated;
    workflow.hidden = !authenticated;

    if(authenticated){
        setMessage(loginStatus, "Connected to " + instanceName + ".", "success");
        apiKeyInput.disabled = true;
        loginButton.hidden = true;
        logoutButton.hidden = false;
        recordButton.disabled = false;
        transcript.disabled = false;
        experimentIdInput.disabled = experimentIdInput.options.length <= 1;
        refreshExperimentsButton.disabled = false;
    } else {
        experimentsRequestVersion++;
        isLoadingExperiments = false;
        experimentIdInput.replaceChildren(new Option("Connect to load experiments", ""));
        verifiedExperimentId = null;
        verifiedExperimentTitle = null;
        setMessage(loginStatus, "Not connected to " + instanceName + ".", "neutral");
        apiKeyInput.disabled = false;
        loginButton.hidden = false;
        logoutButton.hidden = true;
        recordButton.disabled = true;
        stopButton.disabled = true;
        transcribeButton.disabled = true;
        transcript.disabled = true;
        experimentIdInput.disabled = true;
        refreshExperimentsButton.disabled = true;
        sendButton.disabled = true;
    }

    updateNoteControls();
}

function disableWorkflowControls(){
    recordButton.disabled = true;
    stopButton.disabled = true;
    transcribeButton.disabled = true;
    transcript.disabled = true;
    experimentIdInput.disabled = true;
    refreshExperimentsButton.disabled = true;
    sendButton.disabled = true;
    attachAudio.disabled = true;
    continueWithoutAudioButton.disabled = true;
}

function resetFormAfterSend() {
    transcript.value = "";
    clearRecording();
    recordButton.disabled = !isAuthenticated;
    stopButton.disabled = true;
    sendButton.disabled = true;
    setMessage(status, "Voice note added to " + instanceName + ". " + "Ready for a new recording.", "success");
}

function resetWorkflow(){
    transcript.value = "";
    experimentIdInput.value = "";
    verifiedExperimentId = null;
    verifiedExperimentTitle = null;
    setMessage(experimentInfo, "No experiment selected.", "neutral");
    if(audioStream){
        audioStream.getTracks().forEach(function (track){
            track.stop();
        });
        audioStream = null;
    }
    clearRecording();
}
// ------- state management -------


// +++++++ authentication +++++++
async function authenticatedFetch(url, options={}){
    const response = await fetch(url, {
        ...options,
        // the browser sends our session cookie
        credentials: "same-origin"
    });

    if(response.status === 401){
        resetWorkflow();
        setAuthenticated(false);
        const message = "Your " + instanceName + " session has expired. Please connect again.";
        setMessage(loginStatus, message, "error");
        throw new Error(message);
    }

    return response;
}

async function checkAuthentication(){
    try {
        const response = await fetch("auth/status", {
            credentials: "same-origin"
        });

        if(!response.ok)
            throw new Error("Server returned " + response.status);

        const result = await response.json();
        setAuthenticated(result.authenticated);

        if(result.authenticated){
            setMessage(status, "Ready.", "neutral");
            await loadExperiments();
        }
        else{
            setMessage(status, "Connect to " + instanceName + " to begin.", "neutral");
            if(result.reason === "Session expired.")
                setMessage(loginStatus, "Your " + instanceName + " session has expired. Please connect again.", "error");
        }
    } catch{
        setAuthenticated(false);
        setMessage(loginStatus, "Could not contact the server.", "error");
    }
}

loginButton.addEventListener("click", async function(){
        const apiKey = apiKeyInput.value.trim();

        if(!apiKey){
            setMessage(loginStatus, "Please enter your " + instanceName + " API key.", "error");
            return;
        }

        loginButton.disabled = true;
        apiKeyInput.disabled = true;
        setMessage(loginStatus, "Connecting to " + instanceName + "...", "neutral");

        try {
            const response = await fetch("auth/login", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                credentials: "same-origin",
                body: JSON.stringify({api_key: apiKey})
            });

            if(!response.ok){
                const message = await getErrorMessage(response, "Could not connect to " + instanceName + ".");
                throw new Error(message);
            }

            // remove the API key from the input as soon as authentication succeeds
            apiKeyInput.value = "";
            setAuthenticated(true);
            setMessage(status, "Ready.", "neutral");
            await loadExperiments();
        } catch(error){
            setAuthenticated(false);
            setMessage(loginStatus, error.message, "error");
        } finally{
            loginButton.disabled = false;
            if(!isAuthenticated)
                apiKeyInput.disabled = false;
        }
    }
);

apiKeyInput.addEventListener("keydown", function(event){
    if(event.key === "Enter"){
        loginButton.click();
    }
});

logoutButton.addEventListener("click", async function(){
        isAuthenticated = false;
        logoutButton.disabled = true;
        disableWorkflowControls();
        setMessage(loginStatus, "Disconnecting from " + instanceName + "...", "neutral");

        try {
            await fetch("auth/logout", {
                method: "POST",
                credentials: "same-origin"
            });
        } finally {
            resetWorkflow();
            setAuthenticated(false);
            apiKeyInput.value = "";
            setMessage(status, "Connect to " + instanceName + " to begin.", "neutral");
            logoutButton.disabled = false;
        }
    }
);
// ------- authentication -------


// +++++++ audio +++++++
function clearRecording(){
    noteVersion++;
    isRecording = false;
    isTranscribing = false;
    isSending = false;
    pendingSubmission = null;
    audioSize.textContent = "";
    continueWithoutAudioButton.hidden = true;
    latestAudioBlob = null;

    if(latestAudioUrl !== null){
        URL.revokeObjectURL(latestAudioUrl);
        latestAudioUrl = null;
    }

    audioPlayer.pause();
    audioPlayer.removeAttribute("src");
    audioPlayer.load();
    audioPlayer.hidden = true;
    transcribeButton.disabled = true;
    transcribeButton.hidden = true;
}

function getFileExtension(){
    const mimeType = latestAudioBlob.type;

    if(mimeType.includes("mp4")){return "m4a";}
    if(mimeType.includes("ogg")){return "ogg";}
    if(mimeType.includes("webm")){return "webm";}

    return "audio";
}

recordButton.addEventListener("click", async function (){
    if(!isAuthenticated || isRecording || isTranscribing || isSending || pendingSubmission)
        return;
    clearRecording();
    transcript.value = "";
    isRecording = true;
    const version = noteVersion;
    updateNoteControls();
    setMessage(status, "Opening microphone...", "neutral");

    try {
        const stream = await navigator.mediaDevices.getUserMedia({audio: true});
        if(!isAuthenticated || version !== noteVersion){
            stream.getTracks().forEach(track => track.stop());
            return;
        }
        audioStream = stream;
        const recorder = new MediaRecorder(stream);
        const chunks = [];
        mediaRecorder = recorder;

        recorder.addEventListener("dataavailable", event => chunks.push(event.data));
        recorder.addEventListener("stop", function (){
            stream.getTracks().forEach(track => track.stop());
            if(!isAuthenticated || version !== noteVersion)
                return;
            audioStream = null;
            isRecording = false;
            stopButton.disabled = true;
            latestAudioBlob = new Blob(chunks, {type: recorder.mimeType});
            latestAudioUrl = URL.createObjectURL(latestAudioBlob);
            audioPlayer.src = latestAudioUrl;
            audioPlayer.hidden = false;
            audioSize.textContent = "(" + (latestAudioBlob.size / 1_000_000).toFixed(2) + " MB)";
            transcribeRecording();
        });

        recorder.start();
        stopButton.disabled = false;
        setMessage(status, "Recording...", "neutral");
    } catch(error){
        if(version !== noteVersion || !isAuthenticated)
            return;
        if(audioStream){
            audioStream.getTracks().forEach(track => track.stop());
            audioStream = null;
        }
        isRecording = false;
        updateNoteControls();
        setMessage(status, "Could not access microphone.", "error");
        console.error(error);
    }
});

stopButton.addEventListener("click", function (){
    if(!mediaRecorder || mediaRecorder.state !== "recording")
        return;
    stopButton.disabled = true;
    setMessage(status, "Preparing recording...", "neutral");
    mediaRecorder.stop();
});
// ------- audio -------


// +++++++ transcription +++++++
async function transcribeRecording(){
    if(!isAuthenticated || isRecording || isTranscribing || isSending || pendingSubmission || latestAudioBlob === null)
        return;

    const version = noteVersion;
    isTranscribing = true;
    transcribeButton.hidden = true;
    updateNoteControls();
    const formData = new FormData();
    formData.append("file", latestAudioBlob, "recording." + getFileExtension());
    setMessage(status, "Uploading and transcribing...", "neutral");

    try {
        const response = await authenticatedFetch("transcribe", {method: "POST", body: formData});
        if(!response.ok)
            throw new Error(await getErrorMessage(response, "Could not transcribe recording."));
        const result = await response.json();
        if(version !== noteVersion || !isAuthenticated)
            return;
        transcript.value = result.text;
        if(result.text.trim()){
            setMessage(status, "Transcription complete. Review your note before sending.", "success");
        } else {
            setMessage(status, "No speech detected. You can retry transcription or record again.", "warning");
        }
        transcribeButton.hidden = result.text.trim() !== "";
    } catch(error){
        if(version !== noteVersion || !isAuthenticated)
            return;
        setMessage(status, "Transcription failed: " + error.message, "error");
        transcribeButton.hidden = false;
        console.error(error);
    } finally{
        if(version === noteVersion){
            isTranscribing = false;
            updateNoteControls();
        }
    }
}

transcribeButton.addEventListener("click", transcribeRecording);

transcript.addEventListener("input", updateSendButtonState);
// ------- transcription -------


// +++++++ helper functions +++++++
function setMessage(element, message, state = "neutral"){
    element.textContent = message;
    element.dataset.state = state;
}

async function getErrorMessage(response, fallbackMessage){
    try{
        const data = await response.json();
        if(data.detail)
            return data.detail;
    } catch{
        // Response was not JSON.
    }

    return fallbackMessage;
}
// ------- helper functions -------


// +++++++ ELBUS submission +++++++
async function sendToElbus(){
    if(!isAuthenticated || isRecording || isTranscribing || isSending)
        return;
    if(!pendingSubmission){
        if(verifiedExperimentId === null){
            setMessage(status, "Please select an experiment first.", "error");
            return;
        }
        const text = transcript.value.trim();
        if(!text){
            setMessage(status, "The transcript is empty.", "error");
            return;
        }
        const includeAudio = attachAudio.checked && latestAudioBlob !== null;
        if(includeAudio && latestAudioBlob.size > 50_000_000){
            setMessage(status, "The audio exceeds 50 MB. Uncheck Attach original audio to send only the transcript.", "error");
            return;
        }
        let audioType;
        if(includeAudio){
            audioType = latestAudioBlob.type.split(";")[0].toLowerCase() || "application/octet-stream";
        } else {
            audioType = null;
        }
        pendingSubmission = {
            submission_id: crypto.randomUUID(),
            experiment_id: verifiedExperimentId,
            experiment_title: verifiedExperimentTitle,
            text,
            audio_type: audioType,
            transcriptSaved: false
        };
    }
    const submission = pendingSubmission;
    const version = noteVersion;
    isSending = true;
    updateNoteControls();

    try {
        if(!submission.transcriptSaved){
            setMessage(status, "Sending transcript to " + instanceName + "...", "neutral");
            const response = await authenticatedFetch("voice-notes", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({
                    submission_id: submission.submission_id,
                    experiment_id: submission.experiment_id,
                    text: submission.text,
                    audio_type: submission.audio_type
                })
            });
            if(!response.ok)
                throw new Error(await getErrorMessage(response, "Could not confirm the transcript was saved."));
            if(version !== noteVersion || !isAuthenticated)
                return;
            submission.transcriptSaved = true;
        }
        if(submission.audio_type){
            setMessage(status, "Transcript saved. Uploading original audio to " + instanceName + "...", "neutral");
            const response = await authenticatedFetch("voice-notes/" + submission.submission_id + "/audio", {
                method: "POST",
                headers: {"Content-Type": submission.audio_type},
                body: latestAudioBlob
            });
            if(!response.ok)
                throw new Error(await getErrorMessage(response, "Could not confirm the audio was uploaded."));
        }
        if(version === noteVersion && isAuthenticated){
            resetFormAfterSend();
            const destination = '"' + submission.experiment_title + '" (ID ' + submission.experiment_id + ')';
            if(submission.audio_type){
                setMessage(status, "Voice note and original audio added to " + destination + ". Ready for a new recording.", "success");
            } else {
                setMessage(status, "Voice note added to " + destination + ". Ready for a new recording.", "success");
            }
        }
    } catch(error){
        if(version === noteVersion && isAuthenticated){
            if(submission.transcriptSaved){
                setMessage(status, "The transcript is saved. " + error.message + " Retry the audio upload or continue without audio.", "warning");
            } else {
                setMessage(status, error.message + " Retry sending to confirm the result without duplicating the note.", "error");
            }
            console.error(error);
        }
    } finally{
        if(version === noteVersion)
            isSending = false;
        updateNoteControls();
    }
}

sendButton.addEventListener("click", sendToElbus);
continueWithoutAudioButton.addEventListener("click", function(){
    if(!isAuthenticated || isSending || pendingSubmission === null || !pendingSubmission.transcriptSaved)
        return;
    resetFormAfterSend();
    updateNoteControls();
    setMessage(status, "The transcript is saved. Audio attachment was not confirmed. Check " + instanceName + " before uploading it manually. Ready for a new recording.", "warning");
});
// ------- ELBUS submission -------


// +++++++ experiment selection +++++++
async function loadExperiments(){
    if(pendingSubmission || isSending)
        return;
    isLoadingExperiments = true;
    const requestVersion = ++experimentsRequestVersion;
    const previousId = experimentIdInput.value;
    verifiedExperimentId = null;
    verifiedExperimentTitle = null;
    experimentIdInput.replaceChildren(new Option("Loading experiments...", ""));
    experimentIdInput.disabled = true;
    refreshExperimentsButton.disabled = true;
    setMessage(experimentInfo, "Loading accessible experiments...", "neutral");
    updateSendButtonState();

    try{
        const response = await authenticatedFetch("experiments");
        if(!response.ok)
            throw new Error(await getErrorMessage(response, "Could not load experiments."));
        const result = await response.json();
        if(requestVersion !== experimentsRequestVersion || !isAuthenticated)
            return;

        let placeholder;
        if(result.experiments.length){
            placeholder = "Select an experiment";
        } else {
            placeholder = "No accessible experiments";
        }
        experimentIdInput.replaceChildren(new Option(placeholder, ""));
        for(const experiment of result.experiments){
            let title = experiment.title;
            if(experiment.fullname){
                title += " by " + experiment.fullname;
            }
            const option = new Option(title + " (ID " + experiment.id + ")", String(experiment.id));
            option.dataset.title = title;
            experimentIdInput.add(option);
        }
        experimentIdInput.disabled = result.experiments.length === 0;
        if([...experimentIdInput.options].some(option => option.value === previousId))
            experimentIdInput.value = previousId;
        selectExperiment();
        if(!result.experiments.length)
            setMessage(experimentInfo, "No experiments are accessible with this API key.", "warning");
    } catch(error){
        if(requestVersion !== experimentsRequestVersion || !isAuthenticated)
            return;
        experimentIdInput.replaceChildren(new Option("Could not load experiments", ""));
        setMessage(experimentInfo, error.message + " Try refreshing the experiments.", "error");
    } finally{
        if(requestVersion === experimentsRequestVersion){
            isLoadingExperiments = false;
            updateNoteControls();
        }
    }
}

function selectExperiment(){
    const option = experimentIdInput.selectedOptions[0];
    if(option && option.value){
        verifiedExperimentId = Number(option.value);
        verifiedExperimentTitle = option.dataset.title;
        setMessage(experimentInfo, 'Selected experiment: "' + verifiedExperimentTitle + '" (ID ' + verifiedExperimentId + ')', "neutral");
    } else {
        verifiedExperimentId = null;
        verifiedExperimentTitle = null;
        setMessage(experimentInfo, "No experiment selected.", "neutral");
    }
    updateSendButtonState();
}

refreshExperimentsButton.addEventListener("click", loadExperiments);
experimentIdInput.addEventListener("change", selectExperiment);
// ------- experiment selection -------


// initial page state
setAuthenticated(false);
checkAuthentication();
