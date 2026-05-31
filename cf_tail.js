const WebSocket = require('ws');
const fs = require('fs');

const TAIL_URL = process.argv[2];
const LOG_FILE = process.argv[3] || 'C:\\Users\\User\\AppData\\Local\\Temp\\cf_tail_out.log';

const out = fs.createWriteStream(LOG_FILE, { flags: 'a' });
out.write('START ' + new Date().toISOString() + '\n');

const ws = new WebSocket(TAIL_URL, 'trace-v1');
ws.on('open', () => {
  out.write('CONNECTED\n');
  ws.send(JSON.stringify({ debug: false, sampling_rate: 1, filters: [] }));
});
ws.on('message', (data) => {
  try {
    const msg = JSON.parse(data);
    const ts = new Date(msg.eventTimestamp || Date.now()).toISOString();
    const logs = msg.logs || [];
    logs.forEach(l => {
      const parts = l.message || [];
      const text = parts.map(p => typeof p === 'object' ? JSON.stringify(p) : String(p)).join(' ');
      out.write('[' + ts + '] ' + l.level + ': ' + text.slice(0, 800) + '\n');
    });
    if (msg.outcome && msg.outcome !== 'ok') out.write('OUTCOME:' + msg.outcome + ' at ' + ts + '\n');
  } catch (e) {
    out.write('[RAW] ' + data.toString().slice(0, 200) + '\n');
  }
});
ws.on('error', e => { out.write('ERROR: ' + e.message + '\n'); process.exit(1); });
ws.on('close', () => { out.write('CLOSED\n'); process.exit(0); });

setTimeout(() => {
  out.write('TIMEOUT 120s\n');
  ws.close();
  process.exit(0);
}, 120000);
