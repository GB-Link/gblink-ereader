const USB_FILTERS = [
  { vendorId: 0x239a },
  { vendorId: 0xcafe },
  { vendorId: 0x2fe3 },
];

const SERIAL_FILTERS = [{ usbVendorId: 0x2fe3 }];

const VSWITCH_PREFIX = new Uint8Array([
  0xca, 0xfe, 0xca, 0xfe, 0xca, 0xfe, 0xca, 0xfe,
  0xca, 0xfe, 0xca, 0xfe, 0xca, 0xfe, 0xca, 0xfe,
  0xde, 0xad, 0xbe, 0xef, 0xde, 0xad, 0xbe, 0xef,
  0xde, 0xad, 0xbe, 0xef, 0xde, 0xad, 0xbe, 0xef,
]);

const SERIAL_SYNC0 = 0x47;
const SERIAL_SYNC1 = 0x42;
const SERIAL_CH_CMD = 0x00;
const SERIAL_CH_DATA = 0x01;
const SERIAL_CH_STATUS = 0x02;
const SERIAL_MAX_PAYLOAD = 64;
const USB_PACKET_SIZE = 64;

const GBL_CMD = {
  SET_MODE: 0x00,
  CANCEL: 0x01,
  SET_VOLTAGE_3V3: 0x40,
  SET_VOLTAGE_5V: 0x41,
  GET_FIRMWARE_INFO: 0x0f,
  SET_CABLE_OVERRIDE: 0x49,
  GET_CABLE_TYPE: 0x4a,
};

const GBL_MODE = {
  GBA_TRADE_EMU: 0x00,
  GBA_LINK: 0x01,
  GB_LINK: 0x02,
  GBA_EREADER: 0x05,
};

const GBL_LINK_CMD = {
  SET_MODE_MASTER: 0x10,
  SET_MODE_SLAVE: 0x11,
  START_HANDSHAKE: 0x12,
  CONNECT_LINK: 0x13,
};

export const LINK_STATUS = {
  AWAIT_MODE: 0xff02,
  HANDSHAKE_RECEIVED: 0xff03,
  LINK_CONNECTED: 0xff05,
  LINK_RECONNECTING: 0xff06,
  LINK_CLOSED: 0xff07,
  DEVICE_READY: 0xff08,
};

const FRAME_MS = 17;

function delayFrames(frames = 1) {
  return new Promise((resolve) => setTimeout(resolve, frames * FRAME_MS));
}

async function drainStaleDataPackets(conn) {
  if (conn.kind === 'serial') {
    conn.dataQueue = [];
    return;
  }
  if (conn.kind !== 'usb') return;
  for (let i = 0; i < 32; i++) {
    try {
      const result = await Promise.race([
        conn.device.transferIn(conn.epIn, USB_PACKET_SIZE),
        new Promise((_, reject) => setTimeout(() => reject(new Error('drain idle')), 2)),
      ]);
      if (!result?.data?.byteLength) break;
    } catch {
      break;
    }
  }
  inFlightRead = null;
}

function startLinkFrameCollector(conn) {
  if (conn.kind === 'serial') {
    conn.pendingLinkFrames = [];
    conn.frameCollectorActive = true;
    return;
  }
  if (conn.dataReaderAlive) return;
  stopLinkFrameCollector(conn);
  conn.pendingLinkFrames = [];
  conn.frameCollectorStop = false;
  conn.frameCollectorPromise = (async () => {
    while (active === conn && !conn.frameCollectorStop) {
      try {
        const result = await Promise.race([
          conn.device.transferIn(conn.epIn, USB_PACKET_SIZE),
          new Promise((_, reject) => setTimeout(() => reject(new Error('poll')), 40)),
        ]);
        if (active !== conn || conn.frameCollectorStop) return;
        if (!result?.data?.byteLength) continue;
        inFlightRead = null;
        conn.pendingLinkFrames.push(readWordsFromBuffer(result.data, 8));
      } catch {
      }
    }
  })();
}

function stopLinkFrameCollector(conn) {
  if (!conn) return;
  if (conn.kind === 'serial') {
    conn.frameCollectorActive = false;
    return;
  }
  conn.frameCollectorStop = true;
}

export async function takePendingLinkFrames() {
  if (!active) return [];
  if (active.kind === 'serial') {
    stopLinkFrameCollector(active);
    const frames = [...(active.pendingLinkFrames ?? [])];
    active.pendingLinkFrames = [];
    for (let i = 0; i < 16; i++) {
      const pkt = await waitForDataPacket(5);
      if (!pkt?.byteLength) break;
      frames.push(readWordsFromBuffer(new DataView(pkt.buffer, pkt.byteOffset, pkt.byteLength), 8));
    }
    return frames;
  }
  if (active.kind !== 'usb') return [];
  stopLinkFrameCollector(active);
  if (active.frameCollectorPromise) {
    try {
      await Promise.race([active.frameCollectorPromise, new Promise((r) => setTimeout(r, 250))]);
    } catch { }
    active.frameCollectorPromise = null;
  }
  inFlightRead = null;
  const frames = [...(active.pendingLinkFrames ?? [])];
  active.pendingLinkFrames = [];
  for (let i = 0; i < 16; i++) {
    try {
      const result = await Promise.race([
        active.device.transferIn(active.epIn, USB_PACKET_SIZE),
        new Promise((_, reject) => setTimeout(() => reject(new Error('done')), 5)),
      ]);
      if (!result?.data?.byteLength) break;
      frames.push(readWordsFromBuffer(result.data, 8));
    } catch {
      break;
    }
  }
  inFlightRead = null;
  return frames;
}

