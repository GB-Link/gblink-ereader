import { getActiveConnection, sendDataPacket, waitForDataPacket, ensureDataReader, reconfigureEreader } from './gblink.js';

const ERDR_MAGIC = [0x45, 0x52, 0x44, 0x52];
const USB_PACKET_SIZE = 64;
const CHUNK_DATA_MAX = 48;
const MAX_CARD_BYTES = 8192; // firmware erproto::maxCardBytes

export const ERDR_EVT = {
  PHASE: 0x10,
  COMPLETE: 0x11,
  ERROR: 0x12,
  WIRE: 0x13,
};

export const ERDR_HOST = {
  LOAD_CARD: 0x01,
  START_SCAN: 0x02,
  CANCEL_SCAN: 0x03,
  SET_WIRE_LOG: 0x04,
};

const WIRE_FLAG = {
  SCAN_ARMED: 0x01,
  IDLE_RX: 0x02,
  HANDSHAKE: 0x04,
  SUMMARY: 0x08,
  SD_FLIPPED: 0x10,
  PIO_ARMED: 0x20,
  NO_TRAFFIC: 0x40,
  SESSION: 0x80,
};

function fmtWord(value) {
  return `0x${(value & 0xffff).toString(16).toUpperCase().padStart(4, '0')}`;
}

export const EREADER_PROFILE = {
  SMA4: 1,
  POKEMON_RUBY: 2,
  SMA4_JPN: 3,
  POKEMON_RUBY_JPN: 4,
};

const PHASE_LABELS = {
  0: 'Idle',
  1: 'Connecting to game…',
  2: 'Game is loading…',
  3: 'Sending card…',
  4: 'Card accepted',
  5: 'Error',
};

const ERROR_LABELS = {
  0: 'Unknown error',
  1: 'Card too large',
  2: 'Card not loaded',
  3: 'Game rejected the card',
  4: 'Timed out',
  5: 'No GBA link traffic',
  6: 'Cancelled',
  7: 'Unexpected failure',
};

function buildHostPacket(cmd, body = new Uint8Array(0)) {
  const pkt = new Uint8Array(USB_PACKET_SIZE);
  pkt.set(ERDR_MAGIC, 0);
  pkt[4] = cmd;
  pkt.set(body, 5);
  return pkt;
}

const EVT_PAYLOAD_SIZES = {
  [ERDR_EVT.PHASE]:    3,
  [ERDR_EVT.COMPLETE]: 1,
  [ERDR_EVT.ERROR]:    3,
  [ERDR_EVT.WIRE]:     9,
};

function parseErdrPackets(data) {
  if (!data || data.byteLength < 5) return [];
  const view = data instanceof DataView
    ? data
    : new DataView(data.buffer, data.byteOffset, data.byteLength);
  const results = [];
  let offset = 0;
  while (offset + 5 <= view.byteLength) {
    if (view.getUint8(offset)     !== ERDR_MAGIC[0] ||
        view.getUint8(offset + 1) !== ERDR_MAGIC[1] ||
        view.getUint8(offset + 2) !== ERDR_MAGIC[2] ||
        view.getUint8(offset + 3) !== ERDR_MAGIC[3]) {
      offset++;
      continue;
    }
    const evt = view.getUint8(offset + 4);
    const payloadLen = EVT_PAYLOAD_SIZES[evt];
    if (payloadLen === undefined || offset + 5 + payloadLen > view.byteLength) {
      offset++;
      continue;
    }
    const payload = new Uint8Array(payloadLen);
    for (let i = 0; i < payloadLen; i++) payload[i] = view.getUint8(offset + 5 + i);
    results.push({ evt, payload });
    offset += 5 + payloadLen;
  }
  return results;
}

function describeWireEvent(payload) {
  if (payload.length < 9) return null;
  const flags = payload[0];
  const rx = payload[1] | (payload[2] << 8);
  const tx = payload[3] | (payload[4] << 8);
  const total = payload[5]
    | (payload[6] << 8)
    | (payload[7] << 16)
    | (payload[8] << 24);

  if (flags & WIRE_FLAG.SESSION) {
    return 'Ready — waiting for the game to connect';
  }
  if (flags & WIRE_FLAG.SD_FLIPPED) {
    // Firmware wrong-pin recovery: it saw the game clocking with no data and
    // switched the SD path itself — the user just needs to retry.
    const sd = rx === 1 ? 'GP4 (GBC path)' : 'GP3 (GBA path)';
    return `Game is clocking but nothing was received — switched SD to ${sd}. Press A / Connect on the GBA again.`;
  }
  if (flags & WIRE_FLAG.PIO_ARMED) {
    return 'Listening for game connection…';
  }
  if (flags & WIRE_FLAG.NO_TRAFFIC) {
    // rx = firmware's active SD path (1 = GP4/GBC), tx = pin info
    // (bit0 = SC clock activity since last report, bit1..4 = GP1..GP4 high).
    const sd = rx === 1 ? 'GP4/GBC' : 'GP3/GBA';
    const pins = (tx & 0x1f).toString(2).padStart(5, '0');
    const sc = (tx & 0x01) ? 'clocking' : 'idle';
    return `[wire] no traffic (sd=${sd}, sc=${sc}, pins=0b${pins}, total=${total})`;
  }
  if (flags & WIRE_FLAG.SUMMARY) {
    return `[wire] summary rx=${fmtWord(rx)} tx=${fmtWord(tx)} total=${total}`;
  }

  return `[wire] rx=${fmtWord(rx)} tx=${fmtWord(tx)} total=${total} flags=0x${flags.toString(16)}`;
}

