import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

/** Serves the built client, falling back to index.html so client-side routes like /room/ABC123 work. */
export function createStaticHandler(root: string) {
  const indexFile = join(root, 'index.html');

  return function serveStatic(req: IncomingMessage, res: ServerResponse): void {
    if (!existsSync(indexFile)) {
      res.writeHead(503, { 'Content-Type': 'text/plain' });
      res.end('Client not built. Run "npm run build" first, or use "npm run dev".');
      return;
    }
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    const candidate = normalize(join(root, pathname));
    const insideRoot = candidate === root || candidate.startsWith(root + sep);
    const isFile = insideRoot && existsSync(candidate) && statSync(candidate).isFile();
    const file = isFile ? candidate : indexFile;
    const isAsset = isFile && pathname.startsWith('/assets/');

    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    createReadStream(file).pipe(res);
  };
}
