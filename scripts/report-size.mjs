import { promises as fs } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

function formatBytes(bytes) {
  return bytes.toLocaleString('en-US');
}

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

async function run() {
  const distDir = path.resolve(process.cwd(), 'dist');
  const assetsDir = path.join(distDir, 'assets');

  try {
    await fs.access(assetsDir);
  } catch {
    console.log('No dist/assets directory found. Run `npm run build` first.');
    return;
  }

  const files = (await walk(assetsDir))
    .filter(file => file.endsWith('.js') || file.endsWith('.css'))
    .sort((a, b) => a.localeCompare(b));

  let totalRaw = 0;
  let totalGzip = 0;
  let totalJsRaw = 0;
  let totalJsGzip = 0;
  let totalCssRaw = 0;
  let totalCssGzip = 0;

  for (const file of files) {
    const buf = await fs.readFile(file);
    const raw = buf.length;
    const gzip = gzipSync(buf).length;

    totalRaw += raw;
    totalGzip += gzip;

    if (file.endsWith('.js')) {
      totalJsRaw += raw;
      totalJsGzip += gzip;
    } else {
      totalCssRaw += raw;
      totalCssGzip += gzip;
    }

    const rel = path.relative(distDir, file).replace(/\\/g, '/');
    console.log(`${rel}  raw=${formatBytes(raw)}  gzip=${formatBytes(gzip)}`);
  }

  console.log('');
  console.log(`JS total:  raw=${formatBytes(totalJsRaw)}  gzip=${formatBytes(totalJsGzip)}`);
  console.log(`CSS total: raw=${formatBytes(totalCssRaw)}  gzip=${formatBytes(totalCssGzip)}`);
  console.log(`Combined local payload (JS+CSS): raw=${formatBytes(totalRaw)}  gzip=${formatBytes(totalGzip)}`);
}

run().catch(error => {
  console.error('Size report failed:', error);
  process.exitCode = 1;
});