const LINK_STATUS_NAMES = {
  [0xff02]: 'AwaitMode',
  [0xff03]: 'HandshakeReceived',
  [0xff05]: 'LinkConnected',
  [0xff06]: 'LinkReconnecting',
  [0xff07]: 'LinkClosed',
  [0xff08]: 'DeviceReady',
};

export function linkStatusLabel(status) {
  if (status === null || status === undefined) return '—';
  return LINK_STATUS_NAMES[status] ?? `0x${status.toString(16).toUpperCase()}`;
}

export function getLastLinkStatus() {
  return active?.lastLinkStatus ?? null;
}

function buildVswitchPacket(suffix) {
  const pkt = new Uint8Array(36);
  pkt.set(VSWITCH_PREFIX);
  pkt.set(new TextEncoder().encode(suffix), 32);
  return pkt;
}

const VSWITCH_5V_PACKET = buildVswitchPacket('V5V0');

function fwVersionAtLeast(device, major, minor, patch) {
  const dMaj = device.deviceVersionMajor ?? 0;
  const dMin = device.deviceVersionMinor ?? 0;
  const dPat = device.deviceVersionSubminor ?? 0;
  if (dMaj !== major) return dMaj > major;
  if (dMin !== minor) return dMin > minor;
  return dPat >= patch;
}

let active = null;
let inFlightRead = null;
let adapterDisconnectHandler = null;
let disconnectListenersReady = false;
let statusReaderAbort = null;
const statusWaiters = new Map();

export function onAdapterDisconnect(handler) {
  adapterDisconnectHandler = handler;
}

export function getLinkTransport() {
  return active?.transport ?? null;
}

export function cableTypeLabel(type) {
  if (type === 0) return 'GBA cable path (SD→GP3)';
  if (type === 1) return 'GBC 6-pin path (SD→GP4)';
  return 'unknown';
}

function summarizeLinkSamples(samples, idle = 0x7fff) {
  const idleLike = new Set([idle & 0xffff, 0x7fff, 0, 0xffff]);
  const nonIdle = samples.filter((w) => !idleLike.has(w));
  return { total: samples.length, nonIdle: nonIdle.length, examples: nonIdle.slice(0, 5) };
}

export { summarizeLinkSamples };

async function readDataPacket(timeoutMs = 200) {
  if (!active) return null;
  if (active.kind === 'serial') {
    return waitForDataPacket(timeoutMs);
  }
  if (active.kind !== 'usb') return null;
  // While the background data reader owns the IN endpoint, a competing
  // transferIn would race it for packets — take from its queue instead.
  if (active.dataReaderAlive) {
    return waitForDataPacket(timeoutMs);
  }
  try {
    const result = await Promise.race([
      active.device.transferIn(active.epIn, USB_PACKET_SIZE),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ]);
    if (!result?.data?.byteLength) return null;
    const bytes = new Uint8Array(
      result.data.buffer,
      result.data.byteOffset,
      result.data.byteLength,
    );
    inFlightRead = null;
    return bytes;
  } catch {
    inFlightRead = null;
    return null;
  }
}

async function readCommandResponse(expectedCmd, timeoutMs = 800) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pkt = await readDataPacket(150);
    if (pkt && pkt[0] === expectedCmd) return pkt;
  }
  return null;
}

// Firmware GetFirmwareInfo reply: [0x0F, major, minor, patch, landingPage].
// The cable type is not part of this reply; it is filled in later from the
// GET_CABLE_TYPE response.
function parseFirmwarePacket(pkt) {
  if (!pkt || pkt[0] !== GBL_CMD.GET_FIRMWARE_INFO) return null;
  return {
    major: pkt[1],
    minor: pkt[2],
    patch: pkt[3],
    landingPage: pkt[4] === 1,
    cable: null,
    version: `${pkt[1]}.${pkt[2]}.${pkt[3]}`,
  };
}

function firmwareSupportsNativeEreader(fw) {
  if (!fw) return false;
  if (fw.major > 2) return true;
  if (fw.major < 2) return false;
  if (fw.minor > 2) return true;
  return fw.minor === 2 && fw.patch >= 2;
}

async function queryFirmwareInfo(conn) {
  await sendControlCommand(conn, new Uint8Array([GBL_CMD.GET_FIRMWARE_INFO]));
  await new Promise((r) => setTimeout(r, 30));
  return parseFirmwarePacket(await readCommandResponse(GBL_CMD.GET_FIRMWARE_INFO));
}

export async function getFirmwareInfo() {
  return active?.firmwareInfo ?? null;
}

export async function setCableOverride(mode) {
  if (!active || active.transport !== 'gblink') return null;
  await sendControlCommand(active, new Uint8Array([GBL_CMD.SET_CABLE_OVERRIDE, mode]));
  await delayFrames(3);
  await drainStaleDataPackets(active);
  const cable = await queryCableType();
  const resolved = cable ?? (mode === 1 ? 0 : mode === 2 ? 1 : null);
  if (active.firmwareInfo && resolved != null) active.firmwareInfo.cable = resolved;
  active.cableOverride = mode;
  return resolved;
}
// Report-only: the firmware samples the cable once at mode entry (a GBA
// already on a link screen drives SO low, which would poison a re-sample).
export async function queryCableType() {
  if (!active || active.transport !== 'gblink') return null;
  await drainStaleDataPackets(active);
  await sendControlCommand(active, new Uint8Array([GBL_CMD.GET_CABLE_TYPE]));
  const pkt = await readCommandResponse(GBL_CMD.GET_CABLE_TYPE, 1500);
  if (!pkt) return null;
  const cable = pkt[1];
  active.detectedCable = cable;
  if (active.firmwareInfo) active.firmwareInfo.cable = cable;
  return cable;
}

