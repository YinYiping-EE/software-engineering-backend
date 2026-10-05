import {createHmac, randomBytes, randomUUID, timingSafeEqual} from 'node:crypto';

const COOKIE = 'calculator_session';
const LIFETIME = 180 * 24 * 60 * 60;

export function protection({sessionSecret = randomBytes(32).toString('hex'), secureCookies = false,
  publicOrigin, rateLimit = 120, writeLimit = 30, windowMs = 60_000} = {}) {
  if (sessionSecret.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters');
  const sign = (value) => createHmac('sha256', sessionSecret).update(value).digest('base64url');
  const buckets = new Map();
  return (request, response, next) => {
    response.set({'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY'});
    if (request.path === '/health') return next();
    const writing = !['GET', 'HEAD'].includes(request.method);
    const origin = request.get('origin');
    if (request.get('sec-fetch-site') === 'cross-site' || (origin &&
        origin !== (publicOrigin || `${request.protocol}://${request.get('host')}`))) {
      return response.status(403).json({success: false, message: '不允许跨站请求'});
    }
    if (writing && request.get('x-calculator-request') !== '1') {
      return response.status(403).json({success: false, message: '请求校验失败，请刷新页面'});
    }
    if (request.method === 'POST' && !request.is('application/json')) {
      return response.status(415).json({success: false, message: '请使用 JSON 请求'});
    }
    const now = Date.now();
    // Bounded fixed-window buckets prevent the limiter itself from exhausting memory.
    if (buckets.size >= 10_000) {
      for (const [ip, bucket] of buckets) if (bucket.until <= now) buckets.delete(ip);
      if (buckets.size >= 10_000 && !buckets.has(request.ip)) {
        return response.status(503).json({success: false, message: '服务繁忙，请稍后重试'});
      }
    }
    let bucket = buckets.get(request.ip);
    if (!bucket || bucket.until <= now) {
      bucket = {until: now + windowMs, reads: 0, writes: 0};
      buckets.set(request.ip, bucket);
    }
    bucket.reads++;
    if (writing) bucket.writes++;
    if (bucket.reads > rateLimit || bucket.writes > writeLimit) {
      response.set('Retry-After', String(Math.ceil((bucket.until - now) / 1000)));
      return response.status(429).json({success: false, message: '操作太频繁，请稍后重试'});
    }
    // Public metrics need no history identity. Avoid competing Set-Cookie responses
    // while a new browser loads its history and status card concurrently.
    if (request.path === '/status' && ['GET', 'HEAD'].includes(request.method)) return next();
    const cookie = (request.get('cookie') || '').split(';').map((part) => part.trim())
      .find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    const parts = cookie?.split('.') || [];
    const [id, expires, signature] = parts;
    const expected = sign(`${id}.${expires}`);
    const valid = parts.length === 3 && /^[0-9a-f-]{36}$/.test(id) && /^\d{10}$/.test(expires) &&
      Number(expires) > Math.floor(now / 1000) && Number(expires) <= Math.floor(now / 1000) + LIFETIME &&
      /^[A-Za-z0-9_-]{43}$/.test(signature) && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    request.ownerId = valid ? id : randomUUID();
    if (!valid) {
      const value = `${request.ownerId}.${Math.floor(now / 1000) + LIFETIME}`;
      response.set('Set-Cookie', `${COOKIE}=${value}.${sign(value)}; Path=/; Max-Age=${LIFETIME}; HttpOnly; SameSite=Strict${secureCookies ? '; Secure' : ''}`);
    }
    next();
  };
}
