// Pixel Player - Color to Sound Application

const CANVAS_SIZE = 512;

// Get current grid size from resolution selector
function getGridSize() {
    return parseInt(resolutionSelect.value) || 128;
}

function getPixelSize() {
    return CANVAS_SIZE / getGridSize();
}

// State
let pixelData = null;
let originalImage = null;  // Store original image for resampling
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
const loadUrlBtn = document.getElementById('loadUrl');
const soundfontUrlInput = document.getElementById('soundfontUrl');
const loadSoundfontBtn = document.getElementById('loadSoundfont');
const captureWebcamBtn = document.getElementById('captureWebcam');
const scaleSelect = document.getElementById('scaleSelect');
const playModeSelect = document.getElementById('playModeSelect');
const timingSelect = document.getElementById('timingSelect');
const resolutionSelect = document.getElementById('resolutionSelect');
const stopAllLinesBtn = document.getElementById('stopAllLines');
const minPitchInput = document.getElementById('minPitch');
const maxPitchInput = document.getElementById('maxPitch');
const statusEl = document.getElementById('status');
const pianoEl = document.getElementById('piano');

// Webcam state
let webcamStream = null;

// Piano state
let pianoKeys = {};  // Map of MIDI note to DOM element

// Get current pitch range from inputs
function getMinPitch() {
    return Math.max(0, Math.min(127, parseInt(minPitchInput.value) || 40));
}

function getMaxPitch() {
    return Math.max(0, Math.min(127, parseInt(maxPitchInput.value) || 100));
}

// Timing quantization state
const BPM = 120;
const BEAT_MS = (60 / BPM) * 1000;  // Duration of a quarter note in ms
let lastNoteTime = 0;

// Get note duration based on selected timing
function getNoteDurationMs() {
    const timing = timingSelect.value;
    switch (timing) {
        case 'quarter': return BEAT_MS;       // 1/4 note = 1 beat
        case 'eighth': return BEAT_MS / 2;    // 1/8 note = 0.5 beats
        case 'sixteenth': return BEAT_MS / 4; // 1/16 note = 0.25 beats
        case 'random':
            // Randomly choose between 1/4, 1/8, and 1/16 notes
            const choices = [BEAT_MS, BEAT_MS / 2, BEAT_MS / 4];
            return choices[Math.floor(Math.random() * choices.length)];
        default: return BEAT_MS / 4;
    }
}
let pendingNote = null;
let quantizeTimer = null;

// Line playing state
let lineStart = null;
let lineEnd = null;
let isDrawingLine = false;
let activeLines = [];  // Array of active line playbacks
let nextLineId = 0;

