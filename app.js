import { PhysicsVisualizer } from './visualizer.js';
import { WaveformDisplay } from './waveform.js';

class AudioApp {
    constructor() {
        this.ctx = null;
        this.audioBuffer = null;
        this.sourceNode = null;
        this.workletNode = null;
        this.workletNode = null;

        // Playback State
        this.isPlaying = false;
        this.startTime = 0;
        this.pauseTime = 0;
        this.isLooping = false;

        // UI Elements
        this.dropZone = document.getElementById('drop-zone');
        this.fileInput = document.getElementById('file-input');

        this.playerControls = document.getElementById('player-controls');
        this.btnPlay = document.getElementById('btn-play');
        this.btnStop = document.getElementById('btn-stop');
        this.btnLoop = document.getElementById('btn-loop');

        this.timeCurrent = document.getElementById('time-current');
        this.timeTotal = document.getElementById('time-total');
        // this.seekBar = document.getElementById('seek-bar'); // Removed

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
        this.btnLoop.addEventListener('click', () => {
            this.isLooping = !this.isLooping;
            this.btnLoop.classList.toggle('active');
            if (this.sourceNode) this.sourceNode.loop = this.isLooping;
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
                // maybe debounced seek? or just update UI cursor?
                // For now let's just seek on click/drag
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
        }
        if (this.ctx.state === 'suspended') {
            await this.ctx.resume();
        }
    }

    async handleFile(file) {
        // Relaxed type check: Allow audio/* OR if type is empty (unknown)
        // verify extension as fallback
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
            await this.initAudioContext();

            const arrayBuffer = await file.arrayBuffer();
            this.audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);

            // Ready UI
            this.dropZone.querySelector('.drop-text').textContent = file.name;
            this.playerControls.classList.remove('disabled');
            this.timeTotal.textContent = this.formatTime(this.audioBuffer.duration);

            // Draw Waveform
            this.waveform.loadAudio(this.audioBuffer);

            // Start playback immediately
            this.play();
        } catch (err) {
            console.error(err);
            alert('Error decoding audio file.');
            this.dropZone.querySelector('.drop-text').textContent = 'Error loading file.';
        }
    }

    play(offset = 0) {
        if (!this.audioBuffer) return;

        if (this.sourceNode) this.sourceNode.stop();

        this.sourceNode = this.ctx.createBufferSource();
        this.sourceNode.buffer = this.audioBuffer;
        this.sourceNode.loop = this.isLooping;

        this.sourceNode.connect(this.ctx.destination);
        this.sourceNode.connect(this.workletNode);

        this.sourceNode.start(0, offset);

        this.startTime = this.ctx.currentTime - offset;
        this.pauseTime = offset;
        this.isPlaying = true;
        this.btnPlay.textContent = 'II';

        this.visualizer.start();
        this.animateFrame = requestAnimationFrame(() => this.updateTime());

        this.sourceNode.onended = () => {
            if (this.isPlaying && !this.isLooping && (this.ctx.currentTime - this.startTime >= this.audioBuffer.duration)) {
                this.stop(false);
            }
        };
    }

    stop(reset = true) {
        if (this.sourceNode) {
            try { this.sourceNode.stop(); } catch (e) { }
            this.sourceNode = null;
        }
        this.isPlaying = false;
        this.btnPlay.textContent = '▶';
        cancelAnimationFrame(this.animateFrame);
        this.led.classList.remove('active');

        if (reset) {
            this.pauseTime = 0;
            this.timeCurrent.textContent = "00:00";
            if (this.workletNode) this.workletNode.port.postMessage({ type: 'reset' });
            this.visualizer.stop();
            if (this.waveform) this.waveform.drawState(0);
        }
    }

    async togglePlay() {
        if (this.ctx && this.ctx.state === 'suspended') {
            await this.ctx.resume();
        }

        if (this.isPlaying) {
            this.stop(false);
            this.pauseTime = this.ctx.currentTime - this.startTime;
        } else {
            if (this.pauseTime >= this.audioBuffer.duration) this.pauseTime = 0;
            this.play(this.pauseTime);
        }
    }

    seek(time) {
        const wasPlaying = this.isPlaying;
        if (this.isPlaying) this.stop(false);
        this.pauseTime = time;
        // Clamp
        if (this.pauseTime < 0) this.pauseTime = 0;
        if (this.audioBuffer && this.pauseTime > this.audioBuffer.duration) this.pauseTime = this.audioBuffer.duration;

        this.timeCurrent.textContent = this.formatTime(this.pauseTime);
        this.waveform.drawState(this.pauseTime); // Instant visual update

        if (wasPlaying) {
            this.play(this.pauseTime);
        }
    }

    updateTime() {
        if (!this.isPlaying || !this.audioBuffer) return;

        const now = this.ctx.currentTime;
        let pTime = now - this.startTime;

        if (this.isLooping && pTime > this.audioBuffer.duration) {
            pTime = pTime % this.audioBuffer.duration;
        } else if (pTime > this.audioBuffer.duration) {
            pTime = this.audioBuffer.duration;
        }

        this.timeCurrent.textContent = this.formatTime(pTime);

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
