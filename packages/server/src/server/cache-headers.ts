import type { RequestHandler } from "express";

/** Extensions that get immutable cache (hashed filenames or stable assets). */
const IMMUTABLE_EXTENSIONS = [
  ".js",
  ".css",
  ".woff",
  ".woff2",
  ".ttf",
  ".png",
  ".jpg",
  ".svg",
  ".gif",
  ".ico",
  ".webp",
  ".avif",
];

/** One year in seconds. */
const ONE_YEAR = 31536000;

/**
 * Express middleware that sets Cache-Control headers based on path:
 * - /public/ hashed assets + fonts + images → immutable, 1 year
 * - /public/*.html → no-cache (always revalidate)
 * - /api/* → no-store (never cache API responses)
 * - Everything else → no header (health probes, WebSocket, etc.)
 */
export function createCacheHeadersMiddleware(): RequestHandler {
  return (req, res, next) => {
    const p = req.path;

    if (p.startsWith("/public/")) {
      if (p.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      } else if (IMMUTABLE_EXTENSIONS.some((ext) => p.endsWith(ext))) {
        res.setHeader("Cache-Control", `public, max-age=${ONE_YEAR}, immutable`);
      }
    } else if (p.startsWith("/api/")) {
      res.setHeader("Cache-Control", "no-store");
    }

    next();
  };
}
