import { parsePokemonMysteryEventCard } from '../cards/pokemon-parser.js';
import {
  isPreloadedPayload,
  preloadCardToAdapter,
  runScan,
} from '../link/ereader-mode.js';
import { FORMAT_HINTS } from '../cards/loader.js';

const CHUNK_LENGTHS = [0, 0, 0, 6, 2, 5, 12, 5, 3, 1, 2, 5, 5, 5, 1, 13, 13];

const MYSTERY_CONTENT_COMMANDS = {
  0x07: 'setenigmaberry — Berry card',
  0x0b: 'setrecordmixinggift — Eon Ticket',
  0x0c: 'givepokemon',
  0x0d: 'addtrainer — Battle-e trainer',
  0x08: 'giveribbon',
  0x09: 'initramscript',
  0x0a: 'addrareword',
  0x0e: 'enableresetrtc',
};

function contentCommand(payload) {
  const META_CMDS = new Set([0x00, 0x0f, 0x10, 0x05, 0x06]);
  let p = 17;
  while (p < payload.length) {
    const cmd = payload[p];
    if (cmd === 0x02) break;
    if (cmd < CHUNK_LENGTHS.length) {
      if (!META_CMDS.has(cmd)) return cmd;
      p += CHUNK_LENGTHS[cmd];
    } else break;
  }
  return null;
}

function describePayload(payload) {
  const cmd = contentCommand(payload);
  return cmd != null
    ? (MYSTERY_CONTENT_COMMANDS[cmd] ?? `cmd 0x${cmd.toString(16).toUpperCase()}`)
    : 'unknown';
}

function extractPayload(cardBytes) {
  const { payload, source } = parsePokemonMysteryEventCard(cardBytes);
  return { payload: widenMysteryEventCompatibility(payload), source };
}

const MIN_MYSTERY_PAYLOAD = 512;

function widenMysteryEventCompatibility(payload) {
  if (payload.length < 17 || payload[0] !== 0x01) return payload;
  const out = payload.slice();
  out[5] = 0xff;
  out[6] = 0xff;
  out[7] = 0xff;
  out[8] = 0xff;
  out[9] = 0xff;
  out[10] = 0xff;
  out[13] = 0xff;
  out[14] = 0xff;
  out[15] = 0xff;
  out[16] = 0xff;
  return out;
}

function padPayload(payload) {
  const aligned = (payload.length + 3) & ~3;
  const size = Math.max(MIN_MYSTERY_PAYLOAD, aligned);
  if (payload.length === size) return payload;
  const padded = new Uint8Array(size);
  padded.set(payload);
  return padded;
}

export async function sendCard(cardBytes, { onStatus } = {}) {
  const { payload: rawPayload } = extractPayload(cardBytes);
  const payload = padPayload(rawPayload);
  const cardDesc = describePayload(rawPayload);
  onStatus?.(`Card: ${cardDesc} (${rawPayload.length} bytes → ${payload.length} uploaded)`);

  if (!isPreloadedPayload(payload)) {
    onStatus?.('Uploading card to adapter…');
    await preloadCardToAdapter(payload);
  }

  onStatus?.('Arming scan — press A on GBA only after this (game may show "press A" early; that is OK)');
  // runScan reconfigures the adapter session when a previous send completed —
  // the firmware exits e-Reader mode after each accepted card.
  await runScan({ cardBytes: payload, onStatus });
  return true;
}

export async function preloadCard(cardBytes) {
  const { payload: rawPayload, source } = extractPayload(cardBytes);
  const payload = padPayload(rawPayload);
  await preloadCardToAdapter(payload);
  return { payload, source: rawPayload.length < MIN_MYSTERY_PAYLOAD ? `${source} (padded)` : source };
}

export function getCardPayloadOffset(cardBytes) {
  parsePokemonMysteryEventCard(cardBytes);
  return 0;
}

export const POKEMON_START_GUIDE_USA = {
  sections: [
    {
      title: 'Unlock Mystery Event',
      note: 'One-time setup: after beating Norman, talk to the NPC by the PC in Petalburg City’s Pokémon Center and enter <strong>MYSTERY EVENT IS EXCITING</strong>. Save, restart, and <strong>Mystery Event</strong> appears on the title menu.',
    },
    {
      title: 'Send a card',
      steps: [
        '<strong>Drop or browse for an e-Reader card file in the box below first.</strong>',
        'Connect the adapter, then open <strong>Mystery Event</strong> on the GBA.',
        'Press <strong>A</strong> on the GBA when prompted to load the event.',
      ],
    },
  ],
  links: [
    {
      label: 'Ruby / Sapphire DLC cards',
      href: 'https://github.com/notblisy/RUBYSAPPHIREDLC',
    },
    {
      label: 'Youpileouf E-Reader cards (French)',
      href: 'https://github.com/Youpileouf/Pokemon-e-Cards-France',
    },
    {
      label: 'Youpileouf E-Reader cards (Spanish)',
      href: 'https://github.com/Youpileouf/Pokemon-e-Cards-Spanish',
    },
  ],
};