function isLinkLostError(err) {
  if (!(err instanceof DOMException)) return false;
  return err.name === 'NetworkError' || err.name === 'NotFoundError';
}

function stopStatusReader() {
  statusReaderAbort?.abort();
  statusReaderAbort = null;
  for (const waiter of statusWaiters.values()) {
    clearTimeout(waiter.timer);
    waiter.reject(new Error('GB-Link disconnected'));
  }
  statusWaiters.clear();
}

function emitLinkStatus(status) {
  if (active) {
    active.lastLinkStatus = status;
    active.onLinkStatus?.(status);
  }
  for (const [expected, waiter] of statusWaiters.entries()) {
    if (status !== expected) continue;
    clearTimeout(waiter.timer);
    statusWaiters.delete(expected);
    waiter.resolve(status);
  }
}

function waitForLinkStatus(expected, timeoutMs = 5000) {
  if (!active) return Promise.reject(new Error('GB-Link not connected.'));
  if (active.lastLinkStatus === expected) return Promise.resolve(expected);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      statusWaiters.delete(expected);
      reject(new Error(`Timed out waiting for link status 0x${expected.toString(16)}`));
    }, timeoutMs);
    statusWaiters.set(expected, { resolve, reject, timer });
  });
}

function startStatusReader(conn) {
  stopStatusReader();
  if (conn.kind !== 'usb' || !conn.cmdEpIn) return;

  const controller = new AbortController();
  statusReaderAbort = controller;

  (async () => {
    let transientErrors = 0;
    while (active === conn && !controller.signal.aborted) {
      try {
        const result = await conn.device.transferIn(conn.cmdEpIn, USB_PACKET_SIZE);
        if (active !== conn || controller.signal.aborted) return;
        transientErrors = 0;
        if (result?.data?.byteLength >= 2) {
          emitLinkStatus(result.data.getUint16(0, true));
        }
      } catch (err) {
        if (active !== conn || controller.signal.aborted) return;
        if (isLinkLostError(err) && conn.ereaderMode && transientErrors < 3) {
          transientErrors++;
          await new Promise((r) => setTimeout(r, 80));
          continue;
        }
        if (isLinkLostError(err)) notifyAdapterDisconnect();
        return;
      }
    }
  })();
}

async function sendLinkCommand(conn, byte) {
  if (conn.kind === 'usb') {
    await sendUsbCommand(conn, new Uint8Array([byte]));
    return;
  }
  await sendSerialCommand(conn, new Uint8Array([byte]));
}

async function sendControlCommand(conn, bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (conn.kind === 'usb') {
    await sendUsbCommand(conn, buf);
    return;
  }
  await sendSerialCommand(conn, buf);
}

function notifyAdapterDisconnect() {
  const conn = active;
  if (!conn) return;
  stopStatusReader();
  active = null;
  inFlightRead = null;
  if (conn.kind === 'serial' || conn.dataWaiters) {
    while (conn.dataWaiters?.length > 0) conn.dataWaiters.shift().resolve(null);
    try { conn.reader?.cancel(); } catch { }
  }
  adapterDisconnectHandler?.();
}

function startDataReader(conn) {
  if (conn.kind !== 'usb' || !conn.ereaderMode) return;
  if (conn.dataReaderAlive) return;
  conn.dataQueue = conn.dataQueue ?? [];
  conn.dataWaiters = conn.dataWaiters ?? [];
  conn.dataReaderAlive = true;

  (async () => {
    let transientErrors = 0;
    try {
      while (active === conn) {
        try {
          const result = await conn.device.transferIn(conn.epIn, USB_PACKET_SIZE);
          if (active !== conn) return;
          transientErrors = 0;
          if (!result?.data?.byteLength) continue;
          const bytes = new Uint8Array(
            result.data.buffer,
            result.data.byteOffset,
            result.data.byteLength,
          );
          if (conn.wireLogHandler?.(bytes)) continue;
          const waiter = conn.dataWaiters.shift();
          if (waiter) waiter.resolve(bytes);
          else {
            if (conn.dataQueue.length >= 64) conn.dataQueue.shift();
            conn.dataQueue.push(bytes);
          }
        } catch (err) {
          if (active !== conn) return;
          if (isLinkLostError(err) && conn.ereaderMode && transientErrors < 3) {
            transientErrors++;
            await new Promise((r) => setTimeout(r, 80));
            continue;
          }
          if (isLinkLostError(err)) notifyAdapterDisconnect();
          return;
        }
      }
    } finally {
      conn.dataReaderAlive = false;
    }
  })();
}

export function ensureDataReader() {
  if (active) startDataReader(active);
}

export function setWireLogHandler(handler) {
  if (active) active.wireLogHandler = handler ?? null;
}