// Musical scales (intervals from root note)
const scales = {
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
    melodicMinor: [0, 2, 3, 5, 7, 9, 11],
    pentatonicMajor: [0, 2, 4, 7, 9],
    pentatonicMinor: [0, 3, 5, 7, 10],
    blues: [0, 3, 5, 6, 7, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    phrygian: [0, 1, 3, 5, 7, 8, 10],
    lydian: [0, 2, 4, 6, 7, 9, 11],
    mixolydian: [0, 2, 4, 5, 7, 9, 10],
    wholeTone: [0, 2, 4, 6, 8, 10]
};

// Build array of all MIDI notes in the selected scale
function getScaleNotes(scaleName, minNote, maxNote) {
    const min = minNote !== undefined ? minNote : getMinPitch();
    const max = maxNote !== undefined ? maxNote : getMaxPitch();
    const intervals = scales[scaleName] || scales.major;
    const notes = [];

    for (let octaveStart = 0; octaveStart <= 120; octaveStart += 12) {
        for (const interval of intervals) {
            const note = octaveStart + interval;
            if (note >= min && note <= max) {
                notes.push(note);
            }
        }
    }

    return notes.sort((a, b) => a - b);
}

// Quantize a raw note value to the nearest note in the scale
function quantizeToScale(rawNote, scaleName) {
    const scaleNotes = getScaleNotes(scaleName);
    if (scaleNotes.length === 0) return rawNote;

    // Find the closest note in the scale
    let closest = scaleNotes[0];
    let minDistance = Math.abs(rawNote - closest);

    for (const note of scaleNotes) {
        const distance = Math.abs(rawNote - note);
        if (distance < minDistance) {
            minDistance = distance;
            closest = note;
        }
    }

    return closest;
}

// Initialize
function init() {
    setupEventListeners();
    drawEmptyGrid();
    initAudio();
    buildPiano();

    // Load the default image
    if (imageUrlInput.value) {
        loadImageFromUrl(imageUrlInput.value);
    }
}

function initAudio() {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
}

// Piano keyboard
function buildPiano() {
    pianoEl.innerHTML = '';
    pianoKeys = {};

    const noteNames = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
    const blackNotes = [1, 3, 6, 8, 10];  // Db, Eb, Gb, Ab, Bb

    const startNote = getMinPitch();
    const endNote = getMaxPitch();

    for (let midi = startNote; midi <= endNote; midi++) {
        const noteIndex = midi % 12;
        const octave = Math.floor(midi / 12) - 1;
        const isBlack = blackNotes.includes(noteIndex);

        const key = document.createElement('div');
        key.className = `piano-key ${isBlack ? 'black' : 'white'}`;
        key.dataset.midi = midi;

        // Add note label for C notes (white keys only)
        if (noteIndex === 0) {
            const label = document.createElement('span');
            label.className = 'note-label';
            label.textContent = `C${octave}`;
            key.appendChild(label);
        }

        pianoEl.appendChild(key);
        pianoKeys[midi] = key;
    }
}

function highlightPianoKey(midiNote) {
    // Clear all highlights
    Object.values(pianoKeys).forEach(key => key.classList.remove('active'));

    // Highlight the played key
    if (pianoKeys[midiNote]) {
        pianoKeys[midiNote].classList.add('active');
    }
}

function clearPianoHighlight() {
    Object.values(pianoKeys).forEach(key => key.classList.remove('active'));
}

function setupEventListeners() {
    loadUrlBtn.addEventListener('click', () => loadImageFromUrl(imageUrlInput.value));
    captureWebcamBtn.addEventListener('click', captureFromWebcam);
    loadSoundfontBtn.addEventListener('click', () => loadSoundfont(soundfontUrlInput.value));
    stopAllLinesBtn.addEventListener('click', stopAllLinePlayback);

    // Rebuild piano when pitch range changes
    minPitchInput.addEventListener('change', buildPiano);
    maxPitchInput.addEventListener('change', buildPiano);

    // Resample image when resolution changes
    resolutionSelect.addEventListener('change', () => {
        stopAllLinePlayback();
        if (originalImage) {
            processImage(originalImage);
        }
    });

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

    for (let i = 0; i <= getGridSize(); i += 8) {
        const pos = i * getPixelSize();
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

async function captureFromWebcam() {
    setStatus('Accessing webcam...');

    try {
        // Request webcam access
        webcamStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } }
        });

        // Create video element
        const video = document.createElement('video');
        video.srcObject = webcamStream;
        video.setAttribute('playsinline', true);

        await new Promise((resolve) => {
            video.onloadedmetadata = () => {
                video.play();
                resolve();
            };
        });

        // Wait a moment for the camera to adjust
        setStatus('Camera ready - capturing in 1 second...');
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Capture frame to canvas
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = video.videoWidth;
        tempCanvas.height = video.videoHeight;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(video, 0, 0);

        // Stop the webcam stream
        webcamStream.getTracks().forEach(track => track.stop());
        webcamStream = null;

        // Create image from canvas
        const img = new Image();
        img.onload = () => processImage(img);
        img.src = tempCanvas.toDataURL('image/png');

    } catch (error) {
        if (webcamStream) {
            webcamStream.getTracks().forEach(track => track.stop());
            webcamStream = null;
        }

        if (error.name === 'NotAllowedError') {
            setStatus('Webcam access denied. Please allow camera access and try again.');
        } else if (error.name === 'NotFoundError') {
            setStatus('No webcam found. Please connect a camera and try again.');
        } else {
            setStatus('Error accessing webcam: ' + error.message);
        }
    }
}

