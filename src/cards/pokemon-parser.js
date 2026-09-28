class BitReader {
  constructor(bytes, start = 0) {
    this.bytes = bytes;
    this.pos = start;
    this.bitPos = 0;
  }
  readBit() {
    if (this.pos >= this.bytes.length) throw new Error('vpk0: unexpected end of input');
    const bit = (this.bytes[this.pos] >> (7 - this.bitPos)) & 1;
    this.bitPos++;
    if (this.bitPos === 8) { this.bitPos = 0; this.pos++; }
    return bit;
  }
  readBits(count) {
    let value = 0;
    for (let i = 0; i < count; i++) value = (value << 1) | this.readBit();
    return value;
  }
  readBytes(count) {
    if (this.bitPos !== 0) throw new Error('vpk0: misaligned byte read');
    const slice = this.bytes.subarray(this.pos, this.pos + count);
    this.pos += count;
    return slice;
  }
}

function readTree(bits) {
  const entries = [];
  const stack = [];
  while (true) {
    if (bits.readBit()) {
      if (stack.length < 2) break;
      const right = stack.pop();
      const left = stack.pop();
      entries.push({ type: 'node', left, right });
    } else {
      entries.push({ type: 'leaf', size: bits.readBits(8) });
    }
    stack.push(entries.length - 1);
  }
  return entries;
}

function readTreeValue(bits, entries) {
  if (entries.length === 0) return 0;
  let idx = entries.length - 1;
  while (entries[idx].type === 'node') {
    idx = bits.readBit() ? entries[idx].right : entries[idx].left;
  }
  return bits.readBits(entries[idx].size);
}

function decompressVpk0(bytes) {
  if (bytes.length < 9) throw new Error('vpk0: data too short');
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== 'vpk0') throw new Error('vpk0: bad magic');
  const size = (bytes[4] << 24) | (bytes[5] << 16) | (bytes[6] << 8) | bytes[7];
  const method = bytes[8];
  const bits = new BitReader(bytes, 9);
  const offsetTree = readTree(bits);
  const lengthTree = readTree(bits);
  const output = new Uint8Array(size);
  let outPos = 0;
  while (outPos < size) {
    if (bits.readBit()) {
      let moveBack = readTreeValue(bits, offsetTree);
      if (method === 1) {
        if (moveBack < 3) {
          const second = readTreeValue(bits, offsetTree);
          moveBack = moveBack + 1 + (second << 2) - 8;
        } else {
          moveBack = (moveBack << 2) - 8;
        }
      }
      if (moveBack > outPos) throw new Error('vpk0: bad lookback');
      const start = outPos - moveBack;
      const copyLen = readTreeValue(bits, lengthTree);
      for (let i = 0; i < copyLen; i++) output[outPos++] = output[start + i];
    } else {
      output[outPos++] = bits.readBits(8);
    }
  }
  return output;
}

function decompressFirstVpk0FromBin(bin) {
  const marker = new TextEncoder().encode('vpk0');
  let idx = -1;
  for (let i = 0; i <= bin.length - 4; i++) {
    if (bin[i] === marker[0] && bin[i + 1] === marker[1] && bin[i + 2] === marker[2] && bin[i + 3] === marker[3]) {
      idx = i;
      break;
    }
  }
  if (idx < 0) throw new Error('No vpk0 chunk found in card file');
  return decompressVpk0(bin.subarray(idx));
}

const MYSTERY_EVENT_HEADER_SIZE = 17;
const END_OF_CHUNKS = 0x02;

const CHUNK_LENGTHS = [0, 0, 0, 6, 2, 5, 12, 5, 3, 1, 2, 5, 5, 5, 1, 13, 13];

function isMysteryEventLanguage(byte) {
  // Official cards use 1–7. Custom dumps often use 0xFF as “any language”.
  return (byte >= 0x01 && byte <= 0x07) || byte === 0xFF;
}

export function looksLikeMysteryEvent(bytes, offset = 0) {
  return (
    bytes.length >= offset + 17 &&
    bytes[offset] === 0x01 &&
    bytes[offset + 1] === 0x00 &&
    bytes[offset + 2] === 0x00 &&
    bytes[offset + 3] === 0x00 &&
    bytes[offset + 4] === 0x02 &&
    isMysteryEventLanguage(bytes[offset + 5]) &&
    bytes[offset + 6] === 0x00 &&
    bytes[offset + 7] === bytes[offset + 5] &&
    bytes[offset + 11] === 0x04 &&
    bytes[offset + 12] === 0x00 &&
    bytes[offset + 13] === 0x80 &&
    // Gen 3 version id: 1 Sapphire, 2 Ruby, 3 Emerald, 4 FireRed, 5 LeafGreen
    bytes[offset + 14] >= 0x01 &&
    bytes[offset + 14] <= 0x05 &&
    bytes[offset + 15] === 0x00
  );
}

function findMysteryEventStart(dec) {
  for (let i = 0; i <= dec.length - 16; i++) {
    if (looksLikeMysteryEvent(dec, i)) return i;
  }
  throw new Error('Could not find mystery-event data in card file');
}