function setupDisconnectListeners() {
  if (disconnectListenersReady) return;
  disconnectListenersReady = true;
  navigator.usb?.addEventListener?.('disconnect', (e) => {
    if (active?.kind === 'usb' && e.device === active.device) notifyAdapterDisconnect();
  });
  navigator.serial?.addEventListener?.('disconnect', (e) => {
    const port = e.target ?? e.port;
    if (active?.kind === 'serial' && port === active.port) notifyAdapterDisconnect();
  });
}

export function isTransportAvailable() {
  return !!(navigator.usb || navigator.serial);
}

export function isConnected() {
  return active !== null;
}

export async function connect({
  linkMode = 'ereader',
  ereaderProfile = 1,
  cableOverride = 2,
  onProgress,
} = {}) {
  if (navigator.usb) {
    return connectUsb({ linkMode, ereaderProfile, cableOverride, onProgress });
  }
  if (navigator.serial) {
    return connectSerial({ linkMode, ereaderProfile, cableOverride, onProgress });
  }
  throw new Error(
    'No supported adapter transport. Use Chrome or Edge (WebUSB) or Firefox 151+ (WebSerial).',
  );
}

async function sendUsbCommand(conn, bytes) {
  await conn.device.transferOut(conn.cmdEpOut, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
}

async function applyCableOverride(conn, cableOverride, onProgress) {
  if (cableOverride) {
    const label = cableOverride === 2 ? 'GBC 6-pin (SD→GP4)' : 'GBA (SD→GP3)';
    onProgress?.(`Choosing cable path: ${label}…`);
    await sendControlCommand(conn, new Uint8Array([GBL_CMD.SET_CABLE_OVERRIDE, cableOverride & 0xff]));
    await new Promise((r) => setTimeout(r, 200));
  }
  await sendControlCommand(conn, new Uint8Array([GBL_CMD.GET_CABLE_TYPE]));
  const cablePkt = await readCommandResponse(GBL_CMD.GET_CABLE_TYPE, 3000);
  const resolved = cablePkt?.[1] ?? null;
  if (conn.firmwareInfo && resolved != null) conn.firmwareInfo.cable = resolved;
  return resolved;
}

async function configureGen3LinkSlave(conn, { cableOverride = 2, onProgress } = {}) {
  onProgress?.('Resetting adapter session…');
  await sendControlCommand(conn, new Uint8Array([GBL_CMD.CANCEL]));
  await new Promise((r) => setTimeout(r, 300));

  conn.ereaderMode = false;
  conn.gen3LinkMode = true;
  conn.cableOverride = cableOverride;

  onProgress?.('Starting GBA link mode…');
  conn.lastLinkStatus = null;
  await sendControlCommand(conn, new Uint8Array([GBL_CMD.SET_MODE, GBL_MODE.GBA_LINK]));
  await waitForLinkStatus(LINK_STATUS.DEVICE_READY, 8000);

  onProgress?.('Reading firmware version…');
  conn.firmwareInfo = await queryFirmwareInfo(conn);
  if (!conn.firmwareInfo) {
    throw new Error('Cannot communicate with adapter. Unplug and try again, or update the firmware.');
  }

  await sendControlCommand(conn, new Uint8Array([GBL_CMD.SET_VOLTAGE_3V3]));
  await new Promise((r) => setTimeout(r, 300));

  if (cableOverride) {
    await sendControlCommand(conn, new Uint8Array([GBL_CMD.SET_CABLE_OVERRIDE, cableOverride]));
  }
  conn.cableOverride = cableOverride;

  await sendLinkCommand(conn, GBL_LINK_CMD.SET_MODE_SLAVE);
  await applyCableOverride(conn, cableOverride, onProgress);
  conn.firmwareInfo = (await queryFirmwareInfo(conn)) ?? conn.firmwareInfo;
  conn.gen3SlaveArmed = true;
  conn.gen3HandshakeArmed = false;
  conn.linkSessionReady = false;

  const cableLabel = cableTypeLabel(conn.firmwareInfo?.cable);
  onProgress?.(
    `Link listener ready (${cableLabel}) — open Mystery Event link standby, click Send card, then press OK on the GBA.`,
  );
}

async function configureGbaLinkSlave(conn, { ereaderProfile = 1, cableOverride = 2, onProgress } = {}) {
  onProgress?.('Resetting adapter session…');
  await sendControlCommand(conn, new Uint8Array([GBL_CMD.CANCEL]));
  await new Promise((r) => setTimeout(r, 300));

  conn.ereaderMode = true;
  conn.gen3LinkMode = false;
  conn.ereaderProfile = ereaderProfile;
  conn.cableOverride = cableOverride;

  onProgress?.('Starting e-Reader mode…');
  conn.lastLinkStatus = null;
  await sendControlCommand(
    conn,
    new Uint8Array([GBL_CMD.SET_MODE, GBL_MODE.GBA_EREADER, ereaderProfile]),
  );
  await waitForLinkStatus(LINK_STATUS.DEVICE_READY, 8000);

  onProgress?.('Reading firmware version…');
  const fw = await queryFirmwareInfo(conn);
  if (!fw) {
    throw new Error('Cannot communicate with adapter. Unplug and try again, or update the firmware.');
  }
  if (!firmwareSupportsNativeEreader(fw)) {
    throw new Error(
      `Adapter firmware ${fw.version} is too old. Please update to firmware v2.2.2 or later.`,
    );
  }
  conn.firmwareInfo = fw;

  await sendControlCommand(conn, new Uint8Array([GBL_CMD.SET_VOLTAGE_3V3]));
  await new Promise((r) => setTimeout(r, 300));

  onProgress?.('Configuring link slave…');
  await sendLinkCommand(conn, GBL_LINK_CMD.SET_MODE_SLAVE);
  await applyCableOverride(conn, cableOverride, onProgress);

  onProgress?.('Enabling link (PIO)…');
  await sendLinkCommand(conn, GBL_LINK_CMD.START_HANDSHAKE);
  await waitForLinkStatus(LINK_STATUS.LINK_CONNECTED, 10000);
  await drainStaleDataPackets(conn);
  conn.linkSessionReady = true;
  startDataReader(conn);
}

export async function reconfigureEreader({ onProgress } = {}) {
  if (!active) throw new Error('GB-Link not connected.');

  active.lastLinkStatus = null;

  const conn = active;
  const cableOverride = conn.cableOverride ?? 0;
  const ereaderProfile = conn.ereaderProfile ?? 1;
  conn.ereaderCardPreloaded = false;
  conn.ereaderCardByteLength = 0;

  await sendControlCommand(conn, new Uint8Array([GBL_CMD.CANCEL]));
  await new Promise((r) => setTimeout(r, 300));

  conn.ereaderMode = true;
  conn.ereaderProfile = ereaderProfile;
  conn.cableOverride = cableOverride;

  await sendControlCommand(conn, new Uint8Array([GBL_CMD.SET_MODE, GBL_MODE.GBA_EREADER, ereaderProfile]));
  await waitForLinkStatus(LINK_STATUS.DEVICE_READY, 8000);

  await sendControlCommand(conn, new Uint8Array([GBL_CMD.SET_VOLTAGE_3V3]));
  await new Promise((r) => setTimeout(r, 300));

  await sendLinkCommand(conn, GBL_LINK_CMD.SET_MODE_SLAVE);

  await sendControlCommand(conn, new Uint8Array([GBL_CMD.SET_CABLE_OVERRIDE, cableOverride]));
  await new Promise((r) => setTimeout(r, 200));

  conn.dataQueue = [];

  await sendLinkCommand(conn, GBL_LINK_CMD.START_HANDSHAKE);
  await waitForLinkStatus(LINK_STATUS.LINK_CONNECTED, 10000);

  conn.linkSessionReady = true;
}

export async function startGbaLinkSession({
  timeoutMs = 60_000,
  onStatus,
  onLinkStatus,
  tryCableFlip = true,
} = {}) {
  if (!active) throw new Error('GB-Link not connected.');
  if (active.transport !== 'gblink') return;
  if (active.linkSessionReady) return;

  active.onLinkStatus = onLinkStatus;
  const progress = (message) => onStatus?.(message);

  active.linkSessionReady = false;
  active.lastLinkStatus = null;

  const armHandshake = async () => {
    if (active.gen3LinkMode) {
      if (!active.gen3SlaveArmed) {
        progress('Enabling link listener…');
        await sendLinkCommand(active, GBL_LINK_CMD.SET_MODE_SLAVE);
        active.gen3SlaveArmed = true;
      }
      progress('Arming link handshake (0xB9A0)…');
      await sendLinkCommand(active, GBL_LINK_CMD.START_HANDSHAKE);
      active.gen3HandshakeArmed = true;
    } else if (!active.gen3HandshakeArmed) {
      progress('Starting link session…');
      await sendLinkCommand(active, GBL_LINK_CMD.START_HANDSHAKE);
      active.gen3HandshakeArmed = true;
    }
  };

  await armHandshake();
  progress('Press OK on the GBA now — waiting for link…');
  startLinkFrameCollector(active);

  const waitConnected = () =>
    waitForLinkStatus(LINK_STATUS.LINK_CONNECTED, timeoutMs).then(async () => {
      active.linkSessionReady = true;
      active.onLinkStatus = null;
    });

  try {
    await waitConnected();
    progress('Link connected — exchanging event data…');
  } catch (err) {
    stopLinkFrameCollector(active);
    active.linkSessionReady = false;
    active.onLinkStatus = null;

    const altPath =
      active.cableOverride === 2 || (active.cableOverride === 0 && active.firmwareInfo?.cable === 1)
        ? 1
        : 2;
    if (tryCableFlip && active.gen3LinkMode) {
      const altLabel = altPath === 2 ? 'GP4 (GBC path)' : 'GP3 (GBA path)';
      progress(`No handshake yet — trying SD on ${altLabel}…`);
      await setCableOverride(altPath);
      await sendLinkCommand(active, GBL_LINK_CMD.START_HANDSHAKE);
      startLinkFrameCollector(active);
      try {
        await waitConnected();
        progress('Link connected — exchanging event data…');
        return;
      } catch {
        stopLinkFrameCollector(active);
      }
    }

    const last = linkStatusLabel(getLastLinkStatus());
    throw new Error(
      `GB-Link session timed out (last status: ${last}). ` +
        'No link traffic — purple/slim on GBA, gray/wide on adapter. ' +
        'Connect from the title screen before Mystery Event.',
    );
  }
}

async function connectUsb({ linkMode = 'ereader', ereaderProfile = 1, cableOverride = 2, onProgress } = {}) {
  setupDisconnectListeners();

  try {
    const existing = await navigator.usb.getDevices();
    for (const dev of existing) {
      if (dev.opened) {
        try { await dev.close(); } catch { }
      }
    }
  } catch { }

  onProgress?.('Waiting for USB permission…');
  const device = await navigator.usb.requestDevice({ filters: USB_FILTERS });

  onProgress?.('Opening adapter…');
  await device.open();

  if (device.reset) {
    try {
      await device.reset();
      await new Promise((r) => setTimeout(r, 400));
    } catch { }
  }

  await device.selectConfiguration(1);

  const isGblinkFirmware = device.vendorId === 0x2fe3;

  let ifNum = 0;
  let epIn = 1;
  let epOut = 1;
  let cmdEpOut = 1;
  let cmdEpIn = 1;

  for (const iface of device.configuration.interfaces) {
    for (const alt of iface.alternates) {
      if (alt.interfaceClass === 0xff) {
        ifNum = iface.interfaceNumber;

        const inEps = alt.endpoints
          .filter((e) => e.direction === 'in')
          .sort((a, b) => a.endpointNumber - b.endpointNumber);
        const outEps = alt.endpoints
          .filter((e) => e.direction === 'out')
          .sort((a, b) => a.endpointNumber - b.endpointNumber);

        if (isGblinkFirmware && outEps.length >= 2 && inEps.length >= 2) {
          cmdEpOut = outEps[0].endpointNumber;
          cmdEpIn = inEps[0].endpointNumber;
          epOut = outEps[1].endpointNumber;
          epIn = inEps[1].endpointNumber;
        } else {
          if (outEps.length > 0) epOut = outEps[outEps.length - 1].endpointNumber;
          if (inEps.length > 0) epIn = inEps[inEps.length - 1].endpointNumber;
          cmdEpOut = epOut;
        }
      }
    }
  }

  await device.claimInterface(ifNum);
  await device.selectAlternateInterface(ifNum, 0);

  const conn = {
    kind: 'usb',
    transport: isGblinkFirmware ? 'gblink' : 'legacy',
    device,
    epIn,
    epOut,
    cmdEpOut,
    cmdEpIn,
    lastLinkStatus: null,
    linkSessionReady: false,
    ereaderMode: false,
    gen3LinkMode: false,
    gen3SlaveArmed: false,
    gen3HandshakeArmed: false,
    ereaderProfile: 1,
    dataQueue: [],
    dataWaiters: [],
  };

  active = conn;
  inFlightRead = null;
  startStatusReader(conn);

  if (isGblinkFirmware) {
    if (linkMode === 'gen3') {
      await configureGen3LinkSlave(conn, { cableOverride, onProgress });
    } else {
      await configureGbaLinkSlave(conn, { ereaderProfile, cableOverride, onProgress });
    }
  } else {
    try {
      await device.controlTransferOut({
        requestType: 'class',
        recipient: 'interface',
        request: 0x22,
        value: 0x01,
        index: ifNum,
      });
    } catch { }

    if (fwVersionAtLeast(device, 1, 0, 6)) {
      await device.transferOut(epOut, VSWITCH_5V_PACKET);
      try {
        await Promise.race([
          device.transferIn(epIn, USB_PACKET_SIZE),
          new Promise((_, rej) => setTimeout(() => rej(new Error('ack timeout')), 500)),
        ]);
      } catch { }
    }

    await new Promise((r) => setTimeout(r, 200));
  }

  return conn;
}

function writeWordsPacket(words, wordCount = 32) {
  const pkt = new Uint8Array(USB_PACKET_SIZE);
  const view = new DataView(pkt.buffer);
  const count = Math.min(wordCount, words.length, USB_PACKET_SIZE / 2);
  for (let i = 0; i < count; i++) {
    view.setUint16(i * 2, words[i] & 0xffff, true);
  }
  return pkt;
}

function readWordsFromBuffer(buffer, wordCount = 8) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const words = new Uint16Array(wordCount);
  for (let i = 0; i < wordCount; i++) {
    words[i] = view.getUint16(i * 2, true);
  }
  return words;
}

