import { PhysicsVisualizer } from './visualizer.js';
import { WaveformDisplay } from './waveform.js';

class AudioApp {
    constructor() {
        this.ctx = null;
        this.audioBuffer = null;
        this.audio = new Audio(); // HTML5 Audio Element
        this.audio.loop = false;
        this.mediaSource = null;
        this.workletNode = null;

        // Playback State
        this.isPlaying = false;
        // startTime and pauseTime are less relevant with AudioElement, 
        // relying on this.audio.currentTime

        // UI Elements
        this.dropZone = document.getElementById('drop-zone');
        this.fileInput = document.getElementById('file-input');

        this.playerControls = document.getElementById('player-controls');
        this.btnPlay = document.getElementById('btn-play');
        this.btnStop = document.getElementById('btn-stop');
        this.btnLoop = document.getElementById('btn-loop');

        this.timeCurrent = document.getElementById('time-current');
        this.timeTotal = document.getElementById('time-total');

        this.waveformCanvas = document.getElementById('waveform-canvas');

        this.led = document.getElementById('signal-led');

        // Meter Elements
        this.elMomentary = document.getElementById('val-momentary');
        this.elShortterm = document.getElementById('val-shortterm');
        this.elIntegrated = document.getElementById('val-integrated');
        this.elLra = document.getElementById('val-lra');
        this.elTruepeak = document.getElementById('val-truepeak');
        this.elMainDisplay = document.getElementById('current-lufs-value');

        // Visualizers
        this.visualizer = new PhysicsVisualizer();
        this.waveform = new WaveformDisplay('waveform-canvas');

        this.initListeners();
    }

