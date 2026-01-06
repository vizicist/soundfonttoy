// SoundFont Toy - Color to Sound Application

const GRID_SIZE = 128;
const CANVAS_SIZE = 512;
const PIXEL_SIZE = CANVAS_SIZE / GRID_SIZE;

// State
let pixelData = null;
let audioContext = null;
let soundfontSamples = {};
let isLoading = false;
let isDragging = false;
let lastPlayedPixel = { x: -1, y: -1 };
let activeNotes = new Map();

// DOM Elements
const canvas = document.getElementById('pixelGrid');
const ctx = canvas.getContext('2d');
const imageUrlInput = document.getElementById('imageUrl');
const imageFileInput = document.getElementById('imageFile');
const loadUrlBtn = document.getElementById('loadUrl');
const soundfontUrlInput = document.getElementById('soundfontUrl');
const loadSoundfontBtn = document.getElementById('loadSoundfont');
const statusEl = document.getElementById('status');

// Initialize
function init() {
    setupEventListeners();
    drawEmptyGrid();
    initAudio();
}

function initAudio() {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
}

function setupEventListeners() {
    loadUrlBtn.addEventListener('click', () => loadImageFromUrl(imageUrlInput.value));
    imageFileInput.addEventListener('change', loadImageFromFile);
    loadSoundfontBtn.addEventListener('click', () => loadSoundfont(soundfontUrlInput.value));

    canvas.addEventListener('mousedown', startDrag);
    canvas.addEventListener('mousemove', onDrag);
    canvas.addEventListener('mouseup', endDrag);
    canvas.addEventListener('mouseleave', endDrag);

    // Touch support
    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        startDrag(e.touches[0]);
    });
    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        onDrag(e.touches[0]);
    });
    canvas.addEventListener('touchend', endDrag);

    // Resume audio context on user interaction
    document.addEventListener('click', () => {
        if (audioContext && audioContext.state === 'suspended') {
            audioContext.resume();
        }
    }, { once: true });
}

function drawEmptyGrid() {
    ctx.fillStyle = '#0f0f23';
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 0.5;

    for (let i = 0; i <= GRID_SIZE; i += 8) {
        const pos = i * PIXEL_SIZE;
        ctx.beginPath();
        ctx.moveTo(pos, 0);
        ctx.lineTo(pos, CANVAS_SIZE);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, pos);
        ctx.lineTo(CANVAS_SIZE, pos);
        ctx.stroke();
    }
}

// Image Loading
async function loadImageFromUrl(url) {
    if (!url) {
        setStatus('Please enter an image URL');
        return;
    }

    setStatus('Loading image...');

    try {
        const img = new Image();
        img.crossOrigin = 'anonymous';

        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = () => reject(new Error('Failed to load image. Try a different URL or upload a local file.'));
            img.src = url;
        });

        processImage(img);
    } catch (error) {
        setStatus('Error: ' + error.message);
    }
}

function loadImageFromFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    setStatus('Loading image...');

    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => processImage(img);
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function processImage(img) {
    // Create temporary canvas to resize image
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = GRID_SIZE;
    tempCanvas.height = GRID_SIZE;
    const tempCtx = tempCanvas.getContext('2d');

    // Draw image scaled to grid size
    tempCtx.drawImage(img, 0, 0, GRID_SIZE, GRID_SIZE);

    // Get pixel data
    const imageData = tempCtx.getImageData(0, 0, GRID_SIZE, GRID_SIZE);
    pixelData = imageData.data;

    // Draw to main canvas (scaled up)
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tempCanvas, 0, 0, CANVAS_SIZE, CANVAS_SIZE);

    setStatus('Image loaded! Drag mouse over pixels to play sounds. Load a SoundFont for better audio.');
}

// SoundFont Loading
async function loadSoundfont(url) {
    if (!url) {
        setStatus('Please enter a SoundFont URL');
        return;
    }

    setStatus('Loading SoundFont...');
    isLoading = true;

    try {
        // For MIDI.js soundfont format
        const response = await fetch(url);
        const text = await response.text();

        // Parse the MIDI.js soundfont format
        const match = text.match(/MIDI\.Soundfont\.(\w+)\s*=\s*({[\s\S]*})/);
        if (match) {
            const data = JSON.parse(match[2]);
            await loadSoundfontData(data);
            setStatus('SoundFont loaded! Drag mouse over pixels to play.');
        } else {
            throw new Error('Invalid SoundFont format');
        }
    } catch (error) {
        setStatus('Error loading SoundFont: ' + error.message + '. Using basic oscillator.');
        soundfontSamples = {};
    }

    isLoading = false;
}

async function loadSoundfontData(data) {
    soundfontSamples = {};

    for (const [note, dataUri] of Object.entries(data)) {
        try {
            const response = await fetch(dataUri);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            soundfontSamples[note] = audioBuffer;
        } catch (e) {
            console.warn(`Failed to load note ${note}:`, e);
        }
    }
}

