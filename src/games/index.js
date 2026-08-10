import {
  getCardPayloadOffset as sma4GetCardPayloadOffset,
  preloadCard as sma4PreloadCard,
  sendCard as sma4SendCard,
  classifySma4Payload,
  CARD_PAYLOAD_SIZE,
  SMA4_START_GUIDE_USA,
  SMA4_START_GUIDE_JPN,
} from './sma4.js';
import {
  makePokemonGame,
  POKEMON_START_GUIDE_USA,
  POKEMON_START_GUIDE_JPN,
} from './pokemon.js';
import { EREADER_PROFILE } from '../link/ereader-mode.js';

function makeSma4Game({ id, label, ereaderProfile, startGuide = SMA4_START_GUIDE_USA }) {
  return {
    id,
    label,
    linkMode: 'ereader',
    ereaderProfile,
    cableOverride: 0,
    cardHint: 'Decoded SMA4 e-Reader card (.bin, 1998 or 2112 bytes)',
    startGuide,
    connectedInstruction: 'In-game: Connect → Lakitu → OK → Send card.',
    getCardPayloadOffset: sma4GetCardPayloadOffset,
    preloadCard: sma4PreloadCard,
    sendCard: sma4SendCard,
    classifyCard(cardBytes) {
      const offset = sma4GetCardPayloadOffset(cardBytes);
      const payload = cardBytes.subarray(offset, offset + CARD_PAYLOAD_SIZE);
      return classifySma4Payload(payload);
    },
  };
}

export const GAMES = [
  makePokemonGame({
    id: 'pokemon-ruby',
    label: 'Pokemon Ruby / Sapphire',
    versionLabel: 'Ruby / Sapphire',
    ereaderProfile: EREADER_PROFILE.POKEMON_RUBY,
    cableOverride: 0,
    startGuide: POKEMON_START_GUIDE_USA,
  }),
  makePokemonGame({
    id: 'pokemon-ruby-jpn',
    label: 'Pokemon Ruby / Sapphire (JPN)',
    versionLabel: 'Ruby / Sapphire (JPN)',
    ereaderProfile: EREADER_PROFILE.POKEMON_RUBY_JPN,
    cableOverride: 0,
    startGuide: POKEMON_START_GUIDE_JPN,
  }),
  makeSma4Game({
    id: 'sma4',
    label: 'Super Mario Advance 4',
    ereaderProfile: EREADER_PROFILE.SMA4,
    startGuide: SMA4_START_GUIDE_USA,
  }),
  makeSma4Game({
    id: 'sma4-jpn',
    label: 'Super Mario Advance 4 (JPN)',
    ereaderProfile: EREADER_PROFILE.SMA4_JPN,
    startGuide: SMA4_START_GUIDE_JPN,
  }),
  makeSma4Game({
    id: 'sma4-eur',
    label: 'Super Mario Advance 4 (EUR English) 🇬🇧',
    ereaderProfile: EREADER_PROFILE.SMA4_EUR,
    startGuide: SMA4_START_GUIDE_USA,
  }),
  makeSma4Game({
    id: 'sma4-eur-fra',
    label: 'Super Mario Advance 4 (EUR French) 🇫🇷',
    ereaderProfile: EREADER_PROFILE.SMA4_EUR_FRA,
    startGuide: SMA4_START_GUIDE_USA,
  }),
  makeSma4Game({
    id: 'sma4-eur-ger',
    label: 'Super Mario Advance 4 (EUR German) 🇩🇪',
    ereaderProfile: EREADER_PROFILE.SMA4_EUR_GER,
    startGuide: SMA4_START_GUIDE_USA,
  }),
  makeSma4Game({
    id: 'sma4-eur-esp',
    label: 'Super Mario Advance 4 (EUR Spanish) 🇪🇸',
    ereaderProfile: EREADER_PROFILE.SMA4_EUR_ESP,
    startGuide: SMA4_START_GUIDE_USA,
  }),
  makeSma4Game({
    id: 'sma4-eur-ita',
    label: 'Super Mario Advance 4 (EUR Italian) 🇮🇹',
    ereaderProfile: EREADER_PROFILE.SMA4_EUR_ITA,
    startGuide: SMA4_START_GUIDE_USA,
  }),
];

const gamesById = new Map(GAMES.map((game) => [game.id, game]));

export function getGame(id) {
  return gamesById.get(id);
}
