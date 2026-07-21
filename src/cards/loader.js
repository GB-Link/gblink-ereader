import { decodeRawToBin, looksLikeRaw } from './raw-decode.js';
import { classifyUpload, parseUploadFilename } from './upload.js';

const NINTENDO = new TextEncoder().encode('NINTENDO');

const CARD_TYPE_LABELS = {
  0x00: 'Blank card', 0x01: 'Blank card',
  0x02: 'Dotcode app (short title)', 0x03: 'Dotcode app (short title)',
  0x04: 'Dotcode app', 0x05: 'Dotcode app',
  0x0e: 'Dotcode app (long title)', 0x0f: 'Game-specific card',
};

const REGION_LABELS = { 0: 'Japan', 1: 'USA / Australia', 2: 'Japan (e-Reader+)' };

function headerReadU16Le(bytes, offset) { return bytes[offset] | (bytes[offset + 1] << 8); }
function headerReadU32Le(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24);
}
function readAsciiStr(bytes, start, maxLen) {
  let end = start;
  while (end < bytes.length && end < start + maxLen && bytes[end] !== 0) end++;
  return new TextDecoder('ascii').decode(bytes.subarray(start, end)).trim();
}
function isPrintableAscii(text) { return text.length >= 2 && /^[\x20-\x7e]+$/.test(text); }

function hasFullCardHeader(bytes, offset = 0) {
  if (bytes.length < offset + 0x30) return false;
  if (bytes[offset] !== 0x00 || bytes[offset + 1] !== 0x30) return false;
  for (let i = 0; i < 8; i++) {
    if (bytes[offset + 0x1a + i] !== NINTENDO[i]) return false;
  }
  return true;
}

function cardTypeFromHeader(bytes, offset) {
  const upperBit = bytes[offset + 0x03] & 1;
  const region = headerReadU16Le(bytes, offset + 0x0c);
  const lowerBits = (region >> 12) & 0x0f;
  return (upperBit << 4) | lowerBits;
}

function parseFullHeader(bytes, offset) {
  const cardType = cardTypeFromHeader(bytes, offset);
  const region = (headerReadU16Le(bytes, offset + 0x0c) >> 8) & 0x0f;
  const perms = headerReadU32Le(bytes, offset + 0x2a);
  const titleLen = cardType === 0x0e || cardType === 0x0f ? 32 : 16;
  const title = bytes.length >= offset + 0x30 + 2
    ? readAsciiStr(bytes, offset + 0x30, titleLen)
    : '';
  return {
    kind: 'full',
    title: isPrintableAscii(title) ? title : null,
    cardType,
    cardTypeLabel: CARD_TYPE_LABELS[cardType] ?? `Card type 0x${cardType.toString(16)}`,
    region,
    regionLabel: REGION_LABELS[region] ?? `Region ${region}`,
    applicationType: (perms & 4) ? 'nes' : 'gba',
    dotcodeLength: headerReadU16Le(bytes, offset + 0x06),
  };
}

export function parseCardHeader(bytes) {
  if (hasFullCardHeader(bytes, 0)) return parseFullHeader(bytes, 0);
  if (bytes.length === 2112 && hasFullCardHeader(bytes, 114)) return parseFullHeader(bytes, 114);
  const title = readAsciiStr(bytes, 0x04, 32);
  if (!isPrintableAscii(title)) return null;
  return {
    kind: 'stripped', title,
    cardType: null, cardTypeLabel: null,
    region: null, regionLabel: null,
    applicationType: null, dotcodeLength: null,
  };
}

const SAV_SIZE = 0x20000;
const CARD_REGION_START = 0x10004;
const CARD_REGION_END = 0x1f000;

const SMA4_MAGIC = new Uint8Array([0x53, 0x4d, 0x41, 0x34, 0x4d, 0x57, 0x45]);
const SMA4_OFFSET_NAME = 0x80;
const SMA4_MAX_LEVEL_NAME_SIZE = 21;
const SMA4_MAX_LEVEL_DATA = 32;
const SMA4_CARD_PAYLOAD_SIZE = 1998;