export async function exchangeWord(word) {
  if (!active) throw new Error('GB-Link not connected.');
  if (active.transport !== 'gblink') {
    throw new Error('exchangeWord requires GB-Link GBA firmware');
  }

  const value = word & 0xffff;

  if (active.ereaderMode) {
    throw new Error('Link words are handled by firmware in e-Reader mode. Use Send card.');
  }

  const frame = new Uint16Array(8);
  frame.fill(value);
  const received = await exchangeLinkFrame(frame);
  return received[0];
}

export async function exchangeLinkFrame(words) {
  if (!active) throw new Error('GB-Link not connected.');
  if (active.transport !== 'gblink') {
    throw new Error('exchangeLinkFrame requires GB-Link GBA firmware');
  }

  const frame = new Uint16Array(8);
  for (let i = 0; i < 8; i++) frame[i] = words[i] & 0xffff;

  try {
    const outPkt = writeWordsPacket(frame, 8);
    if (active.kind === 'serial') {
      await writeSerialFrame(active, SERIAL_CH_DATA, outPkt);
    } else {
      await active.device.transferOut(active.epOut, outPkt);
    }
    const received = await receiveLinkPacket(8, 30_000);
    if (!received) {
      throw new Error(
        'No response from adapter during link exchange. ' +
          'Press OK on the GBA after Send card, or disconnect and reconnect if the game already showed Link error.',
      );
    }
    return received;
  } catch (err) {
    if (isLinkLostError(err)) notifyAdapterDisconnect();
    throw err;
  }
}