function processImage(img) {
    // Store the original image for resampling later
    originalImage = img;
    resampleImage();
}

function resampleImage() {
    if (!originalImage) return;

    const gridSize = getGridSize();

    // Create temporary canvas to resize image
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = gridSize;
    tempCanvas.height = gridSize;
    const tempCtx = tempCanvas.getContext('2d');

    // Draw image scaled to grid size
    tempCtx.drawImage(originalImage, 0, 0, gridSize, gridSize);

    // Get pixel data - copy to a new array to avoid reference issues
    const imageData = tempCtx.getImageData(0, 0, gridSize, gridSize);
    pixelData = new Uint8ClampedArray(imageData.data);

    // Clear and draw to main canvas (scaled up)
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tempCanvas, 0, 0, CANVAS_SIZE, CANVAS_SIZE);

    setStatus(`Image loaded at ${gridSize}x${gridSize}. Draw lines to play!`);
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

        // Parse the MIDI.js soundfont format (uses single quotes, not valid JSON)
        const match = text.match(/MIDI\.Soundfont\.(\w+)\s*=\s*({[\s\S]*})/);
        if (match) {
            // Convert single quotes to double quotes for JSON parsing
            let jsonStr = match[2]
                .replace(/'/g, '"')  // Replace single quotes with double quotes
                .replace(/,\s*}/g, '}');  // Remove trailing commas
            const data = JSON.parse(jsonStr);
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

    const playMode = playModeSelect.value;

    if (playMode === 'line' || playMode === 'lineLoop') {
        startLineDrawing(event);
    } else {
        isDragging = true;
        playAtPosition(event);
    }
}

function onDrag(event) {
    if (!pixelData) return;

    const playMode = playModeSelect.value;

    if (playMode === 'line' || playMode === 'lineLoop') {
        updateLineDrawing(event);
    } else {
        if (!isDragging) return;
        playAtPosition(event);
    }
}

function endDrag() {
    const playMode = playModeSelect.value;

    if (playMode === 'line' || playMode === 'lineLoop') {
        endLineDrawing();
    } else {
        isDragging = false;
        lastPlayedPixel = { x: -1, y: -1 };
        stopAllNotes();
        clearPianoHighlight();

        // Reset timing quantization
        if (quantizeTimer) {
            clearTimeout(quantizeTimer);
            quantizeTimer = null;
        }
        lastNoteTime = 0;
        pendingNote = null;
    }
}

// Line Playing Mode
function startLineDrawing(event) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) / getPixelSize());
    const y = Math.floor((event.clientY - rect.top) / getPixelSize());

    if (x < 0 || x >= getGridSize() || y < 0 || y >= getGridSize()) return;

    lineStart = { x, y };
    lineEnd = { x, y };
    isDrawingLine = true;

    redrawWithActiveLines();
    drawLinePreview();
    setStatus(`Drawing line... release to play (${activeLines.length} active)`);
}

function updateLineDrawing(event) {
    if (!isDrawingLine) return;

    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) / getPixelSize());
    const y = Math.floor((event.clientY - rect.top) / getPixelSize());

    // Clamp to grid bounds
    lineEnd = {
        x: Math.max(0, Math.min(getGridSize() - 1, x)),
        y: Math.max(0, Math.min(getGridSize() - 1, y))
    };

    redrawWithActiveLines();
    drawLinePreview();
}

function endLineDrawing() {
    if (!isDrawingLine) return;

    isDrawingLine = false;

    if (lineStart && lineEnd) {
        // Calculate pixels along the line
        const pixels = getLinePixels(lineStart.x, lineStart.y, lineEnd.x, lineEnd.y);

        if (pixels.length > 0) {
            // Create a new line playback object
            const lineId = nextLineId++;
            const line = {
                id: lineId,
                pixels: pixels,
                currentIndex: 0,
                timer: null,
                color: getRandomLineColor()
            };

            activeLines.push(line);
            startSingleLinePlayback(line);
            updateLineStatus();
        }
    }

    redrawWithActiveLines();
}

