const { randomUUID } = require('crypto');

const SESSION_PREFIX = 'JUNE-MD:~';

function makeid() {
  return randomUUID().replace(/-/g, '').slice(0, 16);
}

module.exports = { makeid, SESSION_PREFIX };
