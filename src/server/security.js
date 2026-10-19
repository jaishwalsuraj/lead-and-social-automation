import crypto from 'crypto';
import path from 'path';

/**
 * High-performance, zero-dependency in-memory security & rate-limiting engine
 */

class RateLimiter {
  constructor(windowMs, maxRequests, keyPrefix = 'rate') {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.keyPrefix = keyPrefix;
    this.hits = new Map();

    // Clean up stale entries every 5 minutes
    setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  getKey(req, identifier = null) {
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || '127.0.0.1';
    return identifier ? `${this.keyPrefix}:${ip}:${identifier.toLowerCase().trim()}` : `${this.keyPrefix}:${ip}`;
  }

  check(req, identifier = null) {
    const key = this.getKey(req, identifier);
    const now = Date.now();
    const record = this.hits.get(key) || { count: 0, resetAt: now + this.windowMs };

    if (now > record.resetAt) {
      record.count = 0;
      record.resetAt = now + this.windowMs;
    }

    record.count++;
    this.hits.set(key, record);

    if (record.count > this.maxRequests) {
      const waitSeconds = Math.ceil((record.resetAt - now) / 1000);
      return { allowed: false, waitSeconds, remaining: 0 };
    }

    return { allowed: true, remaining: this.maxRequests - record.count };
  }

  reset(req, identifier = null) {
    const key = this.getKey(req, identifier);
    this.hits.delete(key);
  }

  middleware(identifierFn = null) {
    return (req, res, next) => {
      const identifier = identifierFn ? identifierFn(req) : null;
      const status = this.check(req, identifier);
      if (!status.allowed) {
        return res.status(429).json({
          error: `Too many requests. Please wait ${status.waitSeconds} seconds before trying again.`,
          retryAfter: status.waitSeconds
        });
      }
      next();
    };
  }

  cleanup() {
    const now = Date.now();
    for (const [key, record] of this.hits.entries()) {
      if (now > record.resetAt) {
        this.hits.delete(key);
      }
    }
  }
}

// 1. Login Rate Limiter: max 5 failed attempts per 15 minutes
export const loginRateLimiter = new RateLimiter(15 * 60 * 1000, 5, 'login');

// 2. Forgot Password Request Limiter: max 3 requests per 15 minutes
export const forgotPwRateLimiter = new RateLimiter(15 * 60 * 1000, 3, 'forgot');

// 3. Reset Password OTP Attempt Limiter: max 5 attempts per identifier per 15 minutes
export const resetPwRateLimiter = new RateLimiter(15 * 60 * 1000, 5, 'reset');

// 4. Public API Limiter (Scorecard submit): max 45 submissions per minute per IP
export const publicApiRateLimiter = new RateLimiter(60 * 1000, 45, 'public');

/**
 * Middleware: Apply standard security headers
 */
export function applySecurityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
}

/**
 * Path Traversal Guard: Ensures a path cannot escape the base directory
 */
export function isPathSafe(baseDir, requestedPath) {
  if (!requestedPath || typeof requestedPath !== 'string') return false;
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(requestedPath);
  return resolvedTarget.startsWith(resolvedBase);
}
