import {
  connect,
  disconnect,
  getFirmwareInfo,
  getActiveConnection,
  cableTypeLabel,
  isConnected,
  isTransportAvailable,
  onAdapterDisconnect,
  setWireLogHandler,
} from './link/gblink.js';
import { formatErdrWireMessage, setFirmwareWireLog, isSma4EreaderProfile } from './link/ereader-mode.js';
import { GAMES, getGame } from './games/index.js';
import { loadEreaderCardUploads, assembleCardUploads, formatAcceptAttribute } from './cards/loader.js';
import { detectCardGames, validateCardForGame } from './cards/detect.js';
import { formatUploadLabel } from './cards/upload.js';
import './launcher-return.js';

const gameSelect = document.getElementById('game-select');
const gameGuide = document.getElementById('game-guide');
const gameGuideBody = document.getElementById('game-guide-body');
const dropZone = document.getElementById('drop-zone');
const dropZoneLabel = document.getElementById('drop-zone-label');
const dropZoneSub = document.getElementById('drop-zone-sub');
const cardFile = document.getElementById('card-file');
const cardInfo = document.getElementById('card-info');
const cardFormatsEl = document.getElementById('card-formats');
const stripSet = document.getElementById('strip-set');
const stripSetTitle = document.getElementById('strip-set-title');
const stripSetList = document.getElementById('strip-set-list');
const stripSetClear = document.getElementById('strip-set-clear');
const statusText = document.getElementById('status-text');
const detailText = document.getElementById('detail-text');
const statusIndicator = document.getElementById('status-indicator');
const instructionBox = document.getElementById('instruction-box');
const instructionText = document.getElementById('instruction-text');
const cardDisplay = document.getElementById('card-display');
const cardDisplayTitle = document.getElementById('card-display-title');
const cardDisplayBadge = document.getElementById('card-display-badge');
const cardDisplaySub = document.getElementById('card-display-sub');
const connectBtn = document.getElementById('connect-btn');
const disconnectBtn = document.getElementById('disconnect-btn');
const stepper = document.getElementById('stepper');
const logEl = document.getElementById('log');
const copyLogBtn = document.getElementById('copy-log-btn');

let cardBytes = null;
let cardMeta = null;
let pendingStrips = [];
let loadedParts = [];
let busy = false;
let selectedGameId = GAMES[0]?.id ?? '';
let userSelectedGame = false;

const PHASE_CONFIG = {
  idle: {
    step: -1,
    message: 'Ready',
    instruction: 'Choose a game and upload a card.',
    type: 'idle',
  },
  no_transport: {
    step: -1,
    message: 'Browser not supported',
    instruction: 'Use Chrome, Edge, or Firefox 151+ over HTTPS.',
    type: 'error',
  },
  card_loaded: {
    step: 1,
    message: 'Card loaded',
    instruction: 'Click Connect Game Boy.',
    type: 'idle',
  },
  card_partial: {
    step: 1,
    message: 'Need the other strip',
    instruction: 'This card uses two strips. Add the remaining file — order does not matter.',
    type: 'idle',
  },
  connecting: {
    step: 0,
    message: 'Connecting to adapter…',
    instruction: 'Select your GB-Link adapter.',
    type: 'active',
  },
  connected: {
    step: 2,
    message: 'Adapter connected',
    instruction: '',
    type: 'active',
  },
  scanning: {
    step: 3,
    message: 'Sending card…',
    instruction: 'Keep the link cable connected.',
    type: 'active',
  },
  complete: {
    step: 4,
    message: 'Card sent!',
    instruction: 'Upload another card to send again, or disconnect when finished.',
    type: 'success',
  },
  error: {
    step: -1,
    message: 'Something went wrong',
    instruction: '',
    type: 'error',
  },
  disconnected: {
    step: -1,
    message: 'Disconnected',
    instruction: 'Click Connect Game Boy to try again.',
    type: 'idle',
  },
};

function selectGame(gameId) {
  if (!gameId || !getGame(gameId)) return;
  selectedGameId = gameId;
  gameSelect.value = gameId;
  updateGameGuide();
}

