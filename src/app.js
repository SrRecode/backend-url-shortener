import http from 'node:http';
import { createStore } from './store.js';

const MAX_BODY_BYTES = 16 * 1024;

function send(res, status, payload, headers = {}) {
  const body = payload === undefined ? '' : JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...headers,
  });
  res.end(body);
}

function sendRedirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return reject(Object.assign(new Error('Body must be a JSON object'), { status: 400 }));
        }
        resolve(parsed);
      } catch {
        reject(Object.assign(new Error('Invalid JSON body'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function origin(req) {
  const host = req.headers.host ?? 'localhost';
  return `http://${host}`;
}

function publicLink(req, record) {
  return { ...record, shortUrl: `${origin(req)}/${record.slug}` };
}

/**
 * Build the request handler around a store. Exported separately from the
 * listening server so tests can mount it without opening a fixed port.
 */
export function createHandler(store = createStore()) {
  return async function handle(req, res) {
    try {
      const url = new URL(req.url, 'http://localhost');
      const { pathname } = url;
      const method = req.method ?? 'GET';

      if (pathname === '/health' && method === 'GET') {
        return send(res, 200, { status: 'ok', links: store.size });
      }

      // Collection endpoint.
      if (pathname === '/api/links') {
        if (method === 'GET') {
          return send(res, 200, { links: store.list().map((r) => publicLink(req, r)) });
        }
        if (method === 'POST') {
          const body = await readJson(req);
          const record = store.create(body.url, { slug: body.slug });
          return send(res, 201, publicLink(req, record));
        }
        return send(res, 405, { error: 'Method not allowed' });
      }

      // Item endpoint: /api/links/:slug
      const apiMatch = pathname.match(/^\/api\/links\/([^/]+)$/);
      if (apiMatch) {
        const slug = decodeURIComponent(apiMatch[1]);
        if (method === 'GET') {
          const record = store.get(slug);
          if (!record) return send(res, 404, { error: 'Link not found' });
          return send(res, 200, publicLink(req, record));
        }
        if (method === 'DELETE') {
          const removed = store.remove(slug);
          if (!removed) return send(res, 404, { error: 'Link not found' });
          return send(res, 204, undefined);
        }
        return send(res, 405, { error: 'Method not allowed' });
      }

      // Redirect endpoint: /:slug
      const redirectMatch = pathname.match(/^\/([^/]+)$/);
      if (redirectMatch && method === 'GET') {
        const slug = decodeURIComponent(redirectMatch[1]);
        const record = store.visit(slug);
        if (!record) return send(res, 404, { error: 'Link not found' });
        return sendRedirect(res, record.url);
      }

      return send(res, 404, { error: 'Not found' });
    } catch (error) {
      const status = error.status ?? 500;
      return send(res, status, { error: error.message ?? 'Internal server error' });
    }
  };
}

export function createServer(store) {
  return http.createServer(createHandler(store));
}
