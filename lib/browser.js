const puppeteer = require('puppeteer');
const fs = require('fs');
const log = require('./log');

function parseCookies(cookieString) {
  return cookieString.split(';').map(c => {
    const eq = c.indexOf('=');
    if (eq === -1) return null;
    return {
      name: c.substring(0, eq).trim(),
      value: c.substring(eq + 1).trim(),
      domain: '.skool.com',
      path: '/',
    };
  }).filter(Boolean);
}

async function launch(url, authCookie, speakerLogPath, opts = {}) {
  const launchOpts = {
    headless: false,
    executablePath: '/usr/bin/google-chrome',
    args: [
      '--window-size=1280,720',
      '--autoplay-policy=no-user-gesture-required',
      '--use-fake-ui-for-media-stream',
      '--disable-features=WebRtcHideLocalIpsWithMdns',
      '--no-sandbox',
    ],
    env: {
      ...process.env,
      PULSE_SINK: 'skool_recorder',
    },
  };

  if (opts.userDataDir) {
    launchOpts.userDataDir = opts.userDataDir;
  }

  const browser = await puppeteer.launch(launchOpts);

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  if (authCookie) {
    const cookies = parseCookies(authCookie);
    if (cookies.length > 0) {
      await page.setCookie(...cookies);
    }
  } else if (opts.cookiesFromFile) {
    await page.setCookie(...opts.cookiesFromFile);
  }

  // Expose function for speaker change events from MutationObserver
  const speakerLog = fs.createWriteStream(speakerLogPath, { flags: 'a' });

  await page.exposeFunction('__onSpeakerChange', (name, timestamp) => {
    const entry = JSON.stringify({ speaker: name, time: timestamp }) + '\n';
    speakerLog.write(entry);
    log.info(`[speaker] ${name}`);
  });

  log.info(`[browser] Navigating to ${url}`);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

  log.info('[browser] Muting mic and camera...');
  try {
    await page.locator('[data-testid="preview-audio-mute-button"]').setTimeout(10000).click();
    log.info('[browser] Mic muted');
  } catch (_) {
    log.info('[browser] Mic mute button not found (may already be muted)');
  }

  try {
    await page.locator('[data-testid="preview-video-mute-button"]').setTimeout(5000).click();
    log.info('[browser] Camera muted');
  } catch (_) {
    log.info('[browser] Video mute button not found (may already be muted)');
  }

  log.info('[browser] Joining call...');
  await page.locator('::-p-aria(JOIN CALL)').setTimeout(10000).click();

  log.info('[browser] Waiting for call to connect...');
  await page.waitForSelector('.str-video__paginated-grid-layout', { timeout: 30000 });
  log.info('[browser] Connected to call');

  // Inject MutationObserver for speaker detection
  await page.evaluate(() => {
    let currentSpeaker = null;

    function getSpeakerName(participantView) {
      const img = participantView.querySelector('img.str-video__video-placeholder__avatar');
      if (img && img.alt) return img.alt;
      const label = participantView.querySelector('[class*="ParticipantLabel"] span');
      if (label) return label.textContent;
      return null;
    }

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type !== 'attributes' || mutation.attributeName !== 'class') continue;

        const el = mutation.target;
        if (!el.matches || !el.matches('[data-testid="participant-view"]')) continue;

        const isSpeaking = el.classList.contains('str-video__participant-view--dominant-speaker');
        if (isSpeaking) {
          const name = getSpeakerName(el);
          if (name && name !== currentSpeaker) {
            currentSpeaker = name;
            window.__onSpeakerChange(name, Date.now());
          }
        }
      }
    });

    const grid = document.querySelector('.str-video__paginated-grid-layout');
    if (grid) {
      observer.observe(grid, {
        attributes: true,
        attributeFilter: ['class'],
        subtree: true,
        childList: true,
      });

      const activeSpeaker = grid.querySelector(
        '[data-testid="participant-view"].str-video__participant-view--dominant-speaker'
      );
      if (activeSpeaker) {
        const name = getSpeakerName(activeSpeaker);
        if (name) {
          currentSpeaker = name;
          window.__onSpeakerChange(name, Date.now());
        }
      }
    }
  });

  log.info('[browser] Speaker observer active');

  return { browser, page, speakerLog };
}

async function getParticipantCount(page) {
  try {
    return await page.evaluate(() => {
      const icon = document.querySelector('.str-video__icon--participants');
      if (!icon) return null;
      const text = icon.parentElement.textContent.trim();
      const num = parseInt(text.replace(/\D/g, ''), 10);
      return isNaN(num) ? null : num;
    });
  } catch (_) {
    return null;
  }
}

function waitForCallEnd(page, timeoutMs = 60000) {
  return new Promise((resolve) => {
    let aloneStart = null;
    const checkInterval = 10000;

    const interval = setInterval(async () => {
      const count = await getParticipantCount(page);

      if (count !== null && count <= 1) {
        if (!aloneStart) {
          aloneStart = Date.now();
          log.info('[browser] Only participant remaining, waiting 60s before exiting...');
        } else if (Date.now() - aloneStart >= timeoutMs) {
          clearInterval(interval);
          log.info('[browser] Alone for 60s, ending call');
          resolve('alone');
        }
      } else {
        if (aloneStart) {
          log.info('[browser] Other participants rejoined');
        }
        aloneStart = null;
      }
    }, checkInterval);

    page.on('framenavigated', () => {
      clearInterval(interval);
      log.info('[browser] Page navigated away, call likely ended');
      resolve('navigated');
    });

    page.__callEndInterval = interval;
  });
}

async function closeBrowser(browser, page, speakerLog) {
  if (page.__callEndInterval) {
    clearInterval(page.__callEndInterval);
  }
  speakerLog.end();
  try {
    await browser.close();
  } catch (_) {}
  log.info('[browser] Closed');
}

module.exports = { launch, waitForCallEnd, closeBrowser, getParticipantCount };