export const POKEMON_START_GUIDE_JPN = {
  sections: [
    {
      title: 'Unlock ふしぎなできごと',
      note: 'One-time setup: after beating Norman (センリ), talk to the NPC by the PC in Petalburg City’s (トウカシティ) Pokémon Center and enter <strong>ふしぎ　できごと　わくわく　ドキドキ</strong>. Save, restart, and <strong>ふしぎなできごと</strong> appears on the title menu.',
    },
    {
      title: 'Send a card',
      steps: [
        '<strong>Drop or browse for an e-Reader card file in the box below first.</strong>',
        'Connect the adapter, then open <strong>ふしぎなできごと</strong> on the GBA.',
        'Press <strong>A</strong> on the GBA when prompted to load the event.',
      ],
    },
  ],
};

const EMERALD_USEFUL_LINKS = [
  {
    label: 'notblisy Emerald E-Reader Cards',
    href: 'https://github.com/notblisy/RUBYSAPPHIREDLC/tree/main/E-READER%20CARDS/EMERALD',
  },
  {
    label: 'Youpileouf E-Reader cards (English)',
    href: 'https://github.com/Youpileouf/Pokemon-e-Cards-English',
  },
  {
    label: 'Youpileouf E-Reader cards (French)',
    href: 'https://github.com/Youpileouf/Pokemon-e-Cards-France',
  },
  {
    label: 'Youpileouf E-Reader cards (Spanish)',
    href: 'https://github.com/Youpileouf/Pokemon-e-Cards-Spanish',
  },
];

export const POKEMON_START_GUIDE_EMERALD_USA = {
  sections: [
    {
      title: 'Unlock Mystery Gift',
      note: 'One-time setup: after beating Norman, talk to the NPC by the PC in Petalburg City’s Pokémon Center and enter <strong>LINK TOGETHER WITH ALL</strong>. Save, restart, and <strong>Mystery Gift</strong> appears on the title menu.',
    },
    {
      title: 'E-Reader Unlock',
      steps: [
        'Pokémon Emerald cannot scan e-Reader cards until it has the notblisy Wonder Card.',
        'Send that card with <a href="https://wondercard.gblink.io/?event=blisy-mystery-event" target="_blank" rel="noopener noreferrer">GB-Link Wonder Cards</a>.',
        '<strong>Disconnect the adapter</strong>, then come back here to scan e-Reader cards.',
      ],
    },
    {
      title: 'Send a card',
      steps: [
        '<strong>Connect the Game Boy.</strong> Drop or browse for an e-Reader card file in the box below before you connect.',
        'Go to the <strong>2nd floor of any Pokémon Center</strong> and talk to the <strong>delivery man</strong>. This starts the e-Reader scan.',
      ],
    },
  ],
  links: EMERALD_USEFUL_LINKS,
};

export const POKEMON_START_GUIDE_EMERALD_JPN = {
  sections: [
    {
      title: 'Unlock ふしぎなおくりもの',
      note: 'One-time setup: after beating Norman (センリ), talk to the NPC by the PC in Petalburg City’s (トウカシティ) Pokémon Center and enter <strong>みんなの　ゆめを　つなげる</strong>. Save, restart, and <strong>ふしぎなおくりもの</strong> appears on the title menu.',
    },
    {
      title: 'Send a card',
      steps: [
        '<strong>Drop or browse for an e-Reader card file in the box below first.</strong>',
        'Connect the adapter, then open <strong>ふしぎなおくりもの</strong> on the GBA.',
        'Press <strong>A</strong> on the GBA when prompted to load the event.',
      ],
    },
  ],
  links: EMERALD_USEFUL_LINKS,
};

function pokemonConnectedInstruction(menuName) {
  return (
    `Connect the adapter BEFORE opening ${menuName} on the GBA (with the cable setting `
    + `on auto-detect, the ${menuName} screen interferes with detection at connect). `
    + `Then: Send card → ${menuName} → A on GBA.`
  );
}

export function makePokemonGame({
  id,
  label,
  versionLabel,
  cardHint,
  ereaderProfile,
  cableOverride = 0,
  startGuide = POKEMON_START_GUIDE_USA,
  mysteryMenu = 'Mystery Event',
  connectedInstruction,
}) {
  return {
    id,
    label,
    linkMode: 'ereader',
    ereaderProfile,
    cableOverride,
    startGuide,
    cardHint:
      cardHint ??
      `${FORMAT_HINTS.bin}, ${FORMAT_HINTS.raw}, ${FORMAT_HINTS.mev}`,
    connectedInstruction: connectedInstruction ?? pokemonConnectedInstruction(mysteryMenu),
    getCardPayloadOffset,
    classifyCard(bytes) {
      try {
        const { payload } = parsePokemonMysteryEventCard(bytes);
        const cmd = contentCommand(payload);
        if (cmd === 0x07) return { type: 'berry' };
        if (cmd === 0x0d) return { type: 'trainer' };
        return { type: 'mystery-event' };
      } catch {
        return null;
      }
    },
    preloadCard,
    sendCard: (bytes, opts) => sendCard(bytes, { ...opts, gameId: id }),
  };
}