async function receiveLinkPacket(wordCount, timeoutMs = 0) {
  if (active?.kind === 'serial') {
    const readPromise = waitForDataPacket(timeoutMs > 0 ? timeoutMs : 30_000).then((pkt) => {
      if (inFlightRead === readPromise) inFlightRead = null;
      if (!pkt?.byteLength) return null;
      return readWordsFromBuffer(new DataView(pkt.buffer, pkt.byteOffset, pkt.byteLength), wordCount);
    });
    inFlightRead = readPromise;
    return readPromise;
  }

  if (inFlightRead) {
    await Promise.race([
      inFlightRead,
      new Promise((resolve) => setTimeout(resolve, Math.max(timeoutMs, 3000))),
    ]);
  }

  const transferPromise = active.device
    .transferIn(active.epIn, USB_PACKET_SIZE)
    .then((result) => {
      if (inFlightRead === transferPromise) inFlightRead = null;
      if (!result?.data?.byteLength) return null;
      return readWordsFromBuffer(result.data, wordCount);
    })
    .catch((err) => {
      if (inFlightRead === transferPromise) inFlightRead = null;
      if (isLinkLostError(err)) {
        notifyAdapterDisconnect();
        return null;
      }
      throw err;
    });

  inFlightRead = transferPromise;

  if (timeoutMs > 0) {
    const result = await Promise.race([
      transferPromise,
      new Promise((resolve) => setTimeout(() => resolve('__timeout__'), timeoutMs)),
    ]);
    if (result === '__timeout__') return null;
    return result;
  }

  return transferPromise;
}

