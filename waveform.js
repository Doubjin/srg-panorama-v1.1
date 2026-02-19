export class WaveformDisplay {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.width = this.canvas.clientWidth;
        this.height = this.canvas.clientHeight;

        // Handle High DPI
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = this.width * dpr;
        this.canvas.height = this.height * dpr;
        this.ctx.scale(dpr, dpr);

        this.peaks = null;
        this.duration = 0;
        this.lastTime = 0;

        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        this.width = this.canvas.parentElement.clientWidth;
        this.height = this.canvas.parentElement.clientHeight;

        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = this.width * dpr;
        this.canvas.height = this.height * dpr;
        this.ctx.scale(dpr, dpr);

        if (this.peaks) this.drawState(this.lastTime);
    }

    // Pre-calculate peaks for the entire file to avoid re-processing every frame
    loadAudio(audioBuffer) {
        this.duration = audioBuffer.duration;
        const channelData = audioBuffer.getChannelData(0); // Use Ch1
        const sampleRate = audioBuffer.sampleRate;
        const totalSamples = channelData.length;

        // We want roughly 1 peak per pixel width? 
        // Or slightly more detail. Let's aim for width * 2
        this.peaks = [];
        const step = Math.ceil(totalSamples / (this.width * 2));
        const amp = this.height / 2;

        for (let i = 0; i < this.width * 2; i++) {
            const start = i * step;
            let min = 1.0;
            let max = -1.0;

            for (let j = 0; j < step; j++) {
                const idx = start + j;
                if (idx < totalSamples) {
                    const val = channelData[idx];
                    if (val < min) min = val;
                    if (val > max) max = val;
                }
            }
            if (min > max) { min = 0; max = 0; } // silence
            this.peaks.push([min, max]);
        }

        this.drawState(0);
    }

    drawState(currentTime) {
        this.lastTime = currentTime;
        this.ctx.clearRect(0, 0, this.width, this.height);

        if (!this.peaks) return;

        // Draw Waveform
        this.ctx.fillStyle = '#00E5CC'; // TC Mint
        this.ctx.beginPath();

        const barWidth = this.width / this.peaks.length;
        const centerY = this.height / 2;

        // Optimization: Paint paths?
        // Let's use simple rects or lines
        this.ctx.lineWidth = 1;
        this.ctx.strokeStyle = '#00E5CC';
        this.ctx.beginPath();

        for (let i = 0; i < this.peaks.length; i++) {
            const x = (i / this.peaks.length) * this.width;
            const [min, max] = this.peaks[i];

            // Draw vertical line from min to max amplitude
            // Scale amplitude to height (0..1 -> 0..height/2)
            const yMin = centerY - (max * centerY);
            const yMax = centerY - (min * centerY);

            this.ctx.moveTo(x, yMin);
            this.ctx.lineTo(x, yMax);
        }
        this.ctx.stroke();

        // Draw Cursor / Playhead
        if (this.duration > 0) {
            const x = (currentTime / this.duration) * this.width;

            // Draw "Played" region in darker overlay?
            this.ctx.fillStyle = 'rgba(0, 229, 204, 0.2)';
            this.ctx.fillRect(0, 0, x, this.height);

            // Playhead Line
            this.ctx.strokeStyle = '#FFF';
            this.ctx.lineWidth = 1;
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, this.height);
            this.ctx.stroke();
        }
    }

    getClickedTime(mouseX) {
        const rect = this.canvas.getBoundingClientRect();
        const x = mouseX - rect.left;
        const percent = x / rect.width;
        return Math.max(0, Math.min(1, percent)) * this.duration;
    }
}