function describeDetection(detection) {
  if (!detection.supported) {
    const kind = detection.classification?.label ?? 'this card type';
    return `Not supported over GB-Link (${kind}).`;
  }
  if (!detection.matches.length) {
    return 'Supported over GB-Link.';
  }
  const top = detection.matches[0];
  const game = getGame(top.gameId);
  if (!game) return 'Supported over GB-Link.';
  if (detection.matches.length === 1) {
    return `Ready for ${game.label}.`;
  }
  const also = detection.matches
    .slice(1)
    .map((m) => getGame(m.gameId)?.label)
    .filter(Boolean);
  if (also.length) {
    return `Best match ${game.label} (also ${also.join(', ')}).`;
  }
  return `Ready for ${game.label}.`;
}


function validateLoadedCard(bin, gameId) {
  try {
    validateCardForGame(bin, gameId);
    return null;
  } catch (err) {
    return err.message;
  }
}

function clearAdapterCardCache() {
  const conn = getActiveConnection();
  if (conn) {
    conn.ereaderCardPreloaded = false;
    conn.ereaderCardByteLength = 0;
  }
}

async function preloadCardToAdapter() {
  if (!isConnected() || !cardBytes) return;
  const game = selectedGame();
  if (!game?.preloadCard) return;
  try {
    await game.preloadCard(cardBytes);
    if (game.linkMode === 'ereader') {
      log('Card pre-loaded to adapter');
    }
  } catch (err) {
    log(`Card preload skipped: ${err.message}`);
  }
}

function selectedGame() {
  return getGame(selectedGameId);
}

function connectedInstruction() {
  return selectedGame()?.connectedInstruction ?? 'Start e-Reader in the game, then send the card.';
}

function populateGameSelect() {
  gameSelect.replaceChildren();
  for (const game of GAMES) {
    const option = document.createElement('option');
    option.value = game.id;
    option.textContent = game.label;
    gameSelect.appendChild(option);
  }
  selectedGameId = GAMES[0]?.id ?? '';
  gameSelect.value = selectedGameId;
  updateGameGuide();
}

function updateGameGuide() {
  if (!gameGuide || !gameGuideBody) return;
  const guide = selectedGame()?.startGuide;
  if (!guide?.sections?.length) {
    gameGuide.hidden = true;
    gameGuideBody.replaceChildren();
    return;
  }

  const frag = document.createDocumentFragment();
  for (const section of guide.sections) {
    const sectionEl = document.createElement('div');
    sectionEl.className = 'game-guide-section';

    if (section.title) {
      const title = document.createElement('h3');
      title.className = 'game-guide-title';
      title.textContent = section.title;
      sectionEl.appendChild(title);
    }

    if (section.note) {
      const note = document.createElement('p');
      note.className = 'game-guide-note';
      note.innerHTML = section.note;
      sectionEl.appendChild(note);
    }

    if (section.steps?.length) {
      const list = document.createElement('ol');
      list.className = 'game-guide-steps';
      for (const step of section.steps) {
        const item = document.createElement('li');
        item.innerHTML = step;
        list.appendChild(item);
      }
      sectionEl.appendChild(list);
    }

    frag.appendChild(sectionEl);
  }

  if (guide.links?.length) {
    const linksEl = document.createElement('div');
    linksEl.className = 'game-guide-section game-guide-links';

    const title = document.createElement('h3');
    title.className = 'game-guide-title';
    title.textContent = 'Useful links';
    linksEl.appendChild(title);

    const list = document.createElement('ul');
    list.className = 'game-guide-link-list';
    for (const link of guide.links) {
      const item = document.createElement('li');
      const anchor = document.createElement('a');
      anchor.href = link.href;
      anchor.className = 'game-guide-link';

      if (link.download) {
        anchor.setAttribute(
          'download',
          typeof link.download === 'string' ? link.download : '',
        );
      } else {
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
      }

      const label = document.createElement('span');
      label.textContent = link.label;
      anchor.appendChild(label);

      if (!link.download) {
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('class', 'external-link-icon');
        icon.setAttribute('viewBox', '0 0 16 16');
        icon.setAttribute('aria-hidden', 'true');
        icon.setAttribute('focusable', 'false');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute(
          'd',
          'M6.5 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9.5'
          + 'M10 2h4v4M14 2 8 8',
        );
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', 'currentColor');
        path.setAttribute('stroke-width', '1.5');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        icon.appendChild(path);
        anchor.appendChild(icon);
      }

      item.appendChild(anchor);
      list.appendChild(item);
    }
    linksEl.appendChild(list);
    frag.appendChild(linksEl);
  }

  gameGuideBody.replaceChildren(frag);
  gameGuide.hidden = false;
}

