const path = require('path');
const fs = require('fs');
const audio = require('./lib/audio');
const browser = require('./lib/browser');
const { transcribe } = require('./lib/transcribe');
const { loadSpeakerLog, mergeTranscript } = require('./lib/merge');
const log = require('./lib/log');

const COOKIE_FILE = path.join(__dirname, '.cookies.json');

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) {
      parsed.url = args[++i];
    } else if (args[i] === '--auth-cookie' && args[i + 1]) {
      parsed.authCookie = args[++i];
    } else if (args[i] === '--chrome-profile' && args[i + 1]) {
      parsed.chromeProfile = args[++i];
    } else if (args[i] === '--login') {
      parsed.login = true;
    }
  }

  if (parsed.login) return parsed;

  if (!parsed.url) {
    console.error('Usage:');
    console.error('  node index.js --login                              Save Skool session cookies');
    console.error('  node index.js --url <skool-live-url>               Use saved cookies');
    console.error('  node index.js --url <skool-live-url> --chrome-profile <path>');
    console.error('  node index.js --url <skool-live-url> --auth-cookie "<cookie-header>"');
    process.exit(1);
  }

  // Auto-load saved cookies if no auth method specified
  if (!parsed.authCookie && !parsed.chromeProfile) {
    if (fs.existsSync(COOKIE_FILE)) {
      parsed.savedCookies = true;
    } else {
      console.error('ERROR: No auth method. Run "node index.js --login" first,');
      console.error('       or provide --auth-cookie or --chrome-profile.');
      process.exit(1);
    }
  }

  return parsed;
}

async function loginFlow() {
  const puppeteer = require('puppeteer');
  console.log('[login] Opening browser - log into Skool, then press Enter here...');

  const loginBrowser = await puppeteer.launch({
    headless: false,
    executablePath: '/usr/bin/google-chrome',
    args: ['--window-size=1280,720', '--no-sandbox'],
  });

  const page = await loginBrowser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto('https://www.skool.com/login', { waitUntil: 'networkidle2' });

  // Wait for user to press Enter in terminal
  await new Promise((resolve) => {
    process.stdin.once('data', resolve);
  });

  // Save all cookies for skool.com
  const cookies = await page.cookies('https://www.skool.com', 'https://api2.skool.com');
  fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2));
  console.log(`[login] Saved ${cookies.length} cookies to ${COOKIE_FILE}`);

  await loginBrowser.close();
}

function extractSlug(url) {
  const match = url.match(/\/live\/([^/?#]+)/);
  return match ? match[1] : 'unknown';
}

async function main() {
  const parsed = parseArgs();

  if (parsed.login) {
    await loginFlow();
    return;
  }

  const { url, authCookie, chromeProfile, savedCookies } = parsed;
  const slug = extractSlug(url);
  const timestamp = Math.floor(Date.now() / 1000);

  const outputDir = path.join(__dirname, 'live-transcript');
  fs.mkdirSync(outputDir, { recursive: true });

  const baseName = `skool-live-${slug}-${timestamp}`;
  const audioPath = path.join(outputDir, `${baseName}.wav`);
  const speakerLogPath = path.join(outputDir, `${baseName}.jsonl`);
  const transcriptPath = path.join(outputDir, `${baseName}.txt`);
  const auditLogPath = path.join(outputDir, `${baseName}.log`);

  log.init(auditLogPath);

  let browserInstance = null;
  let pageInstance = null;
  let speakerLogStream = null;
  let callStartTime = null;

  // Graceful shutdown
  let shuttingDown = false;
  async function shutdown(reason) {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`[main] Shutting down (${reason})...`);

    await audio.stopRecording();

    if (browserInstance && pageInstance && speakerLogStream) {
      await browser.closeBrowser(browserInstance, pageInstance, speakerLogStream);
    }

    audio.cleanup();

    // Run transcription if we have audio
    if (fs.existsSync(audioPath)) {
      const stats = fs.statSync(audioPath);
      log.info(`[main] Audio file size: ${(stats.size / 1024).toFixed(1)} KB`);
      if (stats.size > 1000) {
        log.info('[main] Starting transcription...');
        try {
          const segments = await transcribe(audioPath);
          const speakerData = loadSpeakerLog(speakerLogPath);
          const startTime = speakerData.callStartTime || callStartTime || timestamp * 1000;
          const output = mergeTranscript(segments, speakerData.events, startTime);
          fs.writeFileSync(transcriptPath, output);
          log.info(`[main] Transcript saved to ${transcriptPath}`);
        } catch (err) {
          log.error(`[main] Transcription failed: ${err.message}`);
          log.info(`[main] Audio saved at ${audioPath} - you can transcribe manually`);
        }
      } else {
        log.info('[main] Audio file too small, skipping transcription');
      }
    }

    log.close();
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  try {
    // 1. Create virtual audio sink
    log.info('[main] Setting up audio capture...');
    audio.createVirtualSink();

    // 2. Start recording (before browser so we don't miss anything)
    audio.startRecording(audioPath);

    // 3. Launch browser and join call
    log.info('[main] Launching browser...');
    let cookiesFromFile = null;
    if (savedCookies) {
      cookiesFromFile = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf-8'));
      log.info(`[main] Loaded ${cookiesFromFile.length} saved cookies`);
    }

    const result = await browser.launch(url, authCookie, speakerLogPath, {
      userDataDir: chromeProfile,
      cookiesFromFile,
    });
    browserInstance = result.browser;
    pageInstance = result.page;
    speakerLogStream = result.speakerLog;

    callStartTime = Date.now();
    // Persist call start time as first event in speaker log
    speakerLogStream.write(JSON.stringify({ event: 'call_start', time: callStartTime }) + '\n');
    log.info(`[main] Call started at ${new Date(callStartTime).toISOString()}`);
    log.info('[main] Recording... Press Ctrl+C to stop manually');

    // 4. Wait for call to end
    await browser.waitForCallEnd(pageInstance);

    // 5. Shutdown and transcribe
    await shutdown('call ended');
  } catch (err) {
    log.error(`[main] ${err.message}`);
    await shutdown('error');
    process.exit(1);
  }
}

main();
