// audio-worklet.js

class LufsProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.sampleRate = globalThis.sampleRate || 48000;

        // Ring Buffer Setup
        // Max history needed: Short-term window (3s)
        // 3s * 48000 = 144,000 samples.
        // Let's use a bit more for safety: 150,000
        this.bufferLength = 150000;
        this.buffer = new Float32Array(this.bufferLength);
        this.cursor = 0; // Points to the NEXT write position

        this.lastPostTime = 0;

        // Momentary: 400ms
        // Short-term: 3s
        this.samples400ms = Math.floor(this.sampleRate * 0.4);
        this.samples3s = Math.floor(this.sampleRate * 3.0);

        // Integrated State
        this.integratedSum = 0;
        this.integratedCount = 0;

        this.port.onmessage = (event) => {
            if (event.data.type === 'reset') {
                this.reset();
            }
        };
    }

    reset() {
        this.integratedSum = 0;
        this.integratedCount = 0;
        // Optional: clear buffer? 
        // For ring buffer, we don't strictly need to clear it, 
        // but resetting state is enough for "future" measurements.
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (!input || !input.length) return true;

        const channelData = input[0];
        const inputLen = channelData.length;

        // Write to Ring Buffer
        for (let i = 0; i < inputLen; i++) {
            this.buffer[this.cursor] = channelData[i];
            this.cursor++;
            if (this.cursor >= this.bufferLength) {
                this.cursor = 0;
            }
        }

        // Post data ~20 times per second
        const currentTime = globalThis.currentTime;
        if (currentTime - this.lastPostTime > 0.05) {
            this.calculateAndPost();
            this.lastPostTime = currentTime;
        }

        return true;
    }

    calculateAndPost() {
        // Calculate RMS for Momentary (400ms)
        const momLufs = this.calculateRms(this.samples400ms);

        // Calculate RMS for Short-term (3s)
        const shortLufs = this.calculateRms(this.samples3s);

        // Integrated (Simplified Accumulation)
        // Gate: Threshold -70 LUFS
        if (momLufs > -70) {
            // Add linear energy
            const energy = Math.pow(10, momLufs / 10);
            this.integratedSum += energy;
            this.integratedCount++;
        }

        let integratedLufs = -100;
        if (this.integratedCount > 0) {
            const avgEnergy = this.integratedSum / this.integratedCount;
            if (avgEnergy > 0) {
                integratedLufs = 10 * Math.log10(avgEnergy);
            }
        }

        // True Peak (Approximate from Momentary window)
        // Optimization: Calculating true peak over 400ms involves iterating 19200 samples. 
        // We'll do it inside calculateRms loop if possible, but separating concerns is cleaner.
        // Let's do a separate loop for Peak on the small window (400ms)
        const truePeak = this.calculatePeak(this.samples400ms);

        // LRA (Approximation)
        const lra = Math.abs(momLufs - shortLufs);

        this.port.postMessage({
            momentary: momLufs,
            shortTerm: shortLufs,
            integrated: integratedLufs,
            lra: lra,
            truePeak: truePeak
        });
    }

    // Helper to calculate LUFS (dBFS) from Ring Buffer
    // 'windowSize' is number of samples to look back
    calculateRms(windowSize) {
        let sum = 0;
        let count = 0;

        // Start reading backwards from current cursor
        let readIndex = this.cursor - 1;
        if (readIndex < 0) readIndex = this.bufferLength - 1;

        // We need to check if we actually have enough data filled. 
        // For simplicity, we assume buffer is zero-init, so it's safe to read.

        for (let i = 0; i < windowSize; i++) {
            const val = this.buffer[readIndex];
            sum += val * val;

            readIndex--;
            if (readIndex < 0) readIndex = this.bufferLength - 1;
            count++;
        }

        if (count === 0) return -100;

        const rms = Math.sqrt(sum / count);
        if (rms <= 0.00000001) return -100; // avoid log(0)

        return 20 * Math.log10(rms);
    }

    calculatePeak(windowSize) {
        let max = 0;
        let readIndex = this.cursor - 1;
        if (readIndex < 0) readIndex = this.bufferLength - 1;

        for (let i = 0; i < windowSize; i++) {
            const val = Math.abs(this.buffer[readIndex]);
            if (val > max) max = val;

            readIndex--;
            if (readIndex < 0) readIndex = this.bufferLength - 1;
        }

        if (max <= 0.00000001) return -100;
        return 20 * Math.log10(max);
    }
}

registerProcessor('lufs-processor', LufsProcessor);
