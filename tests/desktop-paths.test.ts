import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
const require = createRequire(import.meta.url);
const { resolveAssetPath, isAppUrl } = require('../desktop/paths.cjs') as {
  resolveAssetPath: (url: string, root: string) => string | null;
  isAppUrl: (url: string) => boolean;
};
const root = path.resolve('test-fixture-dist');
describe('desktop asset boundaries', () => {
  it('serves the application and percent-decoded bundled assets from the fixed dist root', () => {
    expect(resolveAssetPath('vertex://app/', root)).toBe(path.join(root, 'index.html'));
    expect(resolveAssetPath('vertex://app/assets/main.js?cache=1', root)).toBe(
      path.join(root, 'assets', 'main.js'),
    );
    expect(resolveAssetPath('vertex://app/assets/%ED%95%9C%EA%B8%80.png', root)).toBe(
      path.join(root, 'assets', '한글.png'),
    );
  });
  it.each([
    'vertex://app/%2e%2e%2fsecret.txt',
    'vertex://app/assets/%2e%2e%5csecret.txt',
    'vertex://app/C%3A/secret',
    'vertex://app/a%00.js',
    'vertex://other/assets/main.js',
    'https://app/assets/main.js',
    'file:///C:/secret',
    'vertex://user@app/index.html',
    'not a url',
  ])('refuses a request outside the packaged application: %s', (url) =>
    expect(resolveAssetPath(url, root)).toBeNull(),
  );
  it('permits navigation only inside the own application origin', () => {
    expect(isAppUrl('vertex://app/index.html')).toBe(true);
    expect(isAppUrl('vertex://app/index.html#research')).toBe(true);
    expect(isAppUrl('https://example.com')).toBe(false);
    expect(isAppUrl('vertex://other/index.html')).toBe(false);
  });
});