function showCardDisplay(upload, cardClassification, uploadClassification, detail) {
  const title = (detail ? detail.replace(/\s*\(vpk0\)$/i, '') : null) || (upload?.displayTitle ?? upload?.family ?? '');
  const id = upload?.catalogId ?? '';
  const series = upload?.subset ?? '';
  const type = cardClassification?.type;

  cardDisplayTitle.textContent = title;

  let badgeLabel = null;
  let badgeType = null;
  if (type === 'level' || type === 'power-up' || type === 'demo') {
    badgeLabel = type === 'power-up' ? 'Power-Up' : type === 'level' ? 'Level' : 'Demo';
    badgeType = type;
  } else if (type === 'berry') {
    badgeLabel = 'Berry Card';
    badgeType = 'neutral';
  } else if (type === 'trainer') {
    badgeLabel = 'Battle-e Trainer';
    badgeType = 'neutral';
  } else if (type === 'mystery-event') {
    badgeLabel = 'Mystery Event';
    badgeType = 'neutral';
  } else if (uploadClassification?.label) {
    badgeLabel = uploadClassification.label
      .replace(/^pokemon\s+/i, '')
      .replace(/\be-card\b/i, 'e-Card')
      .replace(/\b\w/g, (c) => c.toUpperCase());
    badgeType = 'neutral';
  }

  if (badgeLabel) {
    cardDisplayBadge.textContent = badgeLabel;
    cardDisplayBadge.dataset.type = badgeType;
    cardDisplayBadge.classList.remove('hidden');
  } else {
    cardDisplayBadge.textContent = '';
    delete cardDisplayBadge.dataset.type;
    cardDisplayBadge.classList.add('hidden');
  }

  const sub = [id, series].filter(Boolean).join(' · ');
  cardDisplaySub.textContent = sub;
  cardDisplaySub.classList.toggle('hidden', !sub);

  cardInfo.classList.add('hidden');
  cardDisplay.classList.remove('hidden');
}

function hideCardDisplay() {
  cardDisplay.classList.add('hidden');
  cardInfo.classList.remove('hidden');
}

function resetDropZoneCopy() {
  dropZone?.classList.remove('awaiting-strip');
  if (dropZoneLabel) dropZoneLabel.textContent = 'Drop e-Reader card file here';
  if (dropZoneSub) dropZoneSub.textContent = 'or both strips of a two-strip card — order does not matter';
}

function hideStripSet() {
  stripSet?.classList.add('hidden');
  if (stripSetList) stripSetList.replaceChildren();
}

function renderStripSet(parts, { stripCount, missing } = {}) {
  if (!stripSet || !stripSetList) return;
  const expected = stripCount ?? parts[0]?.stripCount ?? parts.length;
  const missingList = missing ?? [];
  stripSetTitle.textContent = missingList.length
    ? `${parts.length} of ${expected} strips`
    : `${expected} strips combined`;
  stripSetList.replaceChildren();
  for (const part of parts) {
    const item = document.createElement('li');
    item.className = 'strip-set-item';
    const name = document.createElement('span');
    name.className = 'strip-set-item-name';
    const fileLabel = part.filename || part.upload?.basename || 'Strip';
    name.textContent = `Strip ${part.stripNo} of ${part.stripCount} — ${fileLabel}`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'strip-set-item-remove';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => {
      const remaining = loadedParts.filter((p) => p !== part);
      void applyStripParts(remaining);
    });
    item.appendChild(name);
    item.appendChild(remove);
    stripSetList.appendChild(item);
  }
  stripSet.classList.remove('hidden');
}

function showPartialStrips(result) {
  pendingStrips = result.parts;
  loadedParts = result.parts;
  cardBytes = null;
  cardMeta = null;
  clearAdapterCardCache();
  hideCardDisplay();
  const missingText = result.missing.length === 1
    ? `strip ${result.missing[0]}`
    : `strips ${result.missing.join(', ')}`;
  cardInfo.textContent = `Need ${missingText} of this ${result.stripCount}-strip card.`;
  renderStripSet(result.parts, { stripCount: result.stripCount, missing: result.missing });
  dropZone?.classList.add('awaiting-strip');
  if (dropZoneLabel) dropZoneLabel.textContent = 'Add the other strip';
  if (dropZoneSub) {
    dropZoneSub.textContent = `Loaded strip ${result.present.join(' and ')} of ${result.stripCount} — order does not matter`;
  }
  setPhase(isConnected() ? 'connected' : 'card_partial');
}

