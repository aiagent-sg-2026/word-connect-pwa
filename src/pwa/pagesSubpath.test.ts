import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('GitHub Pages subpath PWA configuration', () => {
  it('uses Vite base placeholders instead of domain-root manifest/icon paths', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).toContain('href="%BASE_URL%manifest.webmanifest"');
    expect(html).toContain('href="%BASE_URL%icons/icon-192.svg"');
    expect(html).not.toContain('href="/manifest.webmanifest"');
    expect(html).not.toContain('href="/icons/');
  });

  it('keeps manifest navigation and icon resources relative to deployed scope', () => {
    const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
    expect(manifest.start_url).toBe('./');
    expect(manifest.scope).toBe('./');
    expect(manifest.icons.map((icon: { src: string }) => icon.src)).toEqual([
      'icons/icon-192.svg',
      'icons/icon-192.svg',
      'icons/icon-512.svg',
      'icons/icon-512.svg'
    ]);
  });

  it('does not register the service worker from the domain root', () => {
    const source = readFileSync('src/pwa/register.ts', 'utf8');
    expect(source).toContain('import.meta.env.BASE_URL');
    expect(source).toContain("new URL('sw.js', baseUrl)");
    expect(source).not.toContain("register('/sw.js'");
  });
});
