const path = require('node:path');
function isAppUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'vertex:' &&
      url.hostname === 'app' &&
      !url.port &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
function resolveAssetPath(value, distRoot) {
  if (!isAppUrl(value)) return null;
  try {
    const url = new URL(value),
      pathname = decodeURIComponent(url.pathname);
    if (pathname.includes('\\') || pathname.includes('\0') || pathname.includes(':')) return null;
    const segments = pathname.split('/').filter(Boolean);
    if (segments.some((part) => part === '.' || part === '..')) return null;
    const absoluteRoot = path.resolve(distRoot);
    const candidate = path.resolve(absoluteRoot, ...(segments.length ? segments : ['index.html']));
    const relative = path.relative(absoluteRoot, candidate);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
    return candidate;
  } catch {
    return null;
  }
}
module.exports = { resolveAssetPath, isAppUrl };