function clearCardState() {
  pendingStrips = [];
  loadedParts = [];
  cardBytes = null;
  cardMeta = null;
  clearAdapterCardCache();
  hideStripSet();
  resetDropZoneCopy();
  updateCardInfoPlaceholder();
  setPhase(isConnected() ? 'connected' : 'idle');
}

function updateCardInfoPlaceholder() {
  if (cardBytes || pendingStrips.length) return;
  cardInfo.textContent = 'No card loaded.';
  hideCardDisplay();
}

cardFile.accept = formatAcceptAttribute();
if (cardFormatsEl) {
  cardFormatsEl.textContent = 'Accepted file types: .bin, .raw, .sav';
}

function updateStepper(activeStep) {
  const stepEls = stepper.querySelectorAll('.stepper-step');
  const lineEls = stepper.querySelectorAll('.stepper-line');
  const last = stepEls.length - 1;

  stepEls.forEach((el, i) => {
    if (activeStep < 0) {
      el.removeAttribute('data-state');
    } else if (i < activeStep) {
      el.dataset.state = 'done';
    } else if (i === activeStep) {
      el.dataset.state = i === last ? 'complete' : 'active';
    } else {
      el.removeAttribute('data-state');
    }
  });

  lineEls.forEach((el, i) => {
    if (activeStep > i + 1) {
      el.dataset.state = 'done';
    } else {
      el.removeAttribute('data-state');
    }
  });
}

function setPhase(phase, detail = '') {
  const cfg = { ...(PHASE_CONFIG[phase] ?? PHASE_CONFIG.idle) };

  if (phase === 'connected') {
    cfg.instruction = cardBytes
      ? connectedInstruction()
      : pendingStrips.length
        ? 'Add the remaining strip before starting your game.'
        : 'Select an e-Reader card to send before starting your game.';
  }

  statusText.textContent = cfg.message;
  statusText.dataset.type = cfg.type;
  statusIndicator.dataset.type = cfg.type;
  detailText.textContent = detail;

  if (cfg.instruction) {
    instructionBox.classList.remove('hidden');
    instructionBox.dataset.type = cfg.type === 'success' ? 'success' : 'default';
    instructionText.textContent = cfg.instruction;
  } else {
    instructionBox.classList.add('hidden');
  }

  updateStepper(cfg.step);
}

