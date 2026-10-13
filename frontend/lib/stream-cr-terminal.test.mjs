import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { createSseParser } from './api.ts';

const envelope = { run_id: 1, seq: 1, type: 'turn.completed', data: { status: 'succeeded', result: 'finished' }, ts: '2026-01-01T00:00:00+00:00' };
const frame = `data: ${JSON.stringify(envelope)}\r\r`;

test('dispatches a complete bare-CR frame without requiring another chunk', () => {
  const events = [];
  createSseParser(event => events.push(event)).push(frame);
  assert.deepEqual(events, [envelope]);
});

test('actual fetch helper delivers the terminal event when a CR-delimited response closes', { timeout: 5000 }, async () => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.end(frame);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const previous = process.env.NEXT_PUBLIC_API_BASE_URL;
  process.env.NEXT_PUBLIC_API_BASE_URL = `http://127.0.0.1:${server.address().port}/api/v1`;
  try {
    const { api } = await import(`./api.ts?loopback=${Date.now()}`);
    const events = [];
    await api.streamLocalTask(1, event => events.push(event));
    assert.deepEqual(events, [envelope]);
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_API_BASE_URL;
    else process.env.NEXT_PUBLIC_API_BASE_URL = previous;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('a CRLF boundary split across parser pushes still delivers one event', () => {
  const events = [];
  const parser = createSseParser(event => events.push(event));
  const crlf = frame.replace(/\r/g, '\r\n');
  for (const character of crlf) {
    parser.push(character);
    parser.push('');
  }
  assert.deepEqual(events, [envelope]);
});

test('actual fetch does not dispatch an event whose closing blank line is missing', { timeout: 5000 }, async () => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.end(frame.slice(0, -1));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const previous = process.env.NEXT_PUBLIC_API_BASE_URL;
  process.env.NEXT_PUBLIC_API_BASE_URL = `http://127.0.0.1:${server.address().port}/api/v1`;
  try {
    const { api } = await import(`./api.ts?incomplete=${Date.now()}`);
    const events = [];
    await api.streamLocalTask(1, event => events.push(event));
    assert.deepEqual(events, []);
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_API_BASE_URL;
    else process.env.NEXT_PUBLIC_API_BASE_URL = previous;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('actual fetch delivers one event when a CRLF pair is split across writes', { timeout: 5000 }, async () => {
  const crlf = frame.replace(/\r/g, '\r\n');
  const cut = crlf.indexOf('\r\n') + 1;
  const server = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.write(crlf.slice(0, cut));
    setTimeout(() => response.end(crlf.slice(cut)), 10);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const previous = process.env.NEXT_PUBLIC_API_BASE_URL;
  process.env.NEXT_PUBLIC_API_BASE_URL = `http://127.0.0.1:${server.address().port}/api/v1`;
  try {
    const { api } = await import(`./api.ts?crlf=${Date.now()}`);
    const events = [];
    await api.streamLocalTask(1, event => events.push(event));
    assert.deepEqual(events, [envelope]);
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_API_BASE_URL;
    else process.env.NEXT_PUBLIC_API_BASE_URL = previous;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

 test('CR then LF-only chunks preserve a subsequent blank line', () => {
  const events = [];
  const parser = createSseParser(event => events.push(event));
  parser.push(`data: ${JSON.stringify(envelope)}\r`);
  parser.push('');
  parser.push('\n');
  parser.push('');
  assert.deepEqual(events, []);
  parser.push('\n');
  assert.deepEqual(events, [envelope]);
});

test('adjacent frames across CRLF chunk boundaries dispatch exactly once each', () => {
  const second = { ...envelope, seq: 2 };
  const events = [];
  const parser = createSseParser(event => events.push(event));
  parser.push(`data: ${JSON.stringify(envelope)}\r\n\r`);
  parser.push('');
  parser.push(`\ndata: ${JSON.stringify(second)}\r`);
  parser.push('\n\r');
  parser.push('');
  parser.push('\n');
  assert.deepEqual(events, [envelope, second]);
});