function createSerialRxState() {
  return {
    state: 'sync1',
    channel: 0,
    len: 0,
    buf: null,
    pos: 0,
  };
}

function dispatchSerialFrame(conn, channel, frame) {
  if (channel === SERIAL_CH_STATUS && frame?.byteLength >= 2) {
    emitLinkStatus(new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint16(0, true));
    return;
  }
  if (channel === SERIAL_CH_DATA) {
    dispatchSerialDataFrame(conn, frame);
  }
}

function feedSerialByte(conn, b) {
  const rx = conn.rx;
  switch (rx.state) {
    case 'sync1':
      if (b === SERIAL_SYNC0) rx.state = 'sync2';
      break;
    case 'sync2':
      if (b === SERIAL_SYNC1) rx.state = 'channel';
      else if (b === SERIAL_SYNC0) rx.state = 'sync2';
      else rx.state = 'sync1';
      break;
    case 'channel':
      rx.channel = b;
      rx.state = 'lenLo';
      break;
    case 'lenLo':
      rx.len = b;
      rx.state = 'lenHi';
      break;
    case 'lenHi':
      rx.len |= b << 8;
      if (rx.len > SERIAL_MAX_PAYLOAD) {
        rx.state = 'sync1';
        break;
      }
      rx.pos = 0;
      rx.buf = new Uint8Array(rx.len);
      if (rx.len === 0) {
        dispatchSerialFrame(conn, rx.channel, rx.buf);
        rx.state = 'sync1';
      } else {
        rx.state = 'payload';
      }
      break;
    case 'payload':
      rx.buf[rx.pos++] = b;
      if (rx.pos >= rx.len) {
        dispatchSerialFrame(conn, rx.channel, rx.buf);
        rx.state = 'sync1';
      }
      break;
    default:
      rx.state = 'sync1';
      break;
  }
}

function runSerialReadLoop(conn) {
  (async () => {
    try {
      while (active === conn && conn.reader) {
        const { value, done } = await conn.reader.read();
        if (done) {
          if (active === conn) notifyAdapterDisconnect();
          break;
        }
        if (!value?.length) continue;
        for (let i = 0; i < value.length; i++) feedSerialByte(conn, value[i]);
      }
    } catch (err) {
      if (active === conn) {
        if (isLinkLostError(err)) notifyAdapterDisconnect();
      }
    }
  })();
}

async function writeSerialFrame(conn, channel, payload) {
  if (!conn.writer) throw new Error('GB-Link not connected.');
  if (payload.length > SERIAL_MAX_PAYLOAD) throw new Error('Serial payload too large');
  const frame = new Uint8Array(5 + payload.length);
  frame[0] = SERIAL_SYNC0;
  frame[1] = SERIAL_SYNC1;
  frame[2] = channel;
  frame[3] = payload.length & 0xff;
  frame[4] = (payload.length >> 8) & 0xff;
  frame.set(payload, 5);
  try {
    await conn.writer.write(frame);
  } catch (err) {
    if (isLinkLostError(err)) notifyAdapterDisconnect();
    throw err;
  }
}

async function sendSerialCommand(conn, bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  await writeSerialFrame(conn, SERIAL_CH_CMD, buf);
}

function dispatchSerialDataFrame(conn, frame) {
  if (conn.wireLogHandler?.(frame)) return;
  if (conn.frameCollectorActive && frame?.byteLength >= 16) {
    conn.pendingLinkFrames = conn.pendingLinkFrames ?? [];
    conn.pendingLinkFrames.push(
      readWordsFromBuffer(new DataView(frame.buffer, frame.byteOffset, frame.byteLength), 8),
    );
    return;
  }
  const waiter = conn.dataWaiters.shift();
  if (waiter) waiter.resolve(frame);
  else {
    if (conn.dataQueue.length >= 64) conn.dataQueue.shift();
    conn.dataQueue.push(frame);
  }
}

async function configureGbaLinkSlaveSerial(conn, opts) {
  await configureGbaLinkSlave(conn, opts);
}

