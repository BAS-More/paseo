#!/usr/bin/env node
'use strict';
/**
 * hooks/ezra-http.js — Shared HTTP utility for EZRA cloud hooks
 * Uses Node.js built-in https module. ZERO external dependencies.
 */
const https = require('https');
const http = require('http');
const dns = require('dns');

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5 MB response limit

// DEV MODE: Allow HTTP + localhost for local development
// Set EZRA_DEV_MODE=1 environment variable to enable
const DEV_MODE = process.env.EZRA_DEV_MODE === '1';

// ─── SSRF Protection ────────────────────────────────────────────

/**
 * Block requests to private/internal IP ranges (SSRF protection).
 * Blocks: localhost, 10.x, 172.16-31.x, 192.168.x, 169.254.x, ::1
 */
const PRIVATE_IP_PATTERNS = [
  /^127\./,                          // loopback
  /^10\./,                           // Class A private
  /^172\.(1[6-9]|2\d|3[01])\./,     // Class B private
  /^192\.168\./,                     // Class C private
  /^169\.254\./,                     // link-local
  /^0\./,                            // current network
  /^::1$/,                           // IPv6 loopback (canonical)
  /^0*:0*:0*:0*:0*:0*:0*:0*1$/,     // IPv6 loopback (expanded)
  /^fd[0-9a-f]{2}:/i,               // IPv6 unique local
  /^fe80:/i,                         // IPv6 link-local
];

const BLOCKED_HOSTNAMES = ['localhost', '[::1]', '0.0.0.0'];

function isBlockedHost(hostname) {
  if (DEV_MODE) return false; // Allow localhost in dev mode
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTNAMES.includes(h)) return true;
  if (BLOCKED_HOSTNAMES.includes(hostname.toLowerCase())) return true;
  for (const pat of PRIVATE_IP_PATTERNS) {
    if (pat.test(h)) return true;
  }
  return false;
}

/**
 * SEC-002: Resolve hostname via DNS and check the resolved IP against SSRF blocklist.
 * Prevents DNS rebinding attacks where a hostname resolves to a private IP.
 */
function resolveAndCheck(hostname) {
  return new Promise((resolve, reject) => {
    // If hostname is already an IP literal, just check it directly
    if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(':')) {
      if (isBlockedHost(hostname)) {
        return reject(new Error('SSRF blocked: resolved address is private/internal'));
      }
      return resolve();
    }
    // GAP-004: DNS lookup with explicit 5s timeout
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; reject(new Error('DNS resolution timed out after 5s')); }
    }, 5000);
    timer.unref();
    dns.lookup(hostname, { all: true }, (err, addresses) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (err) return reject(new Error(`DNS resolution failed: ${err.message}`));
      for (const entry of addresses) {
        if (isBlockedHost(entry.address)) {
          return reject(new Error(`SSRF blocked: ${hostname} resolves to private/internal address ${entry.address}`));
        }
      }
      resolve();
    });
  });
}

// ─── httpsPost ──────────────────────────────────────────────────

/**
 * Send an HTTPS POST request.
 * @param {string} url — Full URL (https://...)
 * @param {object} body — JSON body to send
 * @param {object} [headers] — Additional headers
 * @returns {Promise<{statusCode: number, body: object|string}>}
 */
function httpsPost(url, body, headers) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    // SEC-004: Enforce HTTPS-only for outbound requests (relaxed in dev mode)
    const isHttps = urlObj.protocol === 'https:';
    const isHttp = urlObj.protocol === 'http:';
    if (!isHttps && !(DEV_MODE && isHttp)) {
      return reject(new Error('SSRF blocked: only HTTPS URLs are allowed'));
    }
    if (isBlockedHost(urlObj.hostname)) {
      return reject(new Error('SSRF blocked: requests to private/internal addresses are not allowed'));
    }
    const postData = JSON.stringify(body);
    const transport = isHttps ? https : http;
    // SEC-002: Resolve DNS and check resolved IP before connecting (skip in dev mode for localhost)
    const preCheck = DEV_MODE ? Promise.resolve() : resolveAndCheck(urlObj.hostname);
    preCheck.then(() => {
      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: Object.assign({
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        }, headers || {}),
      };
      const req = transport.request(options, (res) => {
        let data = '';
        res.on('data', chunk => {
          data += chunk;
          if (data.length > MAX_RESPONSE_SIZE) {
            req.destroy(new Error('Response exceeded ' + MAX_RESPONSE_SIZE + ' bytes'));
          }
        });
        res.on('end', () => {
          let parsed;
          try { parsed = JSON.parse(data); } catch (_) { parsed = data; }
          resolve({ statusCode: res.statusCode, body: parsed });
        });
      });
      req.setTimeout(15000, () => {
        req.destroy(new Error('Request timed out after 15s'));
      });
      req.on('error', reject);
      req.write(postData);
      req.end();
    }).catch(reject);
  });
}

// ─── httpsGet ───────────────────────────────────────────────────

/**
 * Send an HTTPS GET request.
 * @param {string} url — Full URL (https://...)
 * @param {object} [headers] — Additional headers
 * @returns {Promise<{statusCode: number, body: object|string}>}
 */
function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    // SEC-004: Enforce HTTPS-only for outbound requests
    if (urlObj.protocol !== 'https:') {
      return reject(new Error('SSRF blocked: only HTTPS URLs are allowed'));
    }
    if (isBlockedHost(urlObj.hostname)) {
      return reject(new Error('SSRF blocked: requests to private/internal addresses are not allowed'));
    }
    // SEC-002: Resolve DNS and check resolved IP before connecting
    resolveAndCheck(urlObj.hostname).then(() => {
      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || 443,
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        headers: Object.assign({}, headers || {}),
      };
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => {
          data += chunk;
          if (data.length > MAX_RESPONSE_SIZE) {
            req.destroy(new Error('Response exceeded ' + MAX_RESPONSE_SIZE + ' bytes'));
          }
        });
        res.on('end', () => {
          let parsed;
          try { parsed = JSON.parse(data); } catch (_) { parsed = data; }
          resolve({ statusCode: res.statusCode, body: parsed });
        });
      });
      req.setTimeout(15000, () => {
        req.destroy(new Error('Request timed out after 15s'));
      });
      req.on('error', reject);
      req.end();
    }).catch(reject);
  });
}

// ─── Exports ────────────────────────────────────────────────────

// ─── Convenience aliases ─────────────────────────────────────────

/**
 * Alias for httpsPost — used by hooks that call _http.post()
 */
const post = httpsPost;

/**
 * Generic request dispatcher — used by hooks that call _http.request(url, opts)
 * opts: { method, headers, body }
 */
function request(url, opts) {
  opts = opts || {};
  const method = (opts.method || 'GET').toUpperCase();
  if (method === 'GET') {
    return httpsGet(url, opts.headers);
  }
  let body = opts.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  return httpsPost(url, body || {}, opts.headers);
}

module.exports = {
  httpsPost,
  httpsGet,
  post,
  request,
  isBlockedHost,
  resolveAndCheck,
  PRIVATE_IP_PATTERNS,
  BLOCKED_HOSTNAMES,
};