function readU32Le(bytes, offset) {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  );
}

function mysteryEventLength(dec, start) {
  const base = readU32Le(dec, start + 1);
  const crcChunk = start + MYSTERY_EVENT_HEADER_SIZE;

  if (dec.length >= crcChunk + 13 && dec[crcChunk] === 0x10 && base >= 0x02000000) {
    const dataEnd = readU32Le(dec, crcChunk + 9);
    const size = dataEnd - base;
    if (size > MYSTERY_EVENT_HEADER_SIZE && size <= 0x2004 && start + size <= dec.length) {
      return size;
    }
  }

  let end = start + MYSTERY_EVENT_HEADER_SIZE;
  const limit = Math.min(dec.length, start + 0x2004);
  let battleTrainerDataStart = -1;
  let enigmaBerryDataStart = -1;
  while (end < limit) {
    const chunkType = dec[end];
    if (chunkType === END_OF_CHUNKS) { end += 1; break; }
    const chunkLen = CHUNK_LENGTHS[chunkType];
    if (!chunkLen) throw new Error(`Unknown mystery-event chunk 0x${chunkType.toString(16)}`);
    if (chunkType === 0x0d && base >= 0x02000000 && dec.length >= end + 5) {
      battleTrainerDataStart = readU32Le(dec, end + 1) - base;
    }
    if (chunkType === 0x07 && base >= 0x02000000 && dec.length >= end + 5) {
      enigmaBerryDataStart = readU32Le(dec, end + 1) - base;
    }
    end += chunkLen;
  }

  if (battleTrainerDataStart >= 0) {
    const size = battleTrainerDataStart + 0xB8 + 4 + 1;
    if (size > MYSTERY_EVENT_HEADER_SIZE && size <= 0x2004 && start + size <= dec.length) return size;
  }

  if (enigmaBerryDataStart >= 0) {
    const size = enigmaBerryDataStart + 0x530 + 1;
    if (size > MYSTERY_EVENT_HEADER_SIZE && size <= 0x2004 && start + size <= dec.length) return size;
  }

  for (; end < limit; end++) {
    if (dec[end] === 0xff) { end += 1; break; }
  }

  if (end <= start + MYSTERY_EVENT_HEADER_SIZE) throw new Error('Could not locate end of mystery-event data');
  return end - start;
}

const MAX_MYSTERY_UPLOAD = 8192;

function sliceMysteryEvent(bytes, start) {
  if (bytes.length - start <= MAX_MYSTERY_UPLOAD) return bytes.subarray(start);

  let end = start + mysteryEventLength(bytes, start);
  while (end < bytes.length) {
    let next = end;
    const windowEnd = Math.min(bytes.length, end + 16);
    while (next < windowEnd && !looksLikeMysteryEvent(bytes, next)) next++;
    if (next >= windowEnd || !looksLikeMysteryEvent(bytes, next)) break;
    let size;
    try {
      size = mysteryEventLength(bytes, next);
    } catch {
      break;
    }
    if (next + size - start > MAX_MYSTERY_UPLOAD) break;
    end = next + size;
  }
  return bytes.subarray(start, end);
}

function extractMysteryEventFromDecompressed(dec) {
  const start = findMysteryEventStart(dec);
  mysteryEventLength(dec, start);
  return sliceMysteryEvent(dec, start);
}

function extractMysteryEventBlob(bytes) {
  if (looksLikeMysteryEvent(bytes, 0)) {
    mysteryEventLength(bytes, 0);
    return sliceMysteryEvent(bytes, 0);
  }
  return extractMysteryEventFromDecompressed(bytes);
}

export function parsePokemonMysteryEventCard(bytes) {
  if (bytes.length === 2912 || bytes.length === 2900) {
    throw new Error(
      'Dotcode .raw files are not supported. Use the .sav or .bin version of this card instead.',
    );
  }

  if (bytes.length >= MYSTERY_EVENT_HEADER_SIZE && looksLikeMysteryEvent(bytes, 0)) {
    const payload = extractMysteryEventBlob(bytes);
    return { payload: payload.slice(), source: 'mystery-event' };
  }

  const marker = new TextEncoder().encode('vpk0');
  const hasVpk = (() => {
    for (let i = 0; i <= bytes.length - 4; i++) {
      if (bytes[i] === marker[0] && bytes[i + 1] === marker[1] && bytes[i + 2] === marker[2] && bytes[i + 3] === marker[3]) {
        return true;
      }
    }
    return false;
  })();

  if (hasVpk) {
    const dec = decompressFirstVpk0FromBin(bytes);
    const payload = extractMysteryEventBlob(dec);
    return { payload: payload.slice(), source: 'bin-vpk0' };
  }

  if (bytes.length >= 0x200) {
    try {
      const payload = extractMysteryEventBlob(bytes);
      return { payload: payload.slice(), source: 'bin-plain' };
    } catch {
    }
  }

  throw new Error(
    'No mystery-event data found. Use a Pokémon mystery-event .bin, .raw, or .sav file.',
  );
}

export function getCardPayloadOffset(bytes) {
  parsePokemonMysteryEventCard(bytes);
  return 0;
}