function describeEvent(evt, payload) {
  if (evt === ERDR_EVT.WIRE) {
    return describeWireEvent(payload);
  }
  if (evt === ERDR_EVT.PHASE && payload.length >= 3) {
    const phase = payload[0];
    const detail = payload[1] | (payload[2] << 8);
    return PHASE_LABELS[phase] ?? null;
  }
  if (evt === ERDR_EVT.COMPLETE) {
    return 'Card accepted';
  }
  if (evt === ERDR_EVT.ERROR && payload.length >= 1) {
    const code = payload[0];
    const detail = payload.length >= 3 ? payload[1] | (payload[2] << 8) : 0;
    return ERROR_LABELS[code] ?? 'Something went wrong';
  }
  return null;
}

export function formatErdrWireMessage(raw) {
  const all = parseErdrPackets(raw);
  if (all.length === 0) return null;
  if (all.some(p => p.evt !== ERDR_EVT.WIRE)) return null;
  return describeWireEvent(all[0].payload);
}

function markPreloaded(bytes) {
  const conn = getActiveConnection();
  if (conn) {
    conn.ereaderCardPreloaded = true;
    conn.ereaderCardByteLength = bytes.length;
  }
}

export function isPreloadedPayload(bytes) {
  const conn = getActiveConnection();
  return (
    conn?.ereaderCardPreloaded === true
    && conn.ereaderCardByteLength === bytes.length
  );
}

function isPreloaded(bytes) {
  return isPreloadedPayload(bytes);
}

export async function preloadCardToAdapter(bytes) {
  const conn = getActiveConnection();
  if (!conn) throw new Error('GB-Link not connected.');
  if (bytes.length > MAX_CARD_BYTES) {
    throw new Error(`Card is too large for the adapter (${bytes.length} bytes, max ${MAX_CARD_BYTES}).`);
  }

  let offset = 0;
  while (offset < bytes.length) {
    const chunkLen = Math.min(CHUNK_DATA_MAX, bytes.length - offset);
    const body = new Uint8Array(6 + chunkLen);
    const view = new DataView(body.buffer);
    view.setUint32(0, offset, true);
    view.setUint16(4, chunkLen, true);
    body.set(bytes.subarray(offset, offset + chunkLen), 6);
    await sendDataPacket(conn, buildHostPacket(ERDR_HOST.LOAD_CARD, body));
    offset += chunkLen;
  }
  markPreloaded(bytes);
}

export async function startScan() {
  const conn = getActiveConnection();
  if (!conn) throw new Error('GB-Link not connected.');
  // Drop packets queued before this scan so a previous attempt's beacons
  // can't pre-trip the wrong-pin counter.
  if (conn.dataQueue) conn.dataQueue.length = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    ensureDataReader();
    try {
      await sendDataPacket(conn, buildHostPacket(ERDR_HOST.START_SCAN));
      return;
    } catch (err) {
      if (attempt < 2 && err instanceof DOMException && err.name === 'AbortError') {
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }
      throw err;
    }
  }
}

export async function setFirmwareWireLog(enabled) {
  const conn = getActiveConnection();
  // The data channel carries raw link words outside e-Reader mode — an ERDR
  // control frame must never be injected there.
  if (!conn?.ereaderMode) return;
  try {
    await sendDataPacket(conn, buildHostPacket(ERDR_HOST.SET_WIRE_LOG, new Uint8Array([enabled ? 1 : 0])));
  } catch {
  }
}

async function pollScanEvents({ onStatus, timeoutMs = 120_000 } = {}) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const raw = await waitForDataPacket(500);
    if (!raw) continue;

    for (const parsed of parseErdrPackets(raw)) {
      const message = describeEvent(parsed.evt, parsed.payload);
      if (message) onStatus?.(message);

      if (parsed.evt === ERDR_EVT.WIRE) continue;

      if (parsed.evt === ERDR_EVT.COMPLETE) {
        return true;
      }

      if (parsed.evt === ERDR_EVT.ERROR) {
        const code = parsed.payload[0] ?? 7;
        throw new Error(ERROR_LABELS[code] ?? 'e-Reader scan failed');
      }
    }
  }

  throw new Error('Timed out waiting for card scan to finish');
}

export async function runScan({ cardBytes, onStatus, timeoutMs = 120_000 } = {}) {
  const conn = getActiveConnection();
  if (conn?.ereaderScanCompleted) {
    await reconfigureEreader();
    if (cardBytes) {
      onStatus?.('Uploading card to adapter…');
      await preloadCardToAdapter(cardBytes);
    }
  }
  await startScan();
  onStatus?.('Card ready — follow the prompts on your Game Boy now');
  try {
    return await pollScanEvents({ onStatus, timeoutMs });
  } finally {
    if (conn) conn.ereaderScanCompleted = true;
  }
}

export { pollScanEvents };

