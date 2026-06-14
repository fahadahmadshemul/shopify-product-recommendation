const windows = new Map();

const CLEANUP_INTERVAL = 60_000;

setInterval(() => {
  const cutoff = Date.now() - 120_000;
  for (const [key, entries] of windows) {
    const filtered = entries.filter((e) => e.timestamp > cutoff);
    if (filtered.length === 0) {
      windows.delete(key);
    } else {
      windows.set(key, filtered);
    }
  }
}, CLEANUP_INTERVAL).unref();

function getClientIp(request) {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "127.0.0.1";
}

export function checkRateLimit(request, visitorId, { maxRequests = 30, windowMs = 60_000 } = {}) {
  const ip = getClientIp(request);
  const now = Date.now();
  const windowStart = now - windowMs;

  for (const id of [visitorId, `ip:${ip}`]) {
    if (!id) continue;

    let entries = windows.get(id) || [];
    entries = entries.filter((e) => e.timestamp > windowStart);

    if (entries.length >= maxRequests) {
      const retryAfter = Math.ceil((entries[0].timestamp + windowMs - now) / 1000);
      return { allowed: false, retryAfter, key: id };
    }

    entries.push({ timestamp: now });
    windows.set(id, entries);
  }

  return { allowed: true };
}