function log(message) {
  const stamp = new Date().toLocaleTimeString();
  logEl.textContent += `[${stamp}] ${message}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

copyLogBtn?.addEventListener('click', async () => {
  const text = logEl.textContent?.trim() ?? '';
  if (!text) return;
  try {
    await navigator.clipboard.writeText(logEl.textContent);
  } catch {}
});

function stopWireLog() {
  setWireLogHandler(null);
  setFirmwareWireLog(false);
}

function startWireLogForGame(game) {
  stopWireLog();
  if (game?.linkMode !== 'ereader') return;
  if (!game?.ereaderProfile) return;
  setFirmwareWireLog(true);
  if (isSma4EreaderProfile(game.ereaderProfile)) return;
  setWireLogHandler((raw) => {
    const message = formatErdrWireMessage(raw);
    if (!message) return false;
    log(message);
    return true;
  });
}

function refreshButtons() {
  connectBtn.disabled = busy || isConnected();
  disconnectBtn.disabled = busy || !isConnected();
}

populateGameSelect();
updateCardInfoPlaceholder();

gameSelect.addEventListener('change', () => {
  const prevGame = getGame(selectedGameId);
  selectedGameId = gameSelect.value;
  userSelectedGame = true;
  const game = selectedGame();
  updateGameGuide();

  if (
    isConnected()
    && prevGame?.linkMode != null
    && game?.linkMode != null
    && prevGame.linkMode !== game.linkMode
  ) {
    log('Link mode changed — disconnect and reconnect the adapter.');
  } else if (
    isConnected()
    && prevGame?.ereaderProfile != null
    && game?.ereaderProfile != null
    && prevGame.ereaderProfile !== game.ereaderProfile
  ) {
    // Point the stored session at the new profile and force the next send to
    // reconfigure the adapter, so switching games does not need a reconnect.
    const conn = getActiveConnection();
    if (conn) {
      conn.ereaderProfile = game.ereaderProfile;
      conn.ereaderScanCompleted = true;
    }
    log('Game changed — the adapter will be reconfigured on the next send.');
  }
  clearAdapterCardCache();

  if (cardBytes && cardMeta?.detection?.supported === false) {
    refreshButtons();
    return;
  }
  if (cardBytes) {
    const mismatch = validateLoadedCard(cardBytes, selectedGameId);
    if (mismatch) {
      cardInfo.textContent = `${cardMeta?.label ?? 'Card'} — may not match ${selectedGame()?.label}: ${mismatch}`;
      setPhase('error', mismatch);
    } else {
      setPhase(isConnected() ? 'connected' : 'card_loaded');
    }
  } else if (pendingStrips.length) {
    setPhase(isConnected() ? 'connected' : 'card_partial');
  } else {
    updateCardInfoPlaceholder();
    setPhase('idle');
  }
  refreshButtons();
});

onAdapterDisconnect(() => {
  stopWireLog();
  log('Adapter disconnected');
  setPhase('disconnected');
  refreshButtons();
});

if (!isTransportAvailable()) {
  setPhase('no_transport');
  connectBtn.disabled = true;
}

dropZone?.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone?.addEventListener('dragleave', (e) => {
  if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('drag-over');
});

dropZone?.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const files = e.dataTransfer?.files;
  if (files?.length) void handleCardFiles(files, { append: pendingStrips.length > 0 });
});

dropZone?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cardFile.click(); }
});

cardFile.addEventListener('change', () => {
  const files = cardFile.files;
  if (!files?.length) return;
  void handleCardFiles(files, { append: pendingStrips.length > 0 });
  cardFile.value = '';
});

stripSetClear?.addEventListener('click', () => {
  clearCardState();
  refreshButtons();
});

async function applyStripParts(parts) {
  if (!parts.length) {
    clearCardState();
    refreshButtons();
    return;
  }
  try {
    await applyLoadedResult(assembleCardUploads(parts), parts.map((p) => p.filename).filter(Boolean));
  } catch (err) {
    hideCardDisplay();
    cardInfo.textContent = err.message;
    log(`Card load failed: ${err.message}`);
    setPhase('error', err.message);
  }
  refreshButtons();
}

async function handleCardFiles(files, { append = false } = {}) {
  const list = [...files].filter(Boolean);
  if (!list.length) return;

  try {
    const existing = append ? pendingStrips : [];
    const loaded = await loadEreaderCardUploads(list, { existing });
    await applyLoadedResult(loaded, list.map((f) => f.name));
  } catch (err) {
    if (!append) {
      pendingStrips = [];
      loadedParts = [];
      cardBytes = null;
      cardMeta = null;
      hideStripSet();
      resetDropZoneCopy();
    }
    hideCardDisplay();
    cardInfo.textContent = err.message;
    log(`Card load failed: ${err.message}`);
    setPhase('error', err.message);
  }
  refreshButtons();
}

async function applyLoadedResult(loaded, fileNames = []) {
  if (loaded.incomplete) {
    showPartialStrips(loaded);
    log(`Loaded strip ${loaded.present.join(' and ')} of ${loaded.stripCount} — waiting for ${loaded.missing.join(', ')}`);
    return;
  }

  pendingStrips = [];
  loadedParts = loaded.parts ?? [];
  cardBytes = loaded.bin;
  cardMeta = loaded;

  const names = loaded.filenames?.length ? loaded.filenames : fileNames;
  const detection = detectCardGames(cardBytes, {
    filename: loaded.upload?.basename ?? names[0] ?? '',
    format: loaded.format,
  });
  cardMeta.detection = detection;

  if (detection.primary && !userSelectedGame) {
    selectGame(detection.primary);
  }

  const game = selectedGame();
  const mismatch =
    detection.supported && !detection.ambiguous && game
      ? validateLoadedCard(cardBytes, game.id)
      : null;
  const detectLine = describeDetection(detection);
  const displayName = loaded.upload ? formatUploadLabel(loaded.upload) : (names[0] ?? 'Card');

  if ((loaded.stripCount ?? 1) > 1 && loaded.parts?.length) {
    renderStripSet(loaded.parts, { stripCount: loaded.stripCount, missing: [] });
    resetDropZoneCopy();
  } else {
    hideStripSet();
    resetDropZoneCopy();
  }

  if (!detection.supported) {
    hideCardDisplay();
    cardInfo.textContent = `${displayName} — ${detectLine}`;
    log(`Unsupported upload: ${detectLine}`);
    setPhase('error', detectLine);
  } else if (detection.ambiguous) {
    hideCardDisplay();
    cardInfo.textContent = `${displayName} — Unknown card type. Select a game above to try sending.`;
    log(`Loaded ${names.join(' + ')} (${loaded.format}) — card type unknown`);
    clearAdapterCardCache();
    setPhase(isConnected() ? 'connected' : 'card_loaded');
  } else if (mismatch) {
    hideCardDisplay();
    cardInfo.textContent = `${displayName} — Does not match ${game?.label}: ${mismatch}`;
    log(`Card load warning: ${mismatch}`);
    setPhase('error', mismatch);
  } else {
    const cardClassification = (() => {
      try { return game?.classifyCard?.(cardBytes); } catch { return null; }
    })();
    const savDetail = loaded.format === 'sav' ? loaded.detail : null;
    showCardDisplay(loaded.upload, cardClassification, loaded.classification, savDetail);
    if (loaded.detail && loaded.format !== 'sav') {
      const extra = loaded.detail;
      if (cardDisplaySub.textContent) cardDisplaySub.textContent += ` · ${extra}`;
      else cardDisplaySub.textContent = extra;
      cardDisplaySub.classList.toggle('hidden', !cardDisplaySub.textContent);
    }
    log(`Loaded ${names.join(' + ')} (${loaded.format})` + (detectLine ? ` — ${detectLine}` : ''));
    clearAdapterCardCache();
    if (isConnected()) {
      await preloadCardToAdapter();
      await startScan();
    } else {
      setPhase('card_loaded');
    }
  }
}

connectBtn.addEventListener('click', async () => {
  busy = true;
  refreshButtons();
  setPhase('connecting');
  const game = selectedGame();
  const linkMode = game?.linkMode ?? 'ereader';
  log(`Connecting as ${game?.label ?? 'unknown'} (${linkMode === 'gen3' ? 'GBA link' : 'e-Reader firmware'})…`);
  try {
    await connect({
      linkMode,
      ereaderProfile: game?.ereaderProfile ?? 1,
      cableOverride: game?.cableOverride ?? 0,
      onProgress: (message) => {
        log(message);
        instructionText.textContent = message;
      },
    });
    setPhase('connected');

    const fwAfter = await getFirmwareInfo();
    const cableNoteAfter =
      fwAfter?.cable != null ? `, ${cableTypeLabel(fwAfter.cable)}` : '';
    const overrideNote =
      game?.cableOverride === 1
        ? ' (SD→GP3 forced)'
        : game?.cableOverride === 2
          ? ' (SD→GP4 forced)'
          : '';
    const verNoteAfter = fwAfter?.version ? ` fw ${fwAfter.version}` : '';
    const modeLabel = game?.linkMode === 'gen3' ? 'GBA link (Gen 3)' : 'e-Reader mode';
    log(`Adapter connected (${modeLabel}, 3.3 V${verNoteAfter}${cableNoteAfter}${overrideNote})`);
    if (game?.preloadCard) await preloadCardToAdapter();
    startWireLogForGame(game);
    if (cardBytes) await startScan();
  } catch (err) {
    log(`Connect failed: ${err.message}`);
    setPhase('error', err.message);
  } finally {
    busy = false;
    refreshButtons();
  }
});

disconnectBtn.addEventListener('click', async () => {
  stopWireLog();
  busy = true;
  refreshButtons();
  try {
    await disconnect();
    log('Disconnected');
    setPhase(cardBytes ? 'card_loaded' : pendingStrips.length ? 'card_partial' : 'idle');
  } catch (err) {
    log(`Disconnect failed: ${err.message}`);
    setPhase('error', err.message);
  } finally {
    busy = false;
    refreshButtons();
  }
});

async function startScan() {
  const game = selectedGame();
  if (!cardBytes || !game) return;
  const unsupported = cardMeta?.detection?.supported === false;
  if (unsupported) return;
  busy = true;
  refreshButtons();
  setPhase('scanning');
  try {
    await game.sendCard(cardBytes, {
      onStatus: (message) => {
        setPhase('scanning', message);
        log(message);
      },
    });
    log(`Card accepted by ${game.label}`);
    setPhase('complete');
  } catch (err) {
    log(`Scan failed: ${err.message}`);
    setPhase('error', err.message);
  } finally {
    busy = false;
    refreshButtons();
  }
}


setPhase('idle');
refreshButtons();

// Vite fingerprints the bundle filename per build — logging it makes "is the
// page running the latest build?" answerable from any pasted log.
{
  const bundle = document
    .querySelector('script[type="module"][src*="index-"]')
    ?.src?.match(/index-([^.]+)\.js/)?.[1];
  if (bundle) log(`Client build ${bundle}`);
}
