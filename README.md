# SoundFont Toy

A browser-based app that turns images into music. Load an image, and drag your mouse over a 128x128 pixel grid to play sounds based on the colors.

## How It Works

- **Red** (0-255) = Pitch (MIDI notes 36-96, spanning 5 octaves)
- **Green** (0-255) = Volume (0-100%)
- **Blue** (0-255) = Stereo Pan (Left to Right)

## Features

- Load images from URL or upload local files
- 128x128 pixel grid visualization
- Mouse and touch support for playing
- SoundFont support for realistic instrument sounds
- Falls back to oscillator synthesis if no SoundFont loaded
- Real-time display of note, volume, and pan values

## Usage

1. Open `index.html` in a web browser
2. Load an image via URL or file upload
3. Optionally load a SoundFont for better sound quality
4. Click and drag over the pixel grid to play music!

## SoundFont Sources

The app supports MIDI.js format SoundFonts. Try these:
- https://gleitz.github.io/midi-js-soundfonts/MusyngKite/acoustic_grand_piano-mp3.js
- https://gleitz.github.io/midi-js-soundfonts/MusyngKite/violin-mp3.js
- https://gleitz.github.io/midi-js-soundfonts/MusyngKite/flute-mp3.js

## License

MIT
