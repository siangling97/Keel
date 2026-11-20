// Serves the React app's index.html for page URLs like /overview or /settings.
//
// The React app does its own routing in the browser, so every page URL needs the same HTML file.
// On Vercel the real files (index.html, /assets/*.js, favicon.svg) come straight from the CDN,
// and only URLs with no matching file reach Express. This router answers those with index.html.
//
// It leaves alone:
// - /api/... so a mistyped API path still gets a JSON 404, not a web page
// - paths with a file extension (/assets/old-build.js), so a missing file is a real 404 instead
//   of HTML that the browser would try to run as JavaScript

import express from 'express';

const PAGE_PATH = /^\/(?!api(?:\/|$))(?:[^.]*)$/;

/** @param {string} indexHtml the built client/dist/index.html */
export function spaShell(indexHtml) {
  const router = express.Router();
  router.get(PAGE_PATH, (req, res) => {
    // no-cache: the browser must check for a new version on every visit, so a new deploy shows
    // up right away. The hashed files in /assets can be cached forever because their names change.
    res.set('Cache-Control', 'no-cache');
    res.type('html').send(indexHtml);
  });
  return router;
}