// Mouse/Touch Interaction
function startDrag(event) {
    if (!pixelData) return;

    if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume();
    }

    isDragging = true;
    playAtPosition(event);
}

function onDrag(event) {
    if (!isDragging || !pixelData) return;
    playAtPosition(event);
}

function endDrag() {
    isDragging = false;
    lastPlayedPixel = { x: -1, y: -1 };
    stopAllNotes();
}

function playAtPosition(event) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) / PIXEL_SIZE);
    const y = Math.floor((event.clientY - rect.top) / PIXEL_SIZE);

    if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) return;
    if (x === lastPlayedPixel.x && y === lastPlayedPixel.y) return;

    lastPlayedPixel = { x, y };

    const pixelIndex = (y * GRID_SIZE + x) * 4;
    const r = pixelData[pixelIndex];
    const g = pixelData[pixelIndex + 1];
    const b = pixelData[pixelIndex + 2];

    playColorSound(r, g, b);
    highlightPixel(x, y);
    updateStatus(r, g, b, x, y);
}

function highlightPixel(x, y) {
    // Redraw the image
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = GRID_SIZE;
    tempCanvas.height = GRID_SIZE;
    const tempCtx = tempCanvas.getContext('2d');
    const imageData = new ImageData(new Uint8ClampedArray(pixelData), GRID_SIZE, GRID_SIZE);
    tempCtx.putImageData(imageData, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tempCanvas, 0, 0, CANVAS_SIZE, CANVAS_SIZE);

    // Draw highlight
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(x * PIXEL_SIZE, y * PIXEL_SIZE, PIXEL_SIZE, PIXEL_SIZE);
}

// Sound Generation
function playColorSound(r, g, b) {
    // Map RGB to sound parameters
    // R (0-255) -> MIDI note (36-96, 5 octaves)
    // G (0-255) -> Volume (0-1)
    // B (0-255) -> Pan (-1 to 1)

    const midiNote = Math.floor((r / 255) * 60) + 36;
    const volume = g / 255;
    const pan = (b / 255) * 2 - 1;

    stopAllNotes();

    if (volume < 0.05) return; // Skip very quiet notes

    if (Object.keys(soundfontSamples).length > 0) {
        playSoundfontNote(midiNote, volume, pan);
    } else {
        playOscillatorNote(midiNote, volume, pan);
    }
}

function playSoundfontNote(midiNote, volume, pan) {
    const noteNames = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
    const octave = Math.floor(midiNote / 12) - 1;
    const noteName = noteNames[midiNote % 12] + octave;

    const buffer = soundfontSamples[noteName];
    if (!buffer) {
        playOscillatorNote(midiNote, volume, pan);
        return;
    }

    const source = audioContext.createBufferSource();
    source.buffer = buffer;

    const gainNode = audioContext.createGain();
    gainNode.gain.value = volume * 0.5;

    const panNode = audioContext.createStereoPanner();
    panNode.pan.value = pan;

    source.connect(gainNode);
    gainNode.connect(panNode);
    panNode.connect(audioContext.destination);

    source.start();

    activeNotes.set('soundfont', { source, gainNode });
}

function playOscillatorNote(midiNote, volume, pan) {
    const frequency = 440 * Math.pow(2, (midiNote - 69) / 12);

    const oscillator = audioContext.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;

    const gainNode = audioContext.createGain();
    gainNode.gain.value = volume * 0.3;

    const panNode = audioContext.createStereoPanner();
    panNode.pan.value = pan;

    oscillator.connect(gainNode);
    gainNode.connect(panNode);
    panNode.connect(audioContext.destination);

    oscillator.start();

    activeNotes.set('oscillator', { oscillator, gainNode });
}

function stopAllNotes() {
    for (const [key, note] of activeNotes) {
        try {
            if (note.oscillator) {
                note.gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.1);
                setTimeout(() => note.oscillator.stop(), 100);
            }
            if (note.source) {
                note.gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.1);
                setTimeout(() => note.source.stop(), 100);
            }
        } catch (e) {
            // Note already stopped
        }
    }
    activeNotes.clear();
}

function updateStatus(r, g, b, x, y) {
    const midiNote = Math.floor((r / 255) * 60) + 36;
    const noteNames = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
    const octave = Math.floor(midiNote / 12) - 1;
    const noteName = noteNames[midiNote % 12] + octave;
    const volume = Math.round((g / 255) * 100);
    const pan = Math.round(((b / 255) * 2 - 1) * 100);
    const panLabel = pan < 0 ? `${Math.abs(pan)}% Left` : pan > 0 ? `${pan}% Right` : 'Center';

    statusEl.className = 'status playing';
    statusEl.innerHTML = `
        <strong>Pixel (${x}, ${y})</strong> |
        RGB(${r}, ${g}, ${b}) |
        Note: <strong>${noteName}</strong> |
        Volume: ${volume}% |
        Pan: ${panLabel}
    `;
}

function setStatus(message) {
    statusEl.className = 'status';
    statusEl.textContent = message;
}

// Start the app
init();
