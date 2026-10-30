#!/usr/bin/env node
// A stand-in for OpenAI's API, for the end-to-end suite. See e2e/README.md.
//
// The backend calls it instead of api.openai.com when started with
// OPENAI_BASE_OVERRIDE=http://localhost:3999 (development only). It exists so
// flow 09 can check what voice capture really sends: for weeks the app
// uploaded nothing (iOS refused the recording format), the backend answered
// with an error, and the flow passed on the error message.
//
//   node e2e/fake-openai.mjs <uploads.jsonl>
//
// POST /v1/audio/transcriptions  records the uploaded file (bytes, whether it
//   is an MP4 container, how many bytes of audio its mdat box holds) as one
//   JSON line in <uploads.jsonl>, and answers with a fixed transcript. A file
//   that is not an MP4 with audio in it gets a 400, as Whisper answers.
// POST /v1/chat/completions  answers the voice extraction prompt with one
//   expense. Everything else (the receipt reader, the advisor) gets the 401 an
//   invalid key gets from OpenAI, which is what those flows saw before.
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';

const log = process.argv[2];
const port = Number(process.env.FAKE_OPENAI_PORT || 3999);
if (!log) {
  console.error('usage: fake-openai.mjs <uploads.jsonl>');
  process.exit(2);
}

const TRANSCRIPT = 'Lunch was twelve dollars.';

/** The top-level boxes of an MP4 file: [type, payload bytes]. */
function boxes(buf) {
  const out = [];
  for (let at = 0; at + 8 <= buf.length; ) {
    let size = buf.readUInt32BE(at);
    const type = buf.toString('latin1', at + 4, at + 8);
    let header = 8;
    if (size === 1 && at + 16 <= buf.length) {
      size = Number(buf.readBigUInt64BE(at + 8));
      header = 16;
    } else if (size === 0) {
      size = buf.length - at;
    }
    if (size < header) break;
    out.push([type, Math.min(size, buf.length - at) - header]);
    at += size;
  }
  return out;
}

/** The `file` part of a multipart/form-data body. */
function filePart(body, contentType) {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType ?? '');
  if (!boundary) return null;
  const delimiter = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  let at = body.indexOf(delimiter);
  while (at !== -1) {
    const next = body.indexOf(delimiter, at + delimiter.length);
    if (next === -1) break;
    const part = body.subarray(at + delimiter.length, next);
    const split = part.indexOf('\r\n\r\n');
    if (split !== -1 && /name="file"/.test(part.toString('latin1', 0, split))) {
      // The part ends with the CRLF that precedes the next delimiter.
      return part.subarray(split + 4, part.length - 2);
    }
    at = next;
  }
  return null;
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const invalidKey = {
  error: { message: 'Incorrect API key provided (e2e fake).', type: 'invalid_request_error', code: 'invalid_api_key' },
};

createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);

    if (req.method === 'POST' && req.url === '/v1/audio/transcriptions') {
      const file = filePart(body, req.headers['content-type']) ?? Buffer.alloc(0);
      const found = boxes(file);
      const upload = {
        at: new Date().toISOString(),
        bytes: file.length,
        mp4: found[0]?.[0] === 'ftyp',
        audioBytes: found.filter(([type]) => type === 'mdat').reduce((n, [, size]) => n + size, 0),
      };
      appendFileSync(log, JSON.stringify(upload) + '\n');
      if (!upload.mp4 || upload.audioBytes === 0) {
        return send(res, 400, { error: { message: 'Invalid file format (e2e fake).', type: 'invalid_request_error' } });
      }
      return send(res, 200, { text: TRANSCRIPT });
    }

    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      let request = {};
      try {
        request = JSON.parse(body.toString('utf8'));
      } catch {}
      const [system, user] = request.messages ?? [];
      const voice = typeof system?.content === 'string'
        && system.content.startsWith('You turn a spoken description')
        && user?.content === TRANSCRIPT;
      if (!voice) return send(res, 401, invalidKey);
      const content = JSON.stringify({ transactions: [{ amount: 12, type: 'Expense', category: 'Food', note: 'Lunch' }] });
      return send(res, 200, { choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }] });
    }

    send(res, 404, { error: { message: `No route ${req.method} ${req.url} (e2e fake).` } });
  });
}).listen(port, '127.0.0.1', () => console.log(`fake-openai: listening on ${port}, uploads to ${log}`));
