/* eslint-disable no-undef, no-unused-vars, no-empty -- classic script shares globals across public/js/*.js */
// === VOICE — prøver backend STT (whisper.cpp) først, fallback til Web Speech API ===
let useBackendSTT = false; // Settes av checkLlmStatus
let mediaRecorder = null;
let audioChunks = [];

function initVoice() {
  // Sjekk om backend STT er tilgjengelig (satt i checkLlmStatus)
  // Web Speech API som fallback
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognition && !useBackendSTT) {
    recognition = new SpeechRecognition();
    recognition.lang = 'no-NO';
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      document.getElementById('chatInput').value = transcript;
      if (event.results[event.results.length - 1].isFinal) {
        stopVoice();
        sendChat();
      }
    };

    recognition.onerror = (event) => {
      const statusEl = document.getElementById('voiceStatus');
      statusEl.style.display = 'block';
      statusEl.textContent =
        event.error === 'not-allowed'
          ? 'Mikrofonrettigheter mangler — gi tilgang i nettleseren'
          : `Stemmefeil: ${event.error}`;
      stopVoice();
    };

    recognition.onend = () => {
      stopVoice();
    };
  }
}

function toggleVoice() {
  if (isRecording) {
    stopVoice();
  } else {
    startVoice();
  }
}

async function startVoice() {
  isRecording = true;
  const btn = document.getElementById('voiceBtn');
  btn.classList.add('recording');
  btn.textContent = '⏹';
  const statusEl = document.getElementById('voiceStatus');
  statusEl.style.display = 'block';

  if (useBackendSTT) {
    // Backend STT via whisper.cpp — ta opp lyd via MediaRecorder
    statusEl.textContent = 'Tar opp... snakk nå (whisper.cpp)';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];
      mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data);
      };
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        statusEl.textContent = 'Transkriberer...';
        const blob = new Blob(audioChunks, { type: 'audio/webm' });
        try {
          const response = await fetch(API + '/api/stt/transcribe', {
            method: 'POST',
            headers: { 'Content-Type': 'audio/webm' },
            body: blob,
          });
          const data = await response.json();
          if (data.text) {
            document.getElementById('chatInput').value = data.text;
            statusEl.textContent = `✓ Transkribert (${data.duration_ms}ms)`;
            setTimeout(() => {
              statusEl.style.display = 'none';
            }, 2000);
            sendChat();
          } else {
            statusEl.textContent = data.error || 'Ingen tekst gjenkjent';
          }
        } catch (err) {
          statusEl.textContent = `STT-feil: ${err.message}`;
        }
        stopVoiceUI();
      };
      mediaRecorder.start();
    } catch (err) {
      statusEl.textContent = `Mikrofonfeil: ${err.message}`;
      stopVoice();
    }
  } else {
    // Web Speech API fallback
    statusEl.textContent = 'Lytter... snakk nå';
    if (!recognition) {
      initVoice();
    }
    if (recognition) recognition.start();
    else {
      statusEl.textContent = 'Stemmegjenkjenning ikke støttet';
      stopVoice();
    }
  }
}

function stopVoice() {
  if (useBackendSTT && mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop(); // Triggers onstop → transcribe
    return;
  }
  stopVoiceUI();
  try {
    if (recognition) recognition.stop();
  } catch {}
}

function stopVoiceUI() {
  isRecording = false;
  const btn = document.getElementById('voiceBtn');
  btn.classList.remove('recording');
  btn.textContent = '🎤';
}