function looksLikeSma4Save(bytes) {
  if (bytes.length !== SAV_SIZE) return false;
  for (let i = 0; i < SMA4_MAGIC.length; i++) {
    if (bytes[i] !== SMA4_MAGIC[i]) return false;
  }
  return true;
}

function sma4LevelDataAddress(dataID) {
  const offset = dataID % 2 === 0 ? 1 : 0;
  if (dataID < 20) return 0x6000 + offset * 0x10 + dataID * 0x800;
  if (dataID < 32) return 0x16000 + offset * 0x10 + (dataID - 20) * 0x800;
  return 0x800;
}

function decodeSma4Char(c) {
  if (c === 0xff) return null;
  if (c <= 0x19) return String.fromCharCode(0x41 + c);
  if (c >= 0x20 && c <= 0x39) return String.fromCharCode(0x61 + (c - 0x20));
  if (c >= 0x76 && c <= 0x7f) return String.fromCharCode(0x30 + (c - 0x76));
  const specials = { 0xe3: ' ', 0x1c: "'", 0x1d: ',', 0x1e: '.', 0xe0: '?', 0xe1: '!', 0xe2: '-' };
  return specials[c] ?? '?';
}

function readSma4LevelName(bytes, recordIndex) {
  const base = SMA4_OFFSET_NAME + recordIndex * SMA4_MAX_LEVEL_NAME_SIZE;
  let name = '';
  for (let i = 0; i < SMA4_MAX_LEVEL_NAME_SIZE; i++) {
    const ch = decodeSma4Char(bytes[base + i]);
    if (ch === null) break;
    name += ch;
  }
  return name || 'Unnamed Level';
}

function extractCardFromSma4Save(bytes) {
  const levels = [];
  for (let dataID = 0; dataID < SMA4_MAX_LEVEL_DATA; dataID++) {
    const addr = sma4LevelDataAddress(dataID);
    if (addr + SMA4_CARD_PAYLOAD_SIZE > bytes.length) continue;
    const recordID = bytes[addr];
    if (recordID === 0) continue;
    levels.push({ dataID, addr, recordID, name: readSma4LevelName(bytes, recordID - 1) });
  }

  if (levels.length === 0) throw new Error('No level data found in this SMA4 save file');

  const { addr, name } = levels[0];
  const bin = bytes.slice(addr, addr + SMA4_CARD_PAYLOAD_SIZE);
  const detail = levels.length > 1
    ? `${name} (+${levels.length - 1} more level${levels.length > 2 ? 's' : ''} in save)`
    : name;
  return { bin, detail };
}

function extractCardFromSav(bytes) {
  if (bytes.length < 0x10040) throw new Error('File is too small to be an e-Reader save file');

  const crc = bytes[0x10000] | (bytes[0x10001] << 8) | (bytes[0x10002] << 16) | (bytes[0x10003] << 24);
  if (crc === 0) throw new Error('No saved card found in this save file (empty slot)');

  const vpkMarker = new TextEncoder().encode('vpk0');
  let vpkStart = -1;
  for (let i = CARD_REGION_START; i < Math.min(bytes.length - 4, CARD_REGION_END); i++) {
    if (bytes.slice(i, i + 4).every((b, j) => b === vpkMarker[j])) { vpkStart = i; break; }
  }

  if (vpkStart >= 0) {
    const declared = bytes[vpkStart - 2] | (bytes[vpkStart - 1] << 8) | (bytes[vpkStart + 4] << 24);
    const vpkSize = (bytes[vpkStart + 4] << 24) | (bytes[vpkStart + 5] << 16) | (bytes[vpkStart + 6] << 8) | bytes[vpkStart + 7];
    const payloadLen = Math.max(vpkSize + 8, declared);
    const end = Math.min(vpkStart + payloadLen + 0x48, bytes.length);
    const bin = new Uint8Array(0x48 + (end - vpkStart));
    bin.set(bytes.subarray(vpkStart, end), 0x48);
    return { bin, title: readSavTitle(bytes), compressed: true };
  }

  const dataSize = bytes[0x1002c] | (bytes[0x1002d] << 8) | (bytes[0x1002e] << 16) | (bytes[0x1002f] << 24);
  const payloadStart = 0x10035;
  const end = Math.min(payloadStart + Math.max(0, dataSize - 1), bytes.length);
  if (end <= payloadStart) throw new Error('Could not locate card data in save file');

  const bin = new Uint8Array(0x48 + (end - payloadStart));
  bin.set(bytes.subarray(payloadStart, end), 0x48);
  return { bin, title: readSavTitle(bytes), compressed: false };
}

