// STT (Speech-to-Text) via whisper.cpp / faster-whisper
// On-demand: lastes bare når brukeren trykker stemmeknappen
// Frigjør RAM mellom bruk — kritisk for RPI5 8GB
//
// Støtter to backends:
//   1. whisper.cpp CLI (anbefalt for RPI5 — lettest på RAM)
//   2. faster-whisper HTTP server (mer funksjonalitet, tyngre)
//
// Installasjon whisper.cpp:
//   git clone https://github.com/ggerganov/whisper.cpp
//   cd whisper.cpp && make -j4
//   bash models/download-ggml-model.sh base
//   # For NB-Whisper (norsk-optimalisert):
//   wget https://huggingface.co/NbAiLab/nb-whisper-base/resolve/main/ggml-model.bin -O models/ggml-nb-whisper-base.bin

const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

// === Konfigurasjon ===
const STT_BACKEND = process.env.STT_BACKEND || 'whisper_cpp'; // 'whisper_cpp' eller 'faster_whisper'
const WHISPER_CPP_PATH = process.env.WHISPER_CPP_PATH || '/opt/whisper.cpp/main';
const WHISPER_MODEL_PATH =
  process.env.WHISPER_MODEL_PATH || '/opt/whisper.cpp/models/ggml-nb-whisper-base.bin';
const FASTER_WHISPER_HOST = process.env.FASTER_WHISPER_HOST || 'http://localhost:8787';
const WHISPER_LANGUAGE = process.env.WHISPER_LANGUAGE || 'no';
const WHISPER_THREADS = parseInt(process.env.WHISPER_THREADS || '3'); // Hold nede for temperatur
const TEMP_DIR = path.join(__dirname, '..', 'data', 'tmp');

function log(msg) {
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  console.log(`[STT ${ts}] ${msg}`);
}

