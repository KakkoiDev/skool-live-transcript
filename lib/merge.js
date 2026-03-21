const fs = require('fs');

function loadSpeakerLog(jsonlPath) {
  if (!fs.existsSync(jsonlPath)) return { callStartTime: null, events: [] };

  const lines = fs.readFileSync(jsonlPath, 'utf-8').trim().split('\n');
  const parsed = lines.filter(l => l.trim()).map(l => JSON.parse(l));

  const startEvent = parsed.find(e => e.event === 'call_start');
  const callStartTime = startEvent ? startEvent.time : null;

  const events = parsed
    .filter(e => e.speaker)
    .sort((a, b) => a.time - b.time);

  return { callStartTime, events };
}

function findSpeakerAtTime(speakerEvents, callStartTime, segmentOffsetMs) {
  const absoluteTime = callStartTime + segmentOffsetMs;

  let speaker = 'Unknown';
  for (const event of speakerEvents) {
    if (event.time <= absoluteTime) {
      speaker = event.speaker;
    } else {
      break;
    }
  }
  return speaker;
}

function formatTimestamp(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
  const m = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
  const s = (totalSeconds % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function mergeTranscript(segments, speakerEvents, callStartTime) {
  const lines = [];
  let lastSpeaker = null;

  for (const seg of segments) {
    if (!seg.text || seg.text === '[BLANK_AUDIO]') continue;

    const speaker = findSpeakerAtTime(speakerEvents, callStartTime, seg.startMs);
    const ts = formatTimestamp(seg.startMs);

    if (speaker !== lastSpeaker) {
      lines.push('');
      lines.push(`[${ts}] ${speaker}:`);
      lastSpeaker = speaker;
    }

    lines.push(`  ${seg.text}`);
  }

  return lines.join('\n').trim() + '\n';
}

module.exports = { loadSpeakerLog, mergeTranscript };