async function configureGen3LinkSlaveSerial(conn, opts) {
  await configureGen3LinkSlave(conn, opts);
}

async function connectSerial({ linkMode = 'ereader', ereaderProfile = 1, cableOverride = 2, onProgress } = {}) {
  setupDisconnectListeners();

  const port = await navigator.serial.requestPort({ filters: SERIAL_FILTERS });
  port.addEventListener?.('disconnect', () => {
    if (active?.kind === 'serial' && active.port === port) notifyAdapterDisconnect();
  });
  await port.open({ baudRate: 115200 });

  const writer = port.writable.getWriter();
  const reader = port.readable.getReader();
  const conn = {
    kind: 'serial',
    transport: 'gblink',
    port,
    writer,
    reader,
    dataQueue: [],
    dataWaiters: [],
    rx: createSerialRxState(),
    lastLinkStatus: null,
    linkSessionReady: false,
    ereaderMode: false,
    gen3LinkMode: false,
    gen3SlaveArmed: false,
    gen3HandshakeArmed: false,
    ereaderProfile: 1,
  };

  active = conn;
  inFlightRead = null;
  runSerialReadLoop(conn);

  if (linkMode === 'gen3') {
    await configureGen3LinkSlaveSerial(conn, { cableOverride, onProgress });
  } else {
    await configureGbaLinkSlaveSerial(conn, { ereaderProfile, cableOverride, onProgress });
  }

  return conn;
}

export function getActiveConnection() {
  return active;
}

export async function sendDataPacket(conn, packet) {
  if (!conn) throw new Error('GB-Link not connected.');
  const buf = packet instanceof Uint8Array ? packet : new Uint8Array(packet);
  if (conn.kind === 'usb') {
    try {
      await conn.device.transferOut(conn.epOut, buf);
    } catch (err) {
      if (isLinkLostError(err)) notifyAdapterDisconnect();
      throw err;
    }
    return;
  }
  await writeSerialFrame(conn, SERIAL_CH_DATA, buf);
}

export async function waitForDataPacket(timeoutMs = 500) {
  if (!active) return null;
  if (active.dataQueue?.length) return active.dataQueue.shift();

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const idx = active?.dataWaiters?.indexOf(waiter);
      if (idx >= 0) active.dataWaiters.splice(idx, 1);
      resolve(null);
    }, timeoutMs);

    const waiter = {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
    };
    active.dataWaiters = active.dataWaiters ?? [];
    active.dataWaiters.push(waiter);
  });
}

export async function disconnect() {
  stopStatusReader();
  const a = active;
  active = null;
  inFlightRead = null;
  if (!a) return;

  if (a.kind === 'usb') {
    while (a.dataWaiters?.length > 0) {
      a.dataWaiters.shift().resolve(null);
    }
    try { await sendControlCommand(a, new Uint8Array([GBL_CMD.CANCEL])); } catch { }
    try { await a.device.close(); } catch { }
    return;
  }

  while (a.dataWaiters.length > 0) {
    const waiter = a.dataWaiters.shift();
    waiter.resolve(null);
  }

  try { await sendSerialCommand(a, new Uint8Array([GBL_CMD.CANCEL])); } catch { }
  try { await a.reader?.cancel(); } catch { }
  try { a.reader?.releaseLock(); } catch { }
  try { a.writer?.releaseLock(); } catch { }
  try { await a.port?.close(); } catch { }
}

export async function sendByte(byte) {
  if (!active) throw new Error('GB-Link not connected.');
  if (active.transport === 'gblink') {
    throw new Error('Byte transfers are not used in GBA link mode — use transferWord()');
  }
  try {
    if (active.kind === 'usb') {
      await active.device.transferOut(active.epOut, new Uint8Array([byte & 0xff]));
      return;
    }
    await writeSerialFrame(active, SERIAL_CH_DATA, new Uint8Array([byte & 0xff]));
  } catch (err) {
    if (isLinkLostError(err)) {
      notifyAdapterDisconnect();
    }
    throw err;
  }
}

function waitSerialDataFrame(conn) {
  if (conn.dataQueue.length > 0) return Promise.resolve(conn.dataQueue.shift());
  return new Promise((resolve) => {
    conn.dataWaiters.push({ resolve });
  });
}

export function receiveByte() {
  if (!active) return Promise.resolve(null);
  if (active.transport === 'gblink') {
    return Promise.reject(new Error('Byte transfers are not used in GBA link mode — use transferWord()'));
  }

  if (inFlightRead) return inFlightRead;

  if (active.kind === 'usb') {
    const dev = active.device;
    const epIn = active.epIn;

    inFlightRead = dev
      .transferIn(epIn, USB_PACKET_SIZE)
      .then((result) => {
        inFlightRead = null;
        if (!result?.data?.byteLength) return null;
        return result.data.getUint8(0);
      })
      .catch((err) => {
        inFlightRead = null;
        if (isLinkLostError(err)) {
          notifyAdapterDisconnect();
          return null;
        }
        return null;
      });

    return inFlightRead;
  }

  inFlightRead = waitSerialDataFrame(active)
    .then((frame) => {
      inFlightRead = null;
      if (!frame?.length) return null;
      return frame[0];
    })
    .catch((err) => {
      inFlightRead = null;
      if (isLinkLostError(err)) {
        notifyAdapterDisconnect();
        return null;
      }
      return null;
    });

  return inFlightRead;
}
