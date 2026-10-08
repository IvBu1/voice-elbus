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
        sendButton.textContent = "Add transcript to ELBUS";
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
        loginStatus.textContent = "Connected to ELBUS.";
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
        loginStatus.textContent = "Not connected to ELBUS.";
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
    status.textContent = "Voice note added to ELBUS. " + "Ready for a new recording.";
}

function resetWorkflow(){
    transcript.value = "";
    experimentIdInput.value = "";
    verifiedExperimentId = null;
    verifiedExperimentTitle = null;
    experimentInfo.textContent = "No experiment selected.";
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
        const message = "Your ELBUS session has expired. Please connect again.";
        loginStatus.textContent = message;
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
            status.textContent = "Ready.";
            await loadExperiments();
        }
        else{
            status.textContent = "Connect to ELBUS to begin.";
            if(result.reason === "Session expired.")
                loginStatus.textContent = "Your ELBUS session has expired. Please connect again.";
        }
    } catch{
        setAuthenticated(false);
        loginStatus.textContent = "Could not contact the server.";
    }
}

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
            const response = await fetch("auth/login", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                credentials: "same-origin",
                body: JSON.stringify({api_key: apiKey})
            });

            if(!response.ok){
                const message = await getErrorMessage(response, "Could not connect to ELBUS.");
                throw new Error(message);
            }

            // remove the API key from the input as soon as authentication succeeds
            apiKeyInput.value = "";
            setAuthenticated(true);
            status.textContent = "Ready.";
            await loadExperiments();
        } catch(error){
            setAuthenticated(false);
            loginStatus.textContent = error.message;
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
        loginStatus.textContent = "Disconnecting from ELBUS...";

        try {
            await fetch("auth/logout", {
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
    status.textContent = "Opening microphone...";

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
        status.textContent = "Recording...";
    } catch(error){
        if(version !== noteVersion || !isAuthenticated)
            return;
        if(audioStream){
            audioStream.getTracks().forEach(track => track.stop());
            audioStream = null;
        }
        isRecording = false;
        updateNoteControls();
        status.textContent = "Could not access microphone.";
        console.error(error);
    }
});

stopButton.addEventListener("click", function (){
    if(!mediaRecorder || mediaRecorder.state !== "recording")
        return;
    stopButton.disabled = true;
    status.textContent = "Preparing recording...";
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
    status.textContent = "Uploading and transcribing...";

    try {
        const response = await authenticatedFetch("transcribe", {method: "POST", body: formData});
        if(!response.ok)
            throw new Error(await getErrorMessage(response, "Could not transcribe recording."));
        const result = await response.json();
        if(version !== noteVersion || !isAuthenticated)
            return;
        transcript.value = result.text;
        if(result.text.trim()){
            status.textContent = "Transcription complete. Review your note before sending.";
        } else {
            status.textContent = "No speech detected. You can retry transcription or record again.";
        }
        transcribeButton.hidden = result.text.trim() !== "";
    } catch(error){
        if(version !== noteVersion || !isAuthenticated)
            return;
        status.textContent = "Transcription failed: " + error.message;
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
            status.textContent = "Please select an experiment first.";
            return;
        }
        const text = transcript.value.trim();
        if(!text){
            status.textContent = "The transcript is empty.";
            return;
        }
        const includeAudio = attachAudio.checked && latestAudioBlob !== null;
        if(includeAudio && latestAudioBlob.size > 50_000_000){
            status.textContent = "The audio exceeds 50 MB. Uncheck Attach original audio to send only the transcript.";
            return;
        }
        let confirmationMessage = 'Add this voice note';
        if(includeAudio){
            confirmationMessage += ' and its original audio';
        }
        confirmationMessage += ' to "' + verifiedExperimentTitle + '" (ID ' + verifiedExperimentId + ')?';
        const confirmed = window.confirm(confirmationMessage);
        if(!confirmed){
            status.textContent = "Send cancelled.";
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
            status.textContent = "Sending transcript to ELBUS...";
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
            status.textContent = "Transcript saved. Uploading original audio to ELBUS...";
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
            if(submission.audio_type){
                status.textContent = "Voice note and original audio added to ELBUS. Ready for a new recording.";
            } else {
                status.textContent = "Voice note added to ELBUS. Ready for a new recording.";
            }
        }
    } catch(error){
        if(version === noteVersion && isAuthenticated){
            if(submission.transcriptSaved){
                status.textContent = "The transcript is saved. " + error.message + " Retry the audio upload or continue without audio.";
            } else {
                status.textContent = error.message + " Retry sending to confirm the result without duplicating the note.";
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
    status.textContent = "The transcript is saved. Audio attachment was not confirmed; check ELBUS before uploading it manually. Ready for a new recording.";
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
    experimentInfo.textContent = "Loading accessible experiments...";
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
            experimentInfo.textContent = "No experiments are accessible with this API key.";
    } catch(error){
        if(requestVersion !== experimentsRequestVersion || !isAuthenticated)
            return;
        experimentIdInput.replaceChildren(new Option("Could not load experiments", ""));
        experimentInfo.textContent = error.message + " Try refreshing the experiments.";
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
        experimentInfo.textContent = 'Selected experiment: "' + verifiedExperimentTitle + '" (ID ' + verifiedExperimentId + ')';
    } else {
        verifiedExperimentId = null;
        verifiedExperimentTitle = null;
        experimentInfo.textContent = "No experiment selected.";
    }
    updateSendButtonState();
}

refreshExperimentsButton.addEventListener("click", loadExperiments);
experimentIdInput.addEventListener("change", selectExperiment);
// ------- experiment selection -------


// initial page state
setAuthenticated(false);
checkAuthentication();
