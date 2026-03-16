const { makeid, SESSION_PREFIX } = require('./id');
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
} = require('@whiskeysockets/baileys');

const router = express.Router();

function removeFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    fs.rmSync(filePath, { recursive: true, force: true });
  } catch (e) {
    console.error('[removeFile]', e.message);
  }
}

router.get('/', async (req, res) => {
  const id = makeid();
  const tempDir = path.join(__dirname, 'temp', id);

  async function startQRSession() {
    const { state, saveCreds } = await useMultiFileAuthState(tempDir);

    try {
      const socket = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: Browsers.macOS('Desktop'),
      });

      socket.ev.on('creds.update', saveCreds);

      socket.ev.on('connection.update', async (update) => {
        try {
          const { connection, lastDisconnect, qr } = update;

          if (qr) {
            if (!res.headersSent) {
              const qrBuffer = await QRCode.toBuffer(qr);
              res.end(qrBuffer);
            }
          }

          if (connection === 'open') {
            console.log('[QR] Connection open — sending session ID...');
            await delay(5000);

            const credsPath = path.join(tempDir, 'creds.json');

            // Wait until creds.json actually exists
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

            const sessionMsg = await socket.sendMessage(socket.user.id, { text: sessionId });
            console.log('[QR] Session ID sent ✓');

            const infoText =
              `╔══════════════════════╗\n` +
              `║   SESSION GENERATED   ║\n` +
              `╠══════════════════════╣\n` +
              `║ Bot    : JUNE-X       ║\n` +
              `║ Type   : Base64       ║\n` +
              `║ Status : Active ✅    ║\n` +
              `╠══════════════════════╣\n` +
              `║ Copy the session ID   ║\n` +
              `║ above and set it as  ║\n` +
              `║ SESSION_ID in your   ║\n` +
              `║ bot config / Heroku. ║\n` +
              `╚══════════════════════╝\n\n` +
              `⭐ Star the repo if this helped!`;

            await socket.sendMessage(socket.user.id, { text: infoText }, { quoted: sessionMsg });
            console.log('[QR] Info message sent ✓');

            await delay(1000);
            await socket.ws.close();
            removeFile(tempDir);

          } else if (connection === 'close') {
            const code = lastDisconnect?.error?.output?.statusCode;
            console.log(`[QR] Connection closed — code: ${code}`);
            if (code !== 401) {
              await delay(10000);
              startQRSession();
            } else {
              removeFile(tempDir);
            }
          }
        } catch (err) {
          console.error('[QR connection.update error]', err);
          try { await socket.ws.close(); } catch (_) {}
          removeFile(tempDir);
        }
      });

    } catch (err) {
      console.error('[QR Session Error]', err);
      if (!res.headersSent) {
        res.json({ code: 'Service temporarily unavailable. Please try again.' });
      }
      removeFile(tempDir);
    }
  }

  return startQRSession();
});

module.exports = router;
