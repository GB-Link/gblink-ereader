# GB-Link e-Reader Emulation

Bring the Nintendo e-Reader back from the dead. This is the web client for the **[GB-Link adapter](https://gblink.io)**, letting your browser scan Eon Tickets and other long-lost dotcode cards into real copies of Pokémon Ruby / Sapphire and Super Mario Advance 4.

### Online Demo

Try it live at [ereader.gblink.io](https://ereader.gblink.io) (requires a GB-Link adapter).

### Requirements

- A **GB-Link adapter** running firmware v2.2.2 or later
- A **Game Boy Advance link cable**
- A browser with WebUSB (Chromium-based, Chrome/Edge) or WebSerial (Firefox 151+)
- e-Reader cards in `.bin`, `.raw`, or `.sav` format (this project doesn't host or link to card files; DLC content can be found at [notblisy/RUBYSAPPHIREDLC](https://github.com/notblisy/RUBYSAPPHIREDLC))

### Supported Games

- **Pokémon Ruby / Sapphire** (USA and Japanese)
  - Mystery Event cards (e.g. Eon Ticket)
  - Battle-e cards (Trainer and Enigma Berry)
  - Custom / DLC cards
  - **How to start:** Beat Norman, then talk to the person by the PC in the Petalburg City Pokémon Center and enter the phrase "MYSTERY EVENT IS EXCITING". Save and reboot; **Mystery Event** now appears on the main menu. Select it, connect the adapter, send the card, then press **A** on the GBA when prompted to load the event.
- **Super Mario Advance 4** (USA and Japanese)
  - Demo cards
  - Power-Up cards
  - Level cards (including custom cards from Smaghetti)
  - **How to start (Demo / Power-Up):** On any world map, press **R** to bring up the card-scan menu, choose **Demo Card** or **Power-Up Card**, then click Connect Game Boy in the client. When prompted, click **OK** to start the card scan on the GBA.
  - **How to start (Level):** From the File Select screen, scroll to the bottom and choose **Level Card**; you'll be warped to World-e. Walk to the glowing Level Scan Portal and press **A**. Lakitu flies in, then Click Connect Game Boy in the client. When prompted, click **OK** to start the card scan.

### Unsupported Games

These e-Reader titles cannot be used with GB-Link e-Reader:

- Animal Crossing-e cards (used to connect a GBA to Animal Crossing on GameCube)
- Pokémon-e Trading Card Game
- NES-e
- Mario Party-e
- Pokémon Channel
- Other e-Reader-only applications (Kirby, Air Hockey-e, Ice Climber-e, etc.)
- Other Japan-only e-Reader titles (Pokémon FireRed / LeafGreen / Emerald e-Reader data, Pokémon Pinball: Ruby & Sapphire, Mega Man Zero 3, Mario vs. Donkey Kong, Pikmin 2-e, Donkey Kong-e, etc.)

---

## How it works

1. Select the target game from the dropdown.
2. Drop in a card file.
3. The client detects the card type and validates it against the selected game.
4. Click **Connect Game Boy** and select your GB-Link adapter.
5. Start the e-Reader flow in-game (see **How to start** under each game above).
6. The card is sent automatically once the adapter is connected and in game.

---

# Development

This project is built with [Vite](https://vitejs.dev/).

## Development Server

To start a local development server:

```bash
npm install
npm run dev
```

WebUSB requires a secure context, so the dev server runs over HTTPS by default.

## Build

```bash
npm run build
```

Outputs a production build to `dist/`.

---

## License

This project is licensed under the [GNU General Public License v3.0](LICENSE).

## Support

If you find this project useful, consider supporting ongoing development on Ko-fi.

<a href="https://ko-fi.com/raphaelzdev"><img src="https://storage.ko-fi.com/cdn/brandasset/v2/support_me_on_kofi_dark.png" width="200" alt="Support me on Ko-fi"></a>

## Credits

- [pret/pokeruby](https://github.com/pret/pokeruby): Pokémon Ruby / Sapphire disassembly, used to reverse-engineer the Mystery Event protocol.
- [LuigiBlood/sma4comm](https://github.com/LuigiBlood/sma4comm): Super Mario Advance 4 e-Reader protocol documentation.
- [mattieb/4-e](https://github.com/mattieb/4-e): a reference implementation for sending SMA4 e-Card data over a link cable.
- [notblisy/RUBYSAPPHIREDLC](https://github.com/notblisy/RUBYSAPPHIREDLC): Pokémon Ruby / Sapphire DLC card content.
- [HunterRDev/eReader-Compression](https://github.com/HunterRDev/eReader-Compression): reference for decompiling and recompiling e-Reader card data to and from `.raw`, used for the vpk0 decompression in the card parser.