function ensureTempDir() {
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// === whisper.cpp CLI backend ===

function transcribeWithWhisperCpp(audioBuffer, format = 'wav') {
  return new Promise((resolve, reject) => {
    ensureTempDir();
    const tempFile = path.join(TEMP_DIR, `stt_${Date.now()}.${format}`);

    // Skriv audio-buffer til temp-fil
    fs.writeFileSync(tempFile, audioBuffer);

    // Konverter til 16kHz WAV om nødvendig (whisper.cpp krever dette)
    const wavFile = tempFile.endsWith('.wav') ? tempFile : tempFile + '.wav';
    const needsConvert = !tempFile.endsWith('.wav');

    const doTranscribe = () => {
      const args = [
        '-m',
        WHISPER_MODEL_PATH,
        '-f',
        wavFile,
        '-l',
        WHISPER_LANGUAGE,
        '-t',
        String(WHISPER_THREADS),
        '--no-timestamps',
        '-otxt', // Output som ren tekst
      ];

      log(`Starter transkribering: ${WHISPER_CPP_PATH} ${args.join(' ')}`);
      const startTime = Date.now();

      execFile(WHISPER_CPP_PATH, args, { timeout: 30000 }, (error, stdout, stderr) => {
        // Rydd opp temp-filer
        try {
          fs.unlinkSync(tempFile);
        } catch {}
        if (needsConvert) {
          try {
            fs.unlinkSync(wavFile);
          } catch {}
        }
        try {
          fs.unlinkSync(wavFile + '.txt');
        } catch {} // whisper output

        if (error) {
          log(`Transkribering feilet: ${error.message}`);
          return reject(new Error(`whisper.cpp feilet: ${error.message}`));
        }

        const elapsed = Date.now() - startTime;
        // whisper.cpp -otxt skriver til .txt-fil, men vi leser stdout
        const text = (stdout || '').trim();
        log(`Transkribering ferdig på ${elapsed}ms: "${text.slice(0, 80)}..."`);

        resolve({
          text,
          language: WHISPER_LANGUAGE,
          duration_ms: elapsed,
          backend: 'whisper.cpp',
        });
      });
    };

    if (needsConvert) {
      // Bruk ffmpeg for konvertering (finnes på de fleste RPI-installasjoner)
      execFile(
        'ffmpeg',
        [
          '-i',
          tempFile,
          '-ar',
          '16000', // 16kHz
          '-ac',
          '1', // mono
          '-c:a',
          'pcm_s16le',
          wavFile,
          '-y', // overwrite
        ],
        { timeout: 10000 },
        (err) => {
          if (err) {
            try {
              fs.unlinkSync(tempFile);
            } catch {}
            return reject(new Error(`ffmpeg konvertering feilet: ${err.message}`));
          }
          doTranscribe();
        }
      );
    } else {
      doTranscribe();
    }
  });
}

// === faster-whisper HTTP backend ===

function transcribeWithFasterWhisper(audioBuffer) {
  return new Promise((resolve, reject) => {
    const boundary = '----FormBoundary' + Date.now();
    const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n`;
    const footer = `\r\n--${boundary}--\r\n`;

    const body = Buffer.concat([Buffer.from(header), audioBuffer, Buffer.from(footer)]);

    const url = new URL(FASTER_WHISPER_HOST + '/v1/audio/transcriptions');
    const reqOpts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
      timeout: 30000,
    };

    const startTime = Date.now();
    const req = http.request(reqOpts, (res) => {
      let data = '';
      res.on('data', (c) => {
        data += c;
      });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const elapsed = Date.now() - startTime;
          log(`faster-whisper transkribering på ${elapsed}ms`);
          resolve({
            text: json.text || '',
            language: json.language || WHISPER_LANGUAGE,
            duration_ms: elapsed,
            backend: 'faster-whisper',
          });
        } catch (e) {
          reject(new Error(`faster-whisper parse error: ${e.message}`));
        }
      });
    });

    req.on('error', (e) => reject(new Error(`faster-whisper feil: ${e.message}`)));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('faster-whisper timeout'));
    });
    req.write(body);
    req.end();
  });
}

// === Sjekk tilgjengelighet ===

async function isSTTAvailable() {
  if (STT_BACKEND === 'whisper_cpp') {
    const modelExists = fs.existsSync(WHISPER_MODEL_PATH);
    const binaryExists = fs.existsSync(WHISPER_CPP_PATH);
    return {
      available: modelExists && binaryExists,
      backend: 'whisper.cpp',
      model: path.basename(WHISPER_MODEL_PATH),
      modelPath: WHISPER_MODEL_PATH,
      binaryPath: WHISPER_CPP_PATH,
      missing: (!binaryExists ? ['whisper.cpp binary'] : []).concat(!modelExists ? ['modell'] : []),
    };
  }

  // faster-whisper — ping health endpoint
  return new Promise((resolve) => {
    const url = new URL(FASTER_WHISPER_HOST);
    const req = http.get(
      {
        hostname: url.hostname,
        port: url.port,
        path: '/health',
        timeout: 3000,
      },
      (res) => {
        resolve({ available: res.statusCode === 200, backend: 'faster-whisper' });
      }
    );
    req.on('error', () => resolve({ available: false, backend: 'faster-whisper' }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ available: false, backend: 'faster-whisper' });
    });
  });
}

// === Hovedfunksjon ===

const VALID_FORMATS = new Set(['wav', 'mp3', 'ogg', 'flac', 'webm', 'm4a']);

async function transcribe(audioBuffer, options = {}) {
  const format = VALID_FORMATS.has(options.format) ? options.format : 'wav';

  if (STT_BACKEND === 'faster_whisper') {
    return transcribeWithFasterWhisper(audioBuffer);
  }

  return transcribeWithWhisperCpp(audioBuffer, format);
}

module.exports = {
  transcribe,
  isSTTAvailable,
  STT_BACKEND,
  WHISPER_CPP_PATH,
  WHISPER_MODEL_PATH,
};
