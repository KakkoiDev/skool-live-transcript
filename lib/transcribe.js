const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const log = require('./log');

const WHISPER_BIN = path.join(__dirname, '..', 'vendor', 'whisper.cpp', 'build', 'bin', 'whisper-cli');
const MODEL_PATH = path.join(__dirname, '..', 'vendor', 'whisper.cpp', 'models', 'ggml-tiny.en-q5_1.bin');

function transcribe(wavPath) {
  if (!fs.existsSync(WHISPER_BIN)) {
    throw new Error(`whisper-cli not found at ${WHISPER_BIN}. Run: npm run setup`);
  }
  if (!fs.existsSync(MODEL_PATH)) {
    throw new Error(`Model not found at ${MODEL_PATH}. Run: npm run setup`);
  }

  const stats = fs.statSync(wavPath);
  const durationEstimate = Math.round(stats.size / 32000); // 16kHz mono 16bit = 32KB/s
  log.info(`[transcribe] Processing ${path.basename(wavPath)} (~${durationEstimate}s audio)...`);

  return new Promise((resolve, reject) => {
    const proc = spawn(WHISPER_BIN, [
      '-m', MODEL_PATH,
      '-f', wavPath,
      '-l', 'en',
      '-t', '4',
      '--print-progress',
      '--no-speech-thold', '0.3',
    ]);

    let stdout = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg.includes('progress')) {
        log.info(`[transcribe] ${msg}`);
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`whisper-cli failed to start: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`whisper-cli exited with code ${code}`));
        return;
      }
      resolve(parseWhisperOutput(stdout));
    });
  });
}

function parseWhisperOutput(output) {
  const segments = [];
  const lineRegex = /\[(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})\]\s*(.*)/;

  for (const line of output.split('\n')) {
    const match = line.match(lineRegex);
    if (match) {
      segments.push({
        start: match[1],
        end: match[2],
        text: match[3].trim(),
        startMs: timestampToMs(match[1]),
        endMs: timestampToMs(match[2]),
      });
    }
  }

  log.info(`[transcribe] Got ${segments.length} segments`);
  return segments;
}

function timestampToMs(ts) {
  const [h, m, rest] = ts.split(':');
  const [s, ms] = rest.split('.');
  return (parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s)) * 1000 + parseInt(ms);
}

module.exports = { transcribe };
