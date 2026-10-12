import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/app.js';
import { createStore, isValidUrl } from '../src/store.js';

let server;
let base;

before(async () => {
  server = createServer(createStore());
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

async function shorten(body) {
  const res = await fetch(`${base}/api/links`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { res, json: res.status === 204 ? null : await res.json() };
}

describe('store', () => {
  test('validates URLs', () => {
    assert.equal(isValidUrl('https://example.com'), true);
    assert.equal(isValidUrl('http://example.com/a?b=1'), true);
    assert.equal(isValidUrl('ftp://example.com'), false);
    assert.equal(isValidUrl('nope'), false);
    assert.equal(isValidUrl(''), false);
  });

  test('creates, visits and removes links', () => {
    const store = createStore();
    const record = store.create('https://example.com');
    assert.match(record.slug, /^[A-Za-z0-9]{6}$/);
    assert.equal(record.hits, 0);

    assert.equal(store.visit(record.slug).hits, 1);
    assert.equal(store.get(record.slug).hits, 1);

    assert.equal(store.remove(record.slug), true);
    assert.equal(store.get(record.slug), null);
  });

  test('rejects invalid URLs and duplicate slugs', () => {
    const store = createStore();
    assert.throws(() => store.create('not-a-url'), /valid http/);
    store.create('https://example.com', { slug: 'mine' });
    assert.throws(() => store.create('https://other.com', { slug: 'mine' }), /already in use/);
    assert.throws(() => store.create('https://example.com', { slug: 'bad slug!' }), /Slug must match/);
  });
});

describe('HTTP api', () => {
  test('health check', async () => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'ok', links: 0 });
  });

  test('creates a short link with a generated slug', async () => {
    const { res, json } = await shorten({ url: 'https://example.com/very/long/path' });
    assert.equal(res.status, 201);
    assert.equal(json.url, 'https://example.com/very/long/path');
    assert.equal(json.hits, 0);
    assert.equal(json.shortUrl, `${base}/${json.slug}`);
  });

  test('supports custom slugs and reports conflicts', async () => {
    const first = await shorten({ url: 'https://a.com', slug: 'custom' });
    assert.equal(first.res.status, 201);

    const dup = await shorten({ url: 'https://b.com', slug: 'custom' });
    assert.equal(dup.res.status, 409);
    assert.match(dup.json.error, /already in use/);
  });

  test('rejects an invalid URL with 400', async () => {
    const { res, json } = await shorten({ url: 'nope' });
    assert.equal(res.status, 400);
    assert.match(json.error, /valid http/);
  });

  test('rejects malformed JSON with 400', async () => {
    const res = await fetch(`${base}/api/links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not json',
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /Invalid JSON/);
  });

  test('redirects and counts hits', async () => {
    const { json } = await shorten({ url: 'https://example.org', slug: 'go' });

    const first = await fetch(`${base}/go`, { redirect: 'manual' });
    assert.equal(first.status, 302);
    assert.equal(first.headers.get('location'), 'https://example.org');

    await fetch(`${base}/go`, { redirect: 'manual' });
    const meta = await (await fetch(`${base}/api/links/go`)).json();
    assert.equal(meta.hits, 2);
    assert.equal(json.slug, 'go');
  });

  test('lists links, newest first', async () => {
    const store = createStore();
    const local = createServer(store);
    await new Promise((resolve) => local.listen(0, resolve));
    const localBase = `http://127.0.0.1:${local.address().port}`;

    await fetch(`${localBase}/api/links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://one.com', slug: 'one' }),
    });
    await new Promise((r) => setTimeout(r, 5));
    await fetch(`${localBase}/api/links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://two.com', slug: 'two' }),
    });

    const { links } = await (await fetch(`${localBase}/api/links`)).json();
    assert.equal(links.length, 2);
    assert.equal(links[0].slug, 'two');

    await new Promise((resolve) => local.close(resolve));
  });

  test('deletes a link and 404s afterwards', async () => {
    await shorten({ url: 'https://del.com', slug: 'delme' });
    const del = await fetch(`${base}/api/links/delme`, { method: 'DELETE' });
    assert.equal(del.status, 204);

    const after = await fetch(`${base}/api/links/delme`);
    assert.equal(after.status, 404);

    const redirect = await fetch(`${base}/delme`, { redirect: 'manual' });
    assert.equal(redirect.status, 404);
  });

  test('returns 405 for unsupported methods and 404 for unknown routes', async () => {
    const put = await fetch(`${base}/api/links`, { method: 'PUT' });
    assert.equal(put.status, 405);

    const unknown = await fetch(`${base}/nope/deeper/path`);
    assert.equal(unknown.status, 404);
  });
});