function getRandomLineColor() {
    const hue = Math.random() * 360;
    return `hsl(${hue}, 100%, 50%)`;
}

function getLinePixels(x0, y0, x1, y1) {
    // Bresenham's line algorithm
    const pixels = [];
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    let x = x0;
    let y = y0;

    while (true) {
        pixels.push({ x, y });

        if (x === x1 && y === y1) break;

        const e2 = 2 * err;
        if (e2 > -dy) {
            err -= dy;
            x += sx;
        }
        if (e2 < dx) {
            err += dx;
            y += sy;
        }
    }

    return pixels;
}

function drawLinePreview() {
    if (!lineStart || !lineEnd) return;

    // Draw the line being drawn
    ctx.strokeStyle = '#ff0';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(lineStart.x * getPixelSize() + getPixelSize() / 2, lineStart.y * getPixelSize() + getPixelSize() / 2);
    ctx.lineTo(lineEnd.x * getPixelSize() + getPixelSize() / 2, lineEnd.y * getPixelSize() + getPixelSize() / 2);
    ctx.stroke();

    // Draw start point
    ctx.fillStyle = '#0f0';
    ctx.beginPath();
    ctx.arc(lineStart.x * getPixelSize() + getPixelSize() / 2, lineStart.y * getPixelSize() + getPixelSize() / 2, 6, 0, Math.PI * 2);
    ctx.fill();

    // Draw end point
    ctx.fillStyle = '#f00';
    ctx.beginPath();
    ctx.arc(lineEnd.x * getPixelSize() + getPixelSize() / 2, lineEnd.y * getPixelSize() + getPixelSize() / 2, 6, 0, Math.PI * 2);
    ctx.fill();
}

