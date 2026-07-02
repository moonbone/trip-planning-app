// Local dev server — runs the same aws/handler.mjs Lambda handler locally,
// so `POST /route` and `/tickets` can be tested before deploying. Serves
// HTTPS with the self-signed cert from certs/ if present (run
// certs/generate-cert.sh once), otherwise falls back to plain HTTP.
//
// Usage:
//   node --env-file=.env dev-server.mjs
//
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// handler.mjs expects index.html next to it (that's what deploy.sh sets up before
// zipping) — mirror that here so the same handler code runs unmodified.
copyFileSync(join(__dirname, 'index.html'), join(__dirname, 'aws', 'index.html'));

const { handler } = await import('./aws/handler.mjs');

const PORT = process.env.PORT || 8787;
const CERT_PATH = join(__dirname, 'certs', 'cert.pem');
const KEY_PATH = join(__dirname, 'certs', 'key.pem');
const useHttps = existsSync(CERT_PATH) && existsSync(KEY_PATH);

const requestListener = async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString('utf8');

  const result = await handler({
    rawPath: req.url.split('?')[0],
    httpMethod: req.method,
    body,
  });

  res.writeHead(result.statusCode, result.headers);
  res.end(result.body);
};

const server = useHttps
  ? createHttpsServer(
      { cert: readFileSync(CERT_PATH), key: readFileSync(KEY_PATH) },
      requestListener
    )
  : createHttpServer(requestListener);

server.listen(PORT, () => {
  const protocol = useHttps ? 'https' : 'http';
  console.log(`Local dev server running at ${protocol}://localhost:${PORT}`);
  if (!useHttps) {
    console.warn('No cert found at certs/cert.pem — serving plain HTTP. Run certs/generate-cert.sh for HTTPS.');
  }
  if (!process.env.ORS_API_KEY) {
    console.warn('ORS_API_KEY is not set — /route will return a 500. Run with: node --env-file=.env dev-server.mjs');
  }
});
