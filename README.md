# Skool Live Transcript

Local tool to join Skool live calls and generate timestamped transcripts with speaker attribution.

## How it works

1. Puppeteer (headless Chrome) joins the call with mic/camera off
2. PipeWire virtual sink captures call audio to WAV
3. MutationObserver tracks who's speaking (yellow border = dominant speaker)
4. After the call ends, whisper.cpp transcribes the audio
5. Speaker timeline is merged with transcription timestamps
6. Output: `live-transcript/skool-live-<slug>-<timestamp>.txt`

## Prerequisites

- Node.js 20+
- Google Chrome
- PipeWire (with pw-record, pw-cli)
- cmake, g++ (for building whisper.cpp)
- ffmpeg

## Setup

```bash
npm install
npm run setup   # builds whisper.cpp, downloads tiny.en model (31 MiB)
```

## Usage

### 1. Login (one time)

```bash
npm run login
```

Opens Chrome. Log into Skool, then press Enter in the terminal. Cookies are saved to `.cookies.json`.

### 2. Record a call

```bash
npm run record -- --url "https://www.skool.com/live/xZ2hSP83Brz"
```

Or directly:

```bash
node index.js --url "https://www.skool.com/live/xZ2hSP83Brz"
```

### Auth options

| Flag | Description |
|------|-------------|
| (none) | Uses saved cookies from `--login` |
| `--chrome-profile <path>` | Use Chrome user data dir (close Chrome first) |
| `--auth-cookie "<header>"` | Raw Cookie header string |

### Auto-exit

The bot leaves the call after being the only participant for 60 seconds. Press `Ctrl+C` to stop manually at any time.

## Output

Transcripts are saved in `live-transcript/`:

```
[00:00:12] John Doe:
  Welcome everyone to today's Q&A.

[00:00:45] Jane Doe:
  Hey John, I have a question about...
```

Audio (WAV) and speaker logs (JSONL) are also saved for manual re-processing.

## Stack

- **Browser**: Puppeteer + Chrome (headless)
- **Audio**: PipeWire virtual sink + pw-record (16kHz mono)
- **Transcription**: whisper.cpp with ggml-tiny.en-q5_1 (31 MiB, English-only)
- **Speaker detection**: DOM MutationObserver on Skool's dominant-speaker class
