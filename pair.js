const { makeid, SESSION_PREFIX } = require('./id');
const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  delay,
  makeCacheableSignalKeyStore,
  Browsers,
  fetchLatestBaileysVersion,
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
  let num = req.query.number;

  async function startPairSession() {
    const { state, saveCreds } = await useMultiFileAuthState(tempDir);

    try {

      const socket = makeWASocket({
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(
            state.keys,
            pino({ level: 'silent' }).child({ level: 'silent' })
          ),
        },
        version: [2,3000,1033105955],
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: Browsers.windows('Edge'),
      });

      if (!socket.authState.creds.registered) {
        await delay(1500);
        const cleanNum = (num || '').replace(/[^0-9]/g, '');
        try {
          const pairCode = await socket.requestPairingCode(cleanNum, 'JUNEXBOT');
          if (!res.headersSent) res.json({ code: pairCode });
        } catch (e) {
          console.error('[PairCode Request Error]', e.message);
          if (!res.headersSent) res.json({ code: 'Failed to request pairing code. Try again.' });
        }
      }

      socket.ev.on('creds.update', saveCreds);

      socket.ev.on('connection.update', async (update) => {
        try {
          const { connection, lastDisconnect } = update;

          if (connection === 'open') {
            console.log('[Pair] Connection open — sending session ID...');
            await delay(5000);

            const credsPath = path.join(tempDir, 'creds.json');

            // Wait until creds.json actually exists
            let retries = 10;
            while (!fs.existsSync(credsPath) && retries-- > 0) {
              await delay(1000);
            }

            if (!fs.existsSync(credsPath)) {
              console.error('[Pair] creds.json not found after retries');
              await socket.ws.close();
              removeFile(tempDir);
              return;
            }

            const credsData = fs.readFileSync(credsPath);
            const sessionId = SESSION_PREFIX + Buffer.from(credsData).toString('base64');

            const sessionMsg = await socket.sendMessage(socket.user.id, { text: sessionId });
            console.log('[Pair] Session ID sent ✓');

            const infoText =
              `╔══════════════════════╗\n` +
              `║   SESSION GENERATED   ║\n` +
              `╠══════════════════════╣\n` +
              `║ Bot    : JUNE-X       ║\n` +
              `║ Type   : Base64       ║\n` +
              `║ Status : Active ✅    ║\n` +
              `║ Baileys: ${version.join('.')}   ║\n` +
              `╠══════════════════════╣\n` +
              `║ Copy the session ID   ║\n` +
              `║ above and set it as  ║\n` +
              `║ SESSION_ID in your   ║\n` +
              `║ bot config / Heroku. ║\n` +
              `╚══════════════════════╝\n\n` +
              `⭐ Star the repo if this helped!`;

            await socket.sendMessage(socket.user.id, { text: infoText }, { quoted: sessionMsg });
            console.log('[Pair] Info message sent ✓');

            await delay(1000);
            await socket.ws.close();
            removeFile(tempDir);

          } else if (connection === 'close') {
            const code = lastDisconnect?.error?.output?.statusCode;
            console.log(`[Pair] Connection closed — code: ${code}`);
            if (code !== 401) {
              await delay(10000);
              startPairSession();
            } else {
              removeFile(tempDir);
            }
          }
        } catch (err) {
          console.error('[Pair connection.update error]', err);
          try { await socket.ws.close(); } catch (_) {}
          removeFile(tempDir);
        }
      });

    } catch (err) {
      console.error('[Pair Session Error]', err);
      removeFile(tempDir);
      if (!res.headersSent) {
        res.json({ code: 'Service temporarily unavailable. Please try again.' });
      }
    }
  }

  return startPairSession();
});

module.exports = router;
