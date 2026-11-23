import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const url = new URL(process.env.PUBLIC_ORIGIN || 'https://oopengate.vercel.app');
if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
  throw new Error('PUBLIC_ORIGIN must be an HTTPS origin without path or credentials');
}
// Store-only ZIP: no platform tools or extra build dependencies required.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function zip(files) {
  const local = [], central = [];
  let offset = 0;
  for (const [name, content] of files) {
    const data = Buffer.from(content), path = Buffer.from(name), crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x21, 12); // Jan 1, 1980, deterministic DOS date
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22); header.writeUInt16LE(path.length, 26);
    local.push(header, path, data);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x21, 14); directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(data.length, 20); directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(path.length, 28); directory.writeUInt32LE(offset, 42);
    central.push(directory, path);
    offset += header.length + path.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
const output = join(root, 'public', 'downloads');
await mkdir(output, { recursive: true });
const readme = await readFile(join(root, 'connectors', 'README.md'), 'utf8');
const sums = [];
for (const [platform, scripts] of [
  ['windows', ['Start-ApiDuck.cmd', 'Start-ApiDuck.ps1', 'Key-Entry.ps1']],
  ['linux', ['start-apiduck.sh']],
]) {
  const files = [['gateway-url.txt', `${url.origin}\n`], ['README.md', readme],
    ['claude-settings.json', await readFile(join(root, 'connectors', 'claude-settings.json'), 'utf8')]];
  for (const script of scripts) {
    let content = await readFile(join(root, 'connectors', platform, script), 'utf8');
    content = content.replace(/\r\n/g, '\n');
    if (platform === 'windows') content = content.replace(/\n/g, '\r\n');
    files.push([script, content]);
  }
  const name = `apiduck-${platform}.zip`, archive = zip(files);
  await writeFile(join(output, name), archive);
  sums.push(`${createHash('sha256').update(archive).digest('hex')}  ${name}`);
}
await writeFile(join(output, 'SHA256SUMS.txt'), sums.join('\n') + '\n');
console.log(`Packaged customer connectors for ${url.origin}; no customer or provider secrets included.`);
