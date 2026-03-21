const { spawn, execSync } = require('child_process');
const path = require('path');
const log = require('./log');

let sinkNodeId = null;
let recordProcess = null;

function createVirtualSink() {
  cleanupStale();

  try {
    execSync(
      `pw-cli create-node adapter '{ factory.name=support.null-audio-sink node.name=skool_recorder node.description="Skool Recorder" media.class=Audio/Sink object.linger=true audio.position=[FL,FR] }'`,
      { encoding: 'utf-8', timeout: 5000 }
    );
  } catch (err) {
    log.error(`[audio] Failed to create virtual sink: ${err.message}`);
    return null;
  }

  return findSinkId();
}

function findSinkId() {
  try {
    const result = execSync(`wpctl status`, { encoding: 'utf-8', timeout: 5000 });
    const match = result.match(/(\d+)\.\s*Skool Recorder/);
    if (match) {
      sinkNodeId = match[1];
      log.info(`[audio] Virtual sink ready (node ${sinkNodeId})`);
      return sinkNodeId;
    }
  } catch (_) {}

  log.error('[audio] Could not find virtual sink ID');
  return null;
}

function cleanupStale() {
  try {
    const result = execSync(`wpctl status`, { encoding: 'utf-8', timeout: 5000 });
    const match = result.match(/(\d+)\.\s*Skool Recorder/);
    if (match) {
      log.info(`[audio] Cleaning up stale sink (node ${match[1]})`);
      execSync(`pw-cli destroy ${match[1]}`, { timeout: 3000 });
    }
  } catch (_) {}
}

function startRecording(outputPath) {
  if (!sinkNodeId) {
    log.error('[audio] No virtual sink. Cannot record.');
    return null;
  }

  // Use ffmpeg with PulseAudio monitor source - guaranteed to capture
  // only audio played to our virtual sink (not mic)
  const args = [
    '-f', 'pulse',
    '-i', 'skool_recorder.monitor',
    '-ar', '16000',
    '-ac', '1',
    '-f', 'wav',
    '-y',
    outputPath,
  ];

  log.info(`[audio] Recording to ${path.basename(outputPath)} (source: skool_recorder.monitor)`);
  recordProcess = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });

  recordProcess.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    // ffmpeg is noisy - only log errors
    if (msg.includes('Error') || msg.includes('error')) {
      log.error(`[audio] ${msg}`);
    }
  });

  recordProcess.on('error', (err) => {
    log.error(`[audio] ffmpeg error: ${err.message}`);
  });

  return recordProcess;
}

function stopRecording() {
  return new Promise((resolve) => {
    if (!recordProcess) {
      resolve();
      return;
    }

    log.info('[audio] Stopping recording...');
    recordProcess.on('close', () => {
      recordProcess = null;
      resolve();
    });

    // Send 'q' to ffmpeg stdin for graceful shutdown (finalizes WAV header)
    recordProcess.stdin.write('q');

    setTimeout(() => {
      if (recordProcess) {
        recordProcess.kill('SIGKILL');
        recordProcess = null;
        resolve();
      }
    }, 3000);
  });
}

function destroyVirtualSink() {
  if (!sinkNodeId) return;
  try {
    execSync(`pw-cli destroy ${sinkNodeId}`, { timeout: 3000 });
    log.info('[audio] Destroyed virtual sink');
  } catch (_) {}
  sinkNodeId = null;
}

function cleanup() {
  destroyVirtualSink();
}

module.exports = { createVirtualSink, startRecording, stopRecording, cleanup };
