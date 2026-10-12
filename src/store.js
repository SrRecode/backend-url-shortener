/** In-memory link store. Kept dependency-free and easy to reason about. */

const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export const SLUG_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

export function isValidUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function randomSlug(length = 6) {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

export function createStore({ slugLength = 6 } = {}) {
  const links = new Map();

  function nextSlug() {
    let slug = randomSlug(slugLength);
    while (links.has(slug)) slug = randomSlug(slugLength);
    return slug;
  }

  return {
    /** Create a link. Throws { status, message } on validation failure. */
    create(url, { slug } = {}) {
      if (!isValidUrl(url)) {
        throw Object.assign(new Error('A valid http(s) URL is required'), { status: 400 });
      }
      if (slug !== undefined) {
        if (typeof slug !== 'string' || !SLUG_PATTERN.test(slug)) {
          throw Object.assign(new Error('Slug must match [A-Za-z0-9_-]{1,32}'), { status: 400 });
        }
        if (links.has(slug)) {
          throw Object.assign(new Error('Slug already in use'), { status: 409 });
        }
      }
      const finalSlug = slug ?? nextSlug();
      const record = {
        slug: finalSlug,
        url: url.trim(),
        hits: 0,
        createdAt: new Date().toISOString(),
      };
      links.set(finalSlug, record);
      return record;
    },

    get(slug) {
      return links.get(slug) ?? null;
    },

    /** Record a visit and return the updated record (or null). */
    visit(slug) {
      const record = links.get(slug);
      if (!record) return null;
      record.hits += 1;
      return record;
    },

    remove(slug) {
      return links.delete(slug);
    },

    list() {
      return [...links.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    get size() {
      return links.size;
    },
  };
}