function readSavTitle(bytes) {
  const end = bytes.indexOf(0, CARD_REGION_START);
  const slice = bytes.subarray(CARD_REGION_START, end > CARD_REGION_START ? end : CARD_REGION_START + 24);
  return new TextDecoder('ascii').decode(slice).replace(/\0/g, '').trim() || 'Saved card';
}

function looksLikeSav(bytes) {
  return bytes.length === SAV_SIZE || bytes.length === 0x8000;
}

export const SUPPORTED_EXTENSIONS = ['.bin', '.raw', '.dc', '.sav'];

export const FORMAT_HINTS = {
  bin: 'Decoded dotcode (.bin) from nedcenc -d or nedcmake',
  raw: 'Dotcode strip (.raw) — printable scan image data',
dc: 'Dotcode strip (.dc, same as .raw)',
};

function extensionOf(filename) {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot).toLowerCase() : '';
}

function looksLikeBin(bytes) {
  if (bytes.length === 1998 || bytes.length === 2112) return true;
  if (bytes.length === 0x840 || bytes.length === 0x540 || bytes.length === 0x81c || bytes.length === 0x51c) return true;
  const marker = new TextEncoder().encode('NINTENDO');
  for (let i = 0; i <= bytes.length - 8; i++) {
    if (bytes[i] === marker[0] && bytes.slice(i, i + 8).every((b, j) => b === marker[j])) return true;
  }
  const vpk = new TextEncoder().encode('vpk0');
  for (let i = 0; i <= bytes.length - 4; i++) {
    if (bytes.slice(i, i + 4).every((b, j) => b === vpk[j])) return true;
  }
  return bytes.length >= 0x48 && bytes[0] === 0x00 && bytes[1] === 0x30;
}

function withUploadMeta(result, filename) {
  const upload = parseUploadFilename(filename);
  return {
    ...result,
    header: parseCardHeader(result.bin),
    upload,
    classification: classifyUpload(upload),
  };
}

export function loadEreaderCard(bytes, filename = '') {
  const ext = extensionOf(filename);

  if (ext === '.raw' || ext === '.dc' || looksLikeRaw(bytes)) {
    try {
      const { bin, stripCount } = decodeRawToBin(bytes);
      return withUploadMeta({
        bin, format: 'raw', label: 'Dotcode .raw',
        detail: stripCount > 1 ? `${stripCount} strips combined` : undefined,
      }, filename);
    } catch {
    }
  }

  if (looksLikeSma4Save(bytes)) {
    const { bin, detail } = extractCardFromSma4Save(bytes);
    return withUploadMeta({ bin, format: 'sav', label: 'SMA4 smaghetti save', detail }, filename);
  }

  if (ext === '.sav' || looksLikeSav(bytes)) {
    const { bin, title, compressed } = extractCardFromSav(bytes);
    return withUploadMeta({
      bin, format: 'sav', label: 'e-Reader save',
      detail: `${title}${compressed ? ' (vpk0)' : ''}`,
    }, filename);
  }

if (looksLikeBin(bytes) || ext === '.bin' || bytes.length > 0) {
    return withUploadMeta({ bin: bytes.slice(), format: 'bin', label: 'Decoded .bin' }, filename);
  }

  throw new Error('Unrecognized card file. Use .bin, .raw, or .sav from nedcenc / card archives.');
}

export async function loadEreaderCardUploads(files) {
  const list = [...files].filter(Boolean);
  if (list.length === 0) throw new Error('No file selected');
  const file = list[0];
  const bytes = new Uint8Array(await file.arrayBuffer());
  return loadEreaderCard(bytes, file.name);
}

export function formatAcceptAttribute() {
  return SUPPORTED_EXTENSIONS.join(',') + ',application/octet-stream';
}
