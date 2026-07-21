const CATEGORY_MESSAGES = {
  'gba-link': 'Supported over GB-Link.',
  'ereader-rom': 'Not supported over GB-Link.',
  'gamecube-link': 'Not supported over GB-Link.',
};

const SEP = ' | ';

const CATALOG_ID =
  /^(\d{2,3}-[A-Z]\d{3}|[A-Z]-\d{2,3}-#|[A-Z]-\d{3,4})$/;

const REGION_MAP = {
  usa: 'usa',
  jpn: 'jpn',
  japan: 'jpn',
  eur: 'eur',
  europe: 'eur',
  australia: 'aus',
  aus: 'aus',
};

function extensionOf(filename) {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

function basenameOf(filename) {
  const slash = Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\'));
  return slash >= 0 ? filename.slice(slash + 1) : filename;
}

function normalizeRegion(token) {
  return REGION_MAP[token.toLowerCase()] ?? 'unknown';
}

export function parseUploadFilename(filename) {
  const basename = basenameOf(filename);
  const extension = extensionOf(basename);
  const name = extension ? basename.slice(0, -(extension.length + 1)) : basename;

  const tags = [];
  let region = 'unknown';
  let rest = name;

  while (true) {
    const match = rest.match(/\(([^)]+)\)\s*$/);
    if (!match) break;
    const token = match[1].trim();
    const mapped = normalizeRegion(token);
    if (mapped !== 'unknown') {
      region = mapped;
    } else {
      tags.push(token);
    }
    rest = rest.slice(0, match.index).trimEnd();
  }

  let parts = rest.split(' - ').map((part) => part.trim()).filter(Boolean);
  let promotional = false;

  if (parts[0] === 'Promotional' && parts.length > 1) {
    promotional = true;
    tags.push('Promo');
    parts = parts.slice(1);
  }

  if (!parts.length) {
    return {
      basename,
      extension,
      family: name,
      subset: null,
      catalogId: null,
      displayTitle: null,
      region,
      promotional,
      tags,
    };
  }

  const family = parts[0];
  let catalogIdx = -1;
  for (let i = 1; i < parts.length; i++) {
    if (CATALOG_ID.test(parts[i])) {
      catalogIdx = i;
      break;
    }
  }

  let subset = null;
  let displayTitle = null;
  let catalogId = null;

  if (catalogIdx >= 0) {
    catalogId = parts[catalogIdx];
    if (catalogIdx > 1) {
      subset = parts.slice(1, catalogIdx).join(SEP);
    } else if (catalogIdx === 2) {
      subset = parts[1];
    }
    if (catalogIdx < parts.length - 1) {
      displayTitle = parts.slice(catalogIdx + 1).join(SEP);
    }
  } else if (parts.length === 1) {
    displayTitle = family;
  } else if (parts.length === 2) {
    displayTitle = parts[1];
  } else {
    subset = parts.slice(1, -1).join(SEP);
    displayTitle = parts[parts.length - 1];
  }

  if (!displayTitle && family) {
    displayTitle = family;
  }

  return {
    basename,
    extension,
    family,
    subset,
    catalogId,
    displayTitle,
    region,
    promotional,
    tags,
  };
}

export function messageForCategory(category) {
  return CATEGORY_MESSAGES[category] ?? CATEGORY_MESSAGES['ereader-rom'];
}

export function classifyUpload(upload) {
  const family = upload.family.toLowerCase();
  const title = (upload.displayTitle ?? '').toLowerCase();

  if (family.includes('super mario advance 4')) {
    return {
      kind: 'sma4',
      category: 'gba-link',
      supported: true,
      gameIds: ['sma4'],
      label: 'Super Mario Advance 4 e-Card',
    };
  }

  if (family === 'eon ticket' || title.includes('eon ticket')) {
    return {
      kind: 'pokemon-mystery',
      category: 'gba-link',
      supported: true,
      gameIds: ['pokemon-ruby'],
      label: 'Pokemon mystery event',
    };
  }

  if (family.includes('pokemon battle-e') || family === 'pokemon battle-e') {
    return {
      kind: 'pokemon-battle-e',
      category: 'gba-link',
      supported: true,
      gameIds: ['pokemon-ruby'],
      label: 'Pokemon Battle-e',
    };
  }

  if (family.includes('pokemon-e tcg') || family === 'pokemon-e tcg') {
    return {
      kind: 'pokemon-tcg',
      category: 'ereader-rom',
      supported: false,
      gameIds: ['pokemon-tcg'],
      label: 'Pokemon-e TCG',
    };
  }

  if (family.includes('animal crossing')) {
    return {
      kind: 'animal-crossing',
      category: 'gamecube-link',
      supported: false,
      gameIds: ['animal-crossing'],
      label: 'Animal Crossing-e',
    };
  }

  if (family === 'nes-e' || family.startsWith('nes-e')) {
    return {
      kind: 'nes-e',
      category: 'ereader-rom',
      supported: false,
      gameIds: ['nes-e'],
      label: 'NES-e',
    };
  }

  if (family.includes('mario party')) {
    return {
      kind: 'mario-party',
      category: 'ereader-rom',
      supported: false,
      gameIds: ['mario-party'],
      label: 'Mario Party-e',
    };
  }

  if (family.includes('pokemon channel')) {
    return {
      kind: 'pokemon-channel',
      category: 'ereader-rom',
      supported: false,
      gameIds: ['pokemon-channel'],
      label: 'Pokemon Channel',
    };
  }

  if (
    family.includes('kirby') ||
    family.includes('air hockey') ||
    family.includes('ice climber')
  ) {
    return {
      kind: 'ereader-app',
      category: 'ereader-rom',
      supported: false,
      gameIds: ['ereader-app'],
      label: 'e-Reader application',
    };
  }

  return {
    kind: 'unknown',
    category: 'ereader-rom',
    supported: false,
    gameIds: ['ereader-other'],
    label: 'e-Reader card',
  };
}

export function formatUploadLabel(upload) {
  const bits = [];
  if (upload.displayTitle) bits.push(upload.displayTitle);
  else if (upload.family) bits.push(upload.family);
  if (upload.catalogId) bits.push(upload.catalogId);
  return bits.join(SEP) || upload.basename;
}