function redrawImage() {
    if (!pixelData) return;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = getGridSize();
    tempCanvas.height = getGridSize();
    const tempCtx = tempCanvas.getContext('2d');
    const imageData = new ImageData(new Uint8ClampedArray(pixelData), getGridSize(), getGridSize());
    tempCtx.putImageData(imageData, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tempCanvas, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
}

function redrawWithActiveLines() {
    redrawImage();

    // Draw all active lines
    for (const line of activeLines) {
        drawActiveLine(line);
    }
}

function drawActiveLine(line) {
    if (line.pixels.length < 2) return;

    // Draw the full line path
    ctx.strokeStyle = line.color;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.moveTo(line.pixels[0].x * getPixelSize() + getPixelSize() / 2, line.pixels[0].y * getPixelSize() + getPixelSize() / 2);
    for (let i = 1; i < line.pixels.length; i++) {
        ctx.lineTo(line.pixels[i].x * getPixelSize() + getPixelSize() / 2, line.pixels[i].y * getPixelSize() + getPixelSize() / 2);
    }
    ctx.stroke();
    ctx.globalAlpha = 1.0;

    // Highlight current pixel
    if (line.currentIndex < line.pixels.length) {
        const pixel = line.pixels[line.currentIndex];
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.strokeRect(pixel.x * getPixelSize(), pixel.y * getPixelSize(), getPixelSize(), getPixelSize());

        // Draw a filled circle at current position
        ctx.fillStyle = line.color;
        ctx.beginPath();
        ctx.arc(pixel.x * getPixelSize() + getPixelSize() / 2, pixel.y * getPixelSize() + getPixelSize() / 2, 5, 0, Math.PI * 2);
        ctx.fill();
    }
}

function startSingleLinePlayback(line) {
    playLineNoteForLine(line);
}

function playLineNoteForLine(line) {
    if (line.currentIndex >= line.pixels.length) {
        // Check if we should loop
        if (playModeSelect.value === 'lineLoop') {
            // Reset to beginning and continue
            line.currentIndex = 0;
        } else {
            // Line playback complete
            removeLine(line.id);
            return;
        }
    }

    const pixel = line.pixels[line.currentIndex];
    const pixelIndex = (pixel.y * getGridSize() + pixel.x) * 4;
    const r = pixelData[pixelIndex];
    const g = pixelData[pixelIndex + 1];
    const b = pixelData[pixelIndex + 2];

    // Play the note
    const minPitch = getMinPitch();
    const maxPitch = getMaxPitch();
    const pitchRange = maxPitch - minPitch;
    const rawNote = Math.floor((r / 255) * pitchRange) + minPitch;
    const scaleName = scaleSelect.value;
    const midiNote = quantizeToScale(rawNote, scaleName);
    const volume = 0.4 + (g / 255) * 0.6;
    const pan = (b / 255) * 2 - 1;

    // Play without stopping other notes (allow polyphony)
    highlightPianoKey(midiNote);

    if (Object.keys(soundfontSamples).length > 0) {
        playSoundfontNotePolyphonic(midiNote, volume, pan, line.id);
    } else {
        playOscillatorNotePolyphonic(midiNote, volume, pan, line.id);
    }

    // Update display
    redrawWithActiveLines();

    line.currentIndex++;

    // Schedule next note for this line
    line.timer = setTimeout(() => playLineNoteForLine(line), getNoteDurationMs());
}

function removeLine(lineId) {
    const index = activeLines.findIndex(l => l.id === lineId);
    if (index !== -1) {
        const line = activeLines[index];
        if (line.timer) {
            clearTimeout(line.timer);
        }
        // Stop the note associated with this line
        stopNoteForLine(lineId);
        activeLines.splice(index, 1);
    }

    redrawWithActiveLines();
    updateLineStatus();
}

function updateLineStatus() {
    if (activeLines.length > 0) {
        const looping = playModeSelect.value === 'lineLoop' ? ' (looping)' : '';
        setStatus(`${activeLines.length} line(s) playing${looping}. Draw more lines to add!`);
    } else if (pixelData) {
        setStatus('Draw a line to play. Lines can overlap!');
    }
}

function stopAllLinePlayback() {
    for (const line of activeLines) {
        if (line.timer) {
            clearTimeout(line.timer);
        }
        stopNoteForLine(line.id);
    }
    activeLines = [];
    clearPianoHighlight();
    redrawImage();
    if (pixelData) {
        setStatus('All lines stopped. Draw a new line to play!');
    }
}

// Polyphonic note functions (don't stop other notes)
function playSoundfontNotePolyphonic(midiNote, volume, pan, lineId) {
    const noteNames = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
    const octave = Math.floor(midiNote / 12) - 1;
    const noteName = noteNames[midiNote % 12] + octave;

    const buffer = soundfontSamples[noteName];
    if (!buffer) {
        playOscillatorNotePolyphonic(midiNote, volume, pan, lineId);
        return;
    }

    // Stop previous note for this line
    stopNoteForLine(lineId);

    const source = audioContext.createBufferSource();
    source.buffer = buffer;

    const gainNode = audioContext.createGain();
    gainNode.gain.value = volume * 0.3;  // Reduced volume for polyphony

    const panNode = audioContext.createStereoPanner();
    panNode.pan.value = pan;

    source.connect(gainNode);
    gainNode.connect(panNode);
    panNode.connect(audioContext.destination);

    source.start();

    activeNotes.set(`line_${lineId}`, { source, gainNode });
}

function playOscillatorNotePolyphonic(midiNote, volume, pan, lineId) {
    const frequency = 440 * Math.pow(2, (midiNote - 69) / 12);

    // Stop previous note for this line
    stopNoteForLine(lineId);

    const oscillator = audioContext.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;

    const gainNode = audioContext.createGain();
    gainNode.gain.value = volume * 0.15;  // Reduced volume for polyphony

    const panNode = audioContext.createStereoPanner();
    panNode.pan.value = pan;

    oscillator.connect(gainNode);
    gainNode.connect(panNode);
    panNode.connect(audioContext.destination);

    oscillator.start();

    activeNotes.set(`line_${lineId}`, { oscillator, gainNode });
}

function stopNoteForLine(lineId) {
    const key = `line_${lineId}`;
    const note = activeNotes.get(key);
    if (note) {
        try {
            if (note.oscillator) {
                note.gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.05);
                setTimeout(() => note.oscillator.stop(), 50);
            }
            if (note.source) {
                note.gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.05);
                setTimeout(() => note.source.stop(), 50);
            }
        } catch (e) {
            // Note already stopped
        }
        activeNotes.delete(key);
    }
}

