import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { spaShell } from '../src/http/spaShell.js';

const HTML = '<!doctype html><title>Keel</title><div id="root"></div>';

function appWithShell() {
  const app = express();
  app.use(spaShell(HTML));
  app.use((req, res) => res.status(404).json({ error: { message: `No route for ${req.method} ${req.path}` } }));
  return app;
}

describe('spaShell', () => {
  it.each(['/', '/overview', '/settings', '/login', '/apiary', '/api-docs'])('serves index.html for page path %s', async (path) => {
    const res = await request(appWithShell()).get(path);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.text).toBe(HTML);
  });

  it.each(['/api', '/api/', '/api/nope', '/api/portfolio/holdings'])('leaves API path %s to the API (JSON 404)', async (path) => {
    const res = await request(appWithShell()).get(path);
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/json/);
  });

  it.each(['/assets/index-old.js', '/favicon.ico', '/robots.txt'])('does not answer a missing file %s with HTML', async (path) => {
    const res = await request(appWithShell()).get(path);
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/json/);
  });

  it('only answers GET and HEAD', async () => {
    const res = await request(appWithShell()).post('/overview').send({});
    expect(res.status).toBe(404);
    const head = await request(appWithShell()).head('/overview');
    expect(head.status).toBe(200);
  });
});