    async initListeners() {
        // Drag & Drop
        this.dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.dropZone.classList.add('drag-over');
        });
        this.dropZone.addEventListener('dragleave', () => {
            this.dropZone.classList.remove('drag-over');
        });
        this.dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            this.dropZone.classList.remove('drag-over');
            if (e.dataTransfer.files.length) {
                this.handleFile(e.dataTransfer.files[0]);
            }
        });
        // Click handled by <label>
        this.fileInput.addEventListener('change', (e) => {
            if (e.target.files.length) this.handleFile(e.target.files[0]);
        });

        // Transport
        this.btnPlay.addEventListener('click', () => this.togglePlay());
        this.btnStop.addEventListener('click', () => this.stop());
        // Reset Button (formerly Loop)
        this.btnLoop.addEventListener('click', () => {
            // Do not stop playback. Just reset meters and visualizer.
            this.visualizer.reset();

            if (this.workletNode) {
                this.workletNode.port.postMessage({ type: 'reset' });
            }

            // Reset UI Values manually to -oo
            this.updateUI({
                momentary: -100,
                shortTerm: -100,
                integrated: -100,
                lra: 0,
                truePeak: -100
            });
        });

        // Waveform Seeking
        // Click to seek
        this.waveformCanvas.addEventListener('mousedown', (e) => {
            if (!this.audioBuffer) return;
            const time = this.waveform.getClickedTime(e.clientX);
            this.seek(time);

            // Drag seeking (Optional)
            const self = this;
            function onMove(moveEvent) {
                const t = self.waveform.getClickedTime(moveEvent.clientX);
                self.seek(t);
            }
            function onUp() {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
            }
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
        });

        // Keyboard shortcuts
        window.addEventListener('keydown', (e) => {
            if (e.code === 'Space') {
                e.preventDefault();
                this.togglePlay();
            }
        });

        // Audio Element Listeners
        this.audio.addEventListener('ended', () => {
            if (!this.audio.loop) {
                this.stop(false);
            }
        });
    }

    async initAudioContext() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)({
                latencyHint: 'interactive',
                sampleRate: 48000
            });
            await this.ctx.audioWorklet.addModule('audio-worklet.js');
            this.workletNode = new AudioWorkletNode(this.ctx, 'lufs-processor');
            this.workletNode.port.onmessage = (event) => {
                this.updateUI(event.data);
                this.visualizer.update(event.data);
            };

            // Connect AudioElement to Web Audio API
            this.mediaSource = this.ctx.createMediaElementSource(this.audio);
            this.mediaSource.connect(this.ctx.destination); // For listening
            this.mediaSource.connect(this.workletNode);     // For analysis
        }
        if (this.ctx.state === 'suspended') {
            await this.ctx.resume();
        }
    }

    async handleFile(file) {
        const validExtensions = ['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac', '.wma', '.aiff'];
        const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
        const isAudioType = file.type.startsWith('audio/');
        const isValidExt = validExtensions.includes(ext);

        if (!isAudioType && !isValidExt) {
            alert(`File type not supported: ${file.type || 'Unknown'}\nPlease upload an audio file.`);
            return;
        }

        this.dropZone.querySelector('.drop-text').textContent = `Loading ${file.name}...`;

        try {
            // Reset everything for new file
            this.stop(true);
            this.visualizer.reset();
            if (this.workletNode) {
                this.workletNode.port.postMessage({ type: 'reset' });
            }
            this.updateUI({
                momentary: -100,
                shortTerm: -100,
                integrated: -100,
                lra: 0,
                truePeak: -100
            });

            await this.initAudioContext();

            // 1. Create Blob URL for Streaming Playback (Mobile compatible)
            const url = URL.createObjectURL(file);
            this.audio.src = url;

            // 2. Decode for Visual Waveform (still needed)
            const arrayBuffer = await file.arrayBuffer();
            this.audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);

            // Ready UI
            this.dropZone.querySelector('.drop-text').textContent = file.name;
            this.playerControls.classList.remove('disabled');
            this.timeTotal.textContent = `-${this.formatTime(this.audioBuffer.duration)}`;

            // Draw Waveform
            this.waveform.loadAudio(this.audioBuffer);

            // Start playback
            this.play();
        } catch (err) {
            console.error(err);
            alert('Error decoding audio file.');
            this.dropZone.querySelector('.drop-text').textContent = 'Error loading file.';
        }
    }

    async play() {
        if (!this.audio.src) return;

        await this.initAudioContext(); // Ensure context is ready/resumed

        try {
            await this.audio.play();
            this.isPlaying = true;
            this.btnPlay.textContent = 'II';
            this.visualizer.start();
            this.animateFrame = requestAnimationFrame(() => this.updateTime());
        } catch (e) {
            console.error("Playback failed:", e);
        }
    }

    stop(reset = true) {
        this.audio.pause();
        this.isPlaying = false;
        this.btnPlay.textContent = '▶';
        cancelAnimationFrame(this.animateFrame);
        this.led.classList.remove('active');

        if (reset) {
            this.audio.currentTime = 0;
            this.timeCurrent.textContent = "00:00";
            this.timeTotal.textContent = "-00:00"; // Reset total? Or keep duration? 
            // Better to keep duration if loaded, but if really resetting everything...
            // If audioBuffer exists, show duration.
            if (this.audioBuffer) {
                this.timeTotal.textContent = `-${this.formatTime(this.audioBuffer.duration)}`;
            }

            if (this.workletNode) this.workletNode.port.postMessage({ type: 'reset' });
            this.visualizer.stop();
            if (this.waveform) this.waveform.drawState(0);
        }
    }

    async togglePlay() {
        if (this.ctx && this.ctx.state === 'suspended') {
            await this.ctx.resume();
        }

        if (this.audio.paused) {
            this.play();
        } else {
            this.audio.pause();
            this.isPlaying = false;
            this.btnPlay.textContent = '▶';
        }
    }

    seek(time) {
        if (!this.audioBuffer) return;

        // Clamp
        if (time < 0) time = 0;
        if (time > this.audio.duration) time = this.audio.duration;

        this.audio.currentTime = time;
        this.timeCurrent.textContent = this.formatTime(time);

        // Update remaining time on seek
        const remaining = this.audio.duration - time;
        this.timeTotal.textContent = `-${this.formatTime(remaining)}`;

        this.waveform.drawState(time); // Instant visual update

        // If it was playing, it stays playing (AudioElement behavior)
        // If it was paused, it stays paused
    }

    updateTime() {
        if (this.audio.paused) return; // Stop loop if paused

        const pTime = this.audio.currentTime;
        const duration = this.audio.duration || 0;
        const remaining = Math.max(0, duration - pTime);

        this.timeCurrent.textContent = this.formatTime(pTime);
        this.timeTotal.textContent = `-${this.formatTime(remaining)}`;

        // Sync Visualizer Time
        this.visualizer.setPlaybackTime(pTime);

        // Update Waveform Cursor
        this.waveform.drawState(pTime);

        this.animateFrame = requestAnimationFrame(() => this.updateTime());
    }

    updateUI(data) {
        const { momentary, shortTerm, integrated, lra, truePeak } = data;

        if (momentary > -60) {
            this.led.classList.add('active');
        } else {
            this.led.classList.remove('active');
        }

        const fmt = (val) => val <= -100 ? '-oo' : val.toFixed(1);

        this.elMomentary.textContent = `${fmt(momentary)} LUFS`;
        this.elShortterm.textContent = `${fmt(shortTerm)} LUFS`;
        this.elIntegrated.textContent = `${fmt(integrated)} LUFS`;
        this.elLra.textContent = `${lra.toFixed(1)} LU`;
        this.elTruepeak.textContent = `${fmt(truePeak)} dBTP`;

        this.elMainDisplay.textContent = fmt(momentary);
    }

    formatTime(seconds) {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
}

window.addEventListener('DOMContentLoaded', () => {
    new AudioApp();
});
