const { makeid, SESSION_PREFIX } = require('./id');
const { sendButtons } = require('gifted-btns');
const QRCode = require('qrcode');
const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  Browsers,
  delay,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
} = require('@whiskeysockets/baileys');

const router = express.Router();

const REPO_URL  = 'https://github.com/Davex-254/DAVE-X';
const DEV_PHONE = '+254104260236';
const MAX_RETRIES = 3;

function removeFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    fs.rmSync(filePath, { recursive: true, force: true });
  } catch (e) {
    console.error('[removeFile]', e.message);
  }
}

router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'qr.html'));
});

router.get('/generate', async (req, res) => {
  const id = makeid();
  const tempDir = path.join(__dirname, 'temp', id);
  let retryCount = 0;
  let sessionSent = false;

  const requestTimeout = setTimeout(() => {
    if (!res.headersSent) {
      res.status(504).end();
    }
    removeFile(tempDir);
  }, 60000);

  async function startQRSession() {
    if (retryCount >= MAX_RETRIES) {
      console.error('[QR] Max retries reached, giving up');
      clearTimeout(requestTimeout);
      if (!res.headersSent) res.status(503).end();
      removeFile(tempDir);
      return;
    }
    retryCount++;

    const { state, saveCreds } = await useMultiFileAuthState(tempDir);
    let { version } = await fetchLatestBaileysVersion();

    try {
      const socket = makeWASocket({
        auth: state,
        version,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: Browsers.ubuntu('Chrome'),
        connectTimeoutMs: 30000,
        defaultQueryTimeoutMs: 30000,
      });

      socket.ev.on('creds.update', saveCreds);

      socket.ev.on('connection.update', async (update) => {
        try {
          const { connection, lastDisconnect, qr } = update;

          if (qr && !res.headersSent) {
            clearTimeout(requestTimeout);
            const qrBuffer = await QRCode.toBuffer(qr, {
              type: 'png',
              width: 400,
              margin: 2,
              color: { dark: '#000000', light: '#ffffff' },
            });
            res.setHeader('Content-Type', 'image/png');
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.end(qrBuffer);
            console.log('[QR] QR code sent to browser ✓');
          }

          if (connection === 'open' && !sessionSent) {
            sessionSent = true;
            console.log('[QR] Connection open — sending session ID...');
            await delay(5000);

            const credsPath = path.join(tempDir, 'creds.json');

            let retries = 10;
            while (!fs.existsSync(credsPath) && retries-- > 0) {
              await delay(1000);
            }

            if (!fs.existsSync(credsPath)) {
              console.error('[QR] creds.json not found after retries');
              await socket.ws.close();
              removeFile(tempDir);
              return;
            }

            const credsData = fs.readFileSync(credsPath);
            const sessionId = SESSION_PREFIX + Buffer.from(credsData).toString('base64');

            const selfJid = jidNormalizedUser(socket.user.id);
            console.log(`[QR] Sending session to JID: ${selfJid}`);

            await socket.sendMessage(selfJid, { text: sessionId });
            console.log('[QR] Session ID sent ✓');

            try {
              await sendButtons(socket, selfJid, {
                title: '🤖 DAVE-X Session Ready',
                text:
                  '✅ *Your session ID has been generated!*\n\n' +
                  'Copy the message above and set it as *SESSION_ID* in your bot config.\n\n' +
                  '_Tap a button below for quick actions:_',
                footer: 'DAVE-X Bot • Powered by GiftedTech',
                buttons: [
                  {
                    name: 'cta_copy',
                    buttonParamsJson: JSON.stringify({
                      display_text: '📋 Copy Session ID',
                      copy_code: sessionId,
                    }),
                  },
                  {
                    name: 'cta_url',
                    buttonParamsJson: JSON.stringify({
                      display_text: '🌐 Visit Repo',
                      url: REPO_URL,
                      merchant_url: REPO_URL,
                    }),
                  },
                  {
                    name: 'cta_call',
                    buttonParamsJson: JSON.stringify({
                      display_text: '📞 Contact Developer',
                      phone_number: DEV_PHONE,
                    }),
                  },
                  {
                    name: 'cta_url',
                    buttonParamsJson: JSON.stringify({
                      display_text: '📖 Documentation',
                      url: REPO_URL + '#readme',
                      merchant_url: REPO_URL + '#readme',
                    }),
                  },
                ],
              });
              console.log('[QR] Interactive buttons sent ✓');
            } catch (btnErr) {
              console.error('[QR] sendButtons error (session was already sent):', btnErr.message);
            }

            await delay(1000);
            await socket.ws.close();
            removeFile(tempDir);

          } else if (connection === 'close') {
            const code = lastDisconnect?.error?.output?.statusCode;
            console.log(`[QR] Connection closed — code: ${code}`);

            if (sessionSent) {
              removeFile(tempDir);
              return;
            }

            if (res.headersSent) {
              removeFile(tempDir);
              return;
            }

            if (code === 401) {
              removeFile(tempDir);
              return;
            }

            await delay(5000);
            startQRSession();
          }
        } catch (err) {
          console.error('[QR connection.update error]', err);
          try { await socket.ws.close(); } catch (_) {}
          removeFile(tempDir);
          if (!res.headersSent) res.status(500).end();
        }
      });

    } catch (err) {
      console.error('[QR Session Error]', err);
      clearTimeout(requestTimeout);
      if (!res.headersSent) res.status(500).end();
      removeFile(tempDir);
    }
  }

  return startQRSession();
});

module.exports = router;
