import { isPreloadedPayload, preloadCardToAdapter, runScan } from '../link/ereader-mode.js';

export const CARD_PAYLOAD_SIZE = 0x7ce;

const SMA4_USEFUL_LINKS = [
  {
    label: 'SMA4 level editor',
    href: 'https://sma4.gblink.io/editor/',
  },
  {
    label: 'Popular custom levels',
    href: 'https://sma4.gblink.io/levels/all/popular/',
  },
];

export const SMA4_START_GUIDE_USA = {
  sections: [
    {
      title: 'Demo / Power-Up',
      steps: [
        '<strong>Drop or browse for an e-Reader card file in the box below first.</strong>',
        'On any world map, press <strong>R</strong> to open the card-scan menu.',
        'Choose <strong>Demo Card</strong> or <strong>Power-Up Card</strong>, then click Connect Game Boy.',
        'When prompted, click <strong>OK</strong> to start the card scan on the GBA.',
      ],
    },
    {
      title: 'Level Card',
      steps: [
        '<strong>Drop or browse for an e-Reader card file in the box below first.</strong>',
        'From the File Select screen, scroll to the bottom and choose <strong>Level Card</strong>. You\'ll be warped to World-e.',
        'Walk to the glowing Level Scan Portal and press <strong>A</strong>. Lakitu flies in.',
        'Click Connect Game Boy. When prompted, click <strong>OK</strong> to start the card scan.',
      ],
    },
  ],
  links: SMA4_USEFUL_LINKS,
};

export const SMA4_START_GUIDE_JPN = {
  sections: [
    {
      title: 'おてほん / おたすけ',
      steps: [
        '<strong>Drop or browse for an e-Reader card file in the box below first.</strong>',
        'On any world map, press <strong>R</strong> to open the card-scan menu.',
        'Choose <strong>おてほんカード</strong> (Demo) or <strong>おたすけカード</strong> (Power-Up), then click Connect Game Boy.',
        'When prompted, click <strong>OK</strong> to start the card scan on the GBA.',
      ],
    },
    {
      title: 'コースカード',
      steps: [
        '<strong>Drop or browse for an e-Reader card file in the box below first.</strong>',
        'From the File Select screen, scroll to the bottom and choose <strong>コースカード</strong>. You\'ll be warped to <strong>ワールドe+</strong>.',
        'Walk to the glowing white tile and press <strong>A</strong>, then select <strong>コースカード</strong>. Lakitu flies in.',
        'Click Connect Game Boy. When prompted, click <strong>OK</strong> to start the card scan.',
      ],
    },
  ],
};

export const SMA4_START_GUIDE_EUR = {
  sections: [
    {
      title: 'Before you start',
      note:
        'European SMA4 hides e-Reader menus until you unlock them with an e-Reader unlock save '
        + '(by <strong>CaitSith2</strong>). You also need <strong>GB-Link firmware v2.2.3+</strong>.',
      steps: [
        'Update your adapter to <strong>firmware v2.2.3 or later</strong> if you have not already.',
        '<a href="./saves/sma4-eur-gblink.sav" download="sma4-eur-gblink.sav">Download the e-Reader unlock save</a>, then use <a href="https://cartdoctor.gblink.io/" target="_blank" rel="noopener noreferrer">GB-Link Cart Doctor</a> to restore it to your EUR cartridge.',
        'Boot the game with that save, then pick the EUR language option below that matches your in-game language. <strong>English is the default</strong> if you have not changed it.',
        '<strong>Drop or browse for an e-Reader card file in the box below</strong> before connecting.',
      ],
    },
    {
      title: 'Demo / Power-Up',
      steps: [
        'On any world map, press <strong>R</strong> to open the card-scan menu.',
        'Choose <strong>Demo Card</strong> or <strong>Power-Up Card</strong>, then click Connect Game Boy.',
        'When prompted, click <strong>OK</strong> to start the card scan on the GBA.',
      ],
    },
    {
      title: 'Level Card',
      steps: [
        'From the File Select screen, scroll to the bottom and choose <strong>Level Card</strong>. You\'ll be warped to World-e.',
        'Walk to the glowing Level Scan Portal and press <strong>A</strong>. Lakitu flies in.',
        'Click Connect Game Boy. When prompted, click <strong>OK</strong> to start the card scan.',
      ],
    },
  ],
  links: [
    {
      label: 'Download e-Reader unlock save (CaitSith2)',
      href: './saves/sma4-eur-gblink.sav',
      download: 'sma4-eur-gblink.sav',
    },
    {
      label: 'GB-Link Cart Doctor',
      href: 'https://cartdoctor.gblink.io/',
    },
    ...SMA4_USEFUL_LINKS,
  ],
};

export function getCardPayloadOffset(bytes) {
  if (bytes.length === CARD_PAYLOAD_SIZE) return 0;
  if (bytes.length === 2112) return 114;

  const marker = new TextDecoder('ascii').decode(bytes.slice(0x1a, 0x22));
  if (marker === 'NINTENDO') return 0x72;

  const title = new TextDecoder('ascii').decode(bytes.slice(0x0c, 0x21));
  if (title.startsWith('Super Mario Advance 4')) return 0x4e;

  if (bytes.length >= 114 + CARD_PAYLOAD_SIZE) return 114;
  throw new Error(
    `Unrecognized card file size (${bytes.length} bytes). Expected 1998 or 2112.`,
  );
}

export function classifySma4Payload(payload) {
  if (payload.length < 2) return { type: 'unknown', setNumber: 0 };
  const setNumber = payload[0];
  const typeByte = payload[1];
  const type =
    typeByte === 0x00 ? 'level' :
    typeByte === 0x06 ? 'power-up' :
    typeByte === 0x08 ? 'demo' :
    'unknown';
  return { type, setNumber };
}

export function extractPayload(cardBytes) {
  const offset = getCardPayloadOffset(cardBytes);
  if (offset + CARD_PAYLOAD_SIZE > cardBytes.length) {
    throw new Error('Card file is too small for a full SMA4 payload');
  }
  return cardBytes.slice(offset, offset + CARD_PAYLOAD_SIZE);
}

export async function preloadCard(cardBytes) {
  const payload = extractPayload(cardBytes);
  await preloadCardToAdapter(payload);
  return payload;
}

export async function sendCard(cardBytes, { onStatus } = {}) {
  const payload = extractPayload(cardBytes);

  if (!isPreloadedPayload(payload)) {
    onStatus?.('Uploading card to adapter…');
    await preloadCardToAdapter(payload);
  }

  await runScan({ cardBytes: payload, onStatus });
  return true;
}
