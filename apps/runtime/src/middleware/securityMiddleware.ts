import { Request, Response, NextFunction } from 'express';
import { CONFIG } from '../config.js';
import { runtimeAuthService } from '../services/runtimeAuthService.js';

export function isAllowedHost(hostHeader?: string, port: number = CONFIG.PORT): boolean {
  if (!hostHeader) return false;
  const clean = hostHeader.trim().toLowerCase();

  let hostPart = clean;
  if (clean.startsWith('[')) {
    const closeBracket = clean.indexOf(']');
    if (closeBracket !== -1) {
      hostPart = clean.substring(0, closeBracket + 1);
    }
  } else if (clean.includes(':')) {
    hostPart = clean.split(':')[0];
  }

  const validHostnames = ['127.0.0.1', 'localhost', '[::1]', '::1'];
  return validHostnames.includes(hostPart);
}

export function isAllowedOrigin(originHeader?: string, port: number = CONFIG.PORT): boolean {
  if (!originHeader) return true; // No origin (CLI, curl, direct same-origin requests)
  const clean = originHeader.trim().toLowerCase();

  try {
    const url = new URL(clean);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false;
    }

    const hostname = url.hostname.toLowerCase();
    const originPort = url.port ? parseInt(url.port, 10) : (url.protocol === 'https:' ? 443 : 80);

    // 1. Exact match for current runtime port on loopback
    const validLoopbacks = ['127.0.0.1', 'localhost', '[::1]', '::1'];
    if (validLoopbacks.includes(hostname) && originPort === port) {
      return true;
    }

    // 2. Explicit approved dev origins
    if (process.env.MINFY_ALLOWED_DEV_ORIGINS) {
      const custom = process.env.MINFY_ALLOWED_DEV_ORIGINS.split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      if (custom.includes(clean)) {
        return true;
      }
    } else {
      // Default Vite dev ports for local IDE development
      const viteDevOrigins = [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://[::1]:5173',
      ];
      if (viteDevOrigins.includes(clean)) {
        return true;
      }
    }
  } catch {
    return false;
  }

  return false;
}

/**
 * Host Header Validation Middleware (DNS Rebinding Guard)
 */
export const hostValidationMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const host = req.headers.host;
  if (!isAllowedHost(host, CONFIG.PORT)) {
    return res.status(403).json({
      success: false,
      error: 'Invalid or forbidden Host header.',
    });
  }
  next();
};

/**
 * Strict Loopback Origin / CORS Middleware
 */
export const corsOriginMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;

  if (origin) {
    if (!isAllowedOrigin(origin, CONFIG.PORT)) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden Origin.',
      });
    }

    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-runtime-token');
    res.setHeader('Vary', 'Origin');

    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
  }

  next();
};

/**
 * Centralized Runtime Authentication Middleware
 */
export const runtimeAuthMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Public unauthenticated health probe endpoint
  if (req.path === '/api/health') {
    return next();
  }

  // Only authenticate /api/* routes (static web files can be served to direct visits)
  if (!req.path.startsWith('/api')) {
    return next();
  }

  let token: string | undefined;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (req.headers['x-runtime-token']) {
    const raw = req.headers['x-runtime-token'];
    token = Array.isArray(raw) ? raw[0] : raw;
  }

  if (!token || !runtimeAuthService.verifyToken(token)) {
    return res.status(401).json({
      success: false,
      error: 'Runtime authentication required.',
    });
  }

  next();
};
