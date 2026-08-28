import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/server', { recursive: true });
cpSync('index.html', 'dist/index.html');
cpSync('style.css', 'dist/style.css');
cpSync('game.js', 'dist/game.js');
cpSync('assets', 'dist/assets', { recursive: true });
writeFileSync('dist/server/index.js', `export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404) return response;
    return env.ASSETS.fetch(new Request(new URL('/', request.url), request));
  }
};`);
