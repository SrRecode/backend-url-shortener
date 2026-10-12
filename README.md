# Backend URL Shortener

A small URL-shortener REST API built on Node's built-in `http` module — **no
runtime dependencies**. It supports generated or custom slugs, redirects that
count hits, listing and deletion, and returns structured JSON errors.

## Requirements

- Node.js 18+ (uses the global `fetch` in tests)

## Getting started

```bash
npm start          # start on http://localhost:3000 (override with PORT)
npm run dev        # start with --watch
npm test           # run the node:test suite
```

## API

| Method | Path                | Description                                   |
| ------ | ------------------- | --------------------------------------------- |
| GET    | `/health`           | Liveness plus the number of stored links      |
| POST   | `/api/links`        | Create a link — body `{ "url", "slug"? }`     |
| GET    | `/api/links`        | List links, newest first                      |
| GET    | `/api/links/:slug`  | Link metadata (including `hits`)              |
| DELETE | `/api/links/:slug`  | Delete a link                                 |
| GET    | `/:slug`            | `302` redirect to the target URL, incrementing hits |

### Examples

```bash
curl -s -X POST localhost:3000/api/links \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com/very/long/path"}'
# {"slug":"aZ3kQp","url":"...","hits":0,"createdAt":"...","shortUrl":"http://localhost:3000/aZ3kQp"}

curl -i localhost:3000/aZ3kQp        # 302 -> https://example.com/very/long/path
curl -s localhost:3000/api/links/aZ3kQp   # hits is now 1
```

### Status codes

- `201` created, `204` deleted
- `302` redirect
- `400` invalid URL / invalid JSON / bad slug
- `404` unknown slug or route
- `405` unsupported method
- `409` slug already in use
- `413` body over 16 KB

## Project layout

```
src/store.js     In-memory store + URL/slug validation (pure, unit tested)
src/app.js       createHandler / createServer — routing, JSON parsing, errors
src/server.js    Entry point: listens on PORT and handles shutdown
test/            node:test coverage of the store and the live HTTP API
```

### Design notes

- Storage is an in-memory `Map`; swap `createStore` for a database-backed
  implementation without touching the HTTP layer.
- `createHandler(store)` is separate from `createServer`, so tests can mount the
  handler on an ephemeral port (`listen(0)`).
- Request bodies are capped at 16 KB and must be JSON objects.

## Tests

```bash
npm test
```

Covers URL validation, slug generation, collisions, visit counting, deletion,
redirect + hit counting, listing order, malformed JSON, unsupported methods and
unknown routes against a real listening server.

## License

MIT
