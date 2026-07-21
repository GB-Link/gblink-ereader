import { getCardPayloadOffset as sma4GetCardPayloadOffset } from '../games/sma4.js';
import { parseCardHeader } from './loader.js';
import {
  classifyUpload,
  formatUploadLabel,
  messageForCategory,
  parseUploadFilename,
} from './upload.js';
import {
  looksLikeMysteryEvent,
  parsePokemonMysteryEventCard,
} from './pokemon-parser.js';

const EXCLUSIVE_UPLOAD_KINDS = new Set([
  'sma4',
  'pokemon-mystery',
  'pokemon-battle-e',
  'pokemon-tcg',
  'animal-crossing',
  'nes-e',
  'mario-party',
  'pokemon-channel',
  'ereader-app',
]);

function readAsciiTitle(bytes, start = 0x0c, maxLen = 32) {
  let end = start;
  while (end < bytes.length && end < start + maxLen && bytes[end] !== 0) end++;
  const title = new TextDecoder('ascii').decode(bytes.subarray(start, end)).trim();
  return /^[\x20-\x7e]{3,}$/.test(title) ? title : '';
}

function readCardTitle(bytes, upload) {
  if (upload.displayTitle) return upload.displayTitle;

  const header = parseCardHeader(bytes);
  if (header?.title) return header.title;

  const candidates = [0x04, 0x0c, 0x30]
    .map((start) => readAsciiTitle(bytes, start))
    .filter(Boolean);
  return candidates.sort((a, b) => b.length - a.length)[0] || null;
}

function isPokemonMysteryCard(bytes, format) {
  try {
    const { payload } = parsePokemonMysteryEventCard(bytes);
    return payload.length >= 0x40;
  } catch {
    return false;
  }
}

function isSma4Card(bytes) {
  const header = parseCardHeader(bytes);

  const title = header?.title || readAsciiTitle(bytes, 0x0c) || readAsciiTitle(bytes, 0x30);
  if (title.startsWith('Super Mario Advance 4') || title.startsWith('Super Mario Adva')) {
    return true;
  }

  if (header?.kind === 'full' && header.cardType !== 0x0f) {
    return false;
  }

  if (bytes.length === 1998 || bytes.length === 2112) {
    try {
      sma4GetCardPayloadOffset(bytes);
      return !isPokemonMysteryCard(bytes, '');
    } catch {
      return false;
    }
  }

  if (bytes.length >= 0x22) {
    const marker = new TextDecoder('ascii').decode(bytes.subarray(0x1a, 0x22));
    if (marker === 'NINTENDO') {
      try {
        sma4GetCardPayloadOffset(bytes);
        return !isPokemonMysteryCard(bytes, '');
      } catch {
        return false;
      }
    }
  }

  return false;
}

function addMatch(matches, match) {
  const existing = matches.find((m) => m.gameId === match.gameId);
  const rank = (c) => (c === 'high' ? 3 : c === 'medium' ? 2 : 1);
  if (!existing || rank(match.confidence) > rank(existing.confidence)) {
    if (existing) matches.splice(matches.indexOf(existing), 1);
    matches.push(match);
  }
}

function rank(confidence) {
  return confidence === 'high' ? 3 : confidence === 'medium' ? 2 : 1;
}

function matchesFromUpload(upload, classification) {
  const matches = [];
  const label = formatUploadLabel(upload);
  const titleBit = label ? ` ("${label}")` : '';

  if (classification.kind === 'sma4') {
    addMatch(matches, {
      gameId: 'sma4',
      confidence: 'high',
      reason: `Super Mario Advance 4 e-Card${titleBit}`,
    });
    return matches;
  }

  if (classification.kind === 'pokemon-mystery') {
    addMatch(matches, {
      gameId: 'pokemon-ruby',
      confidence: 'high',
      reason: `Pokémon mystery event${titleBit}`,
    });
    return matches;
  }

  if (classification.kind === 'pokemon-battle-e') {
    addMatch(matches, {
      gameId: 'pokemon-ruby',
      confidence: 'high',
      reason: `Pokémon Battle-e card${titleBit}`,
    });
    return matches;
  }

  return matches;
}

function matchesFromBytes(bin, format, cardTitle) {
  const matches = [];
  const titleHint = cardTitle ? ` ("${cardTitle}")` : '';

  if (isPokemonMysteryCard(bin, format)) {
    addMatch(matches, {
      gameId: 'pokemon-ruby',
      confidence: 'high',
      reason: `Pokémon mystery-event data${titleHint}`,
    });
  }

  if (isSma4Card(bin)) {
    addMatch(matches, {
      gameId: 'sma4',
      confidence: 'high',
      reason: `Super Mario Advance 4 e-Reader payload${titleHint}`,
    });
  }

  return matches;
}

export function detectCardGames(bin, { filename = '', format = '' } = {}) {
  const upload = parseUploadFilename(filename);
  const classification = classifyUpload(upload);
  const header = parseCardHeader(bin);
  const cardTitle = readCardTitle(bin, upload);

  let matches = [];
  const filenameKindKnown = EXCLUSIVE_UPLOAD_KINDS.has(classification.kind);

  if (filenameKindKnown) {
    matches = matchesFromUpload(upload, classification);
  }

  if (!filenameKindKnown || classification.kind === 'unknown') {
    for (const match of matchesFromBytes(bin, format, cardTitle)) {
      addMatch(matches, match);
    }
  }

  matches.sort((a, b) => rank(b.confidence) - rank(a.confidence));

  const ambiguous =
    classification.kind === 'unknown' && !filenameKindKnown && matches.length === 0;

  const supported =
    classification.supported ||
    (matches.length > 0 &&
      !filenameKindKnown &&
      matches.some((m) => ['sma4', 'pokemon-ruby'].includes(m.gameId))) ||
    ambiguous;

  const primary = supported
    ? (filenameKindKnown ? classification.gameIds[0] : null) ??
      matches.find((m) => m.confidence === 'high')?.gameId ??
      matches[0]?.gameId ??
      null
    : null;

  let category = classification.category;
  if (supported) {
    category = 'gba-link';
  } else if (
    classification.kind === 'unknown' &&
    header?.kind === 'full' &&
    header.cardType !== 0x0f
  ) {
    category = 'ereader-rom';
  }

  const categoryMessage = messageForCategory(category);

  return {
    matches,
    primary,
    cardTitle,
    header,
    upload,
    classification,
    category,
    categoryMessage,
    supported,
    ambiguous,
    unsupportedReason: supported ? null : categoryMessage,
  };
}

export function validateCardForGame(bin, gameId) {
  const game = {
    sma4: 'sma4',
    'sma4-jpn': 'sma4',
    'pokemon-ruby': 'pokemon',
    'pokemon-ruby-jpn': 'pokemon',
  }[gameId];
  if (game === 'sma4') {
    sma4GetCardPayloadOffset(bin);
    return true;
  }
  if (game === 'pokemon') {
    parsePokemonMysteryEventCard(bin);
    return true;
  }
  return false;
}
