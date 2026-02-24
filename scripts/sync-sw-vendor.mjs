import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const source = resolve('node_modules/@isomorphic-git/lightning-fs/dist/lightning-fs.min.js');
const destination = resolve('public/vendor/lightning-fs.min.js');

await mkdir(dirname(destination), { recursive: true });
await copyFile(source, destination);
console.log(`Copied ${source} -> ${destination}`);