function playAtPosition(event) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) / getPixelSize());
    const y = Math.floor((event.clientY - rect.top) / getPixelSize());

    if (x < 0 || x >= getGridSize() || y < 0 || y >= getGridSize()) return;
    if (x === lastPlayedPixel.x && y === lastPlayedPixel.y) return;

    lastPlayedPixel = { x, y };

    const pixelIndex = (y * getGridSize() + x) * 4;
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
    tempCanvas.width = getGridSize();
    tempCanvas.height = getGridSize();
    const tempCtx = tempCanvas.getContext('2d');
    const imageData = new ImageData(new Uint8ClampedArray(pixelData), getGridSize(), getGridSize());
    tempCtx.putImageData(imageData, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tempCanvas, 0, 0, CANVAS_SIZE, CANVAS_SIZE);

    // Draw highlight
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(x * getPixelSize(), y * getPixelSize(), getPixelSize(), getPixelSize());
}

// Sound Generation
function playColorSound(r, g, b) {
    // Map RGB to sound parameters
    // R (0-255) -> MIDI note (minPitch-maxPitch), quantized to selected scale
    // G (0-255) -> Volume (40-100%)
    // B (0-255) -> Pan (-1 to 1)

    const minPitch = getMinPitch();
    const maxPitch = getMaxPitch();
    const pitchRange = maxPitch - minPitch;
    const rawNote = Math.floor((r / 255) * pitchRange) + minPitch;
    const scaleName = scaleSelect.value;
    const midiNote = quantizeToScale(rawNote, scaleName);
    const volume = 0.4 + (g / 255) * 0.6;  // Map to 40-100%
    const pan = (b / 255) * 2 - 1;

    // Store the pending note (will be played on next quantized beat)
    pendingNote = { midiNote, volume, pan };

    // Schedule the note to play on the next 16th note boundary
    scheduleQuantizedNote();
}

function scheduleQuantizedNote() {
    const now = Date.now();
    const noteDuration = getNoteDurationMs();

    // If this is the first note, start the timing grid now
    if (lastNoteTime === 0) {
        lastNoteTime = now;
        playPendingNote();
        return;
    }

    // Calculate time until next note beat
    const timeSinceLastNote = now - lastNoteTime;
    const timeUntilNextBeat = noteDuration - (timeSinceLastNote % noteDuration);

    // If we're very close to a beat (within 10ms), play immediately
    if (timeUntilNextBeat < 10 || timeSinceLastNote >= noteDuration) {
        lastNoteTime = now - (timeSinceLastNote % noteDuration);
        playPendingNote();
        return;
    }

    // Clear any existing timer
    if (quantizeTimer) {
        clearTimeout(quantizeTimer);
    }

    // Schedule the note to play on the next beat
    quantizeTimer = setTimeout(() => {
        lastNoteTime += noteDuration * Math.ceil(timeSinceLastNote / noteDuration);
        playPendingNote();
    }, timeUntilNextBeat);
}

function playPendingNote() {
    if (!pendingNote) return;

    const { midiNote, volume, pan } = pendingNote;

    stopAllNotes();

    // Highlight the piano key
    highlightPianoKey(midiNote);

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
    const minPitch = getMinPitch();
    const maxPitch = getMaxPitch();
    const pitchRange = maxPitch - minPitch;
    const rawNote = Math.floor((r / 255) * pitchRange) + minPitch;
    const scaleName = scaleSelect.value;
    const midiNote = quantizeToScale(rawNote, scaleName);
    const noteNames = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
    const octave = Math.floor(midiNote / 12) - 1;
    const noteName = noteNames[midiNote % 12] + octave;
    const volume = Math.round(40 + (g / 255) * 60);
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
