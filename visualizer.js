// visualizer.js

export class PhysicsVisualizer {
    constructor() {
        this.physicsCanvas = document.getElementById('physics-canvas');
        this.radarCanvas = document.getElementById('radar-canvas');

        this.radarCtx = this.radarCanvas.getContext('2d');

        this.width = this.physicsCanvas.parentElement.clientWidth || window.innerWidth;
        this.height = this.physicsCanvas.parentElement.clientHeight || window.innerHeight;

        this.resize();
        window.addEventListener('resize', () => this.resize());

        this.initPhysics();

        this.history = [];
        this.maxHistoryItems = 1200;

        this.isRunning = false;

        this.currentData = { momentary: -100 };
        this.playbackTime = 0; // In Seconds
    }

    setPlaybackTime(seconds) {
        this.playbackTime = seconds;
    }

    resize() {
        this.width = this.physicsCanvas.parentElement.clientWidth;
        this.height = this.physicsCanvas.parentElement.clientHeight;

        this.physicsCanvas.width = this.width;
        this.physicsCanvas.height = this.height;

        this.radarCanvas.width = this.width;
        this.radarCanvas.height = this.height;

        if (this.render) {
            this.render.options.width = this.width;
            this.render.options.height = this.height;
        }

        if (this.engine) {
            Matter.World.clear(this.engine.world);
            Matter.Engine.clear(this.engine);
            this.initPhysics();
        }
    }

    initPhysics() {
        const Engine = Matter.Engine,
            Render = Matter.Render,
            World = Matter.World,
            Bodies = Matter.Bodies,
            Constraint = Matter.Constraint;

        if (!this.engine) {
            this.engine = Engine.create();
            this.engine.world.gravity.y = 0;
        }

        const cx = this.width / 2;
        const cy = this.height / 2;
        const minDim = Math.min(this.width, this.height);
        const radius = minDim * 0.45;

        const needleLen = radius * 0.95;
        const needleWidth = 3;

        this.particles = [];
        for (let i = 0; i < 25; i++) {
            const p = Bodies.circle(
                cx + (Math.random() - 0.5) * 100,
                cy + (Math.random() - 0.5) * 100,
                Math.random() * 15 + 5,
                {
                    frictionAir: 0.05,
                    restitution: 0.9,
                    render: {
                        fillStyle: '#FFB6C1',
                        strokeStyle: '#FF69B4',
                        lineWidth: 1
                    }
                }
            );
            this.particles.push(p);
        }

        this.needle = Bodies.rectangle(cx, cy, needleWidth, needleLen, {
            density: 0.04,
            frictionAir: 0.05,
            render: {
                fillStyle: '#1a1a1a',
                visible: true
            }
        });

        this.pivot = Constraint.create({
            pointA: { x: cx, y: cy },
            bodyB: this.needle,
            pointB: { x: 0, y: needleLen / 2 },
            stiffness: 1,
            length: 0,
            render: { visible: false }
        });

        World.add(this.engine.world, [this.needle, this.pivot, ...this.particles]);

        if (!this.render) {
            this.render = Render.create({
                canvas: this.physicsCanvas,
                engine: this.engine,
                options: {
                    width: this.width,
                    height: this.height,
                    wireframes: false,
                    background: 'transparent',
                    pixelRatio: window.devicePixelRatio,
                    hasBounds: false
                }
            });
        } else {
            this.render.engine = this.engine;
        }
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        Matter.Render.run(this.render);

        const runner = () => {
            if (!this.isRunning) return;
            Matter.Engine.update(this.engine, 1000 / 60);
            this.updatePhysicsFromAudio();
            this.drawRadar();
            requestAnimationFrame(runner);
        };
        runner();
    }

    stop() {
        this.isRunning = false;
        Matter.Render.stop(this.render);
    }

    reset() {
        this.history = [];
        this.playbackTime = 0;
        Matter.Body.setAngularVelocity(this.needle, 0);
        this.drawRadar();
    }

    update(data) {
        this.currentData = data;
        if (this.currentData.momentary > -100 && this.isRunning) {
            // Store current playback time with the value
            this.history.push({
                val: this.currentData.momentary,
                time: this.playbackTime
            });
            // Keep roughly 60 seconds of history (assuming 20fps updates, ~1200 items)
            if (this.history.length > 1200) this.history.shift();
        }
    }

    updatePhysicsFromAudio() {
        const lufs = Math.max(-60, Math.min(0, this.currentData.momentary));
        const norm = (lufs + 60) / 60;

        const startAngle = -Math.PI * 0.8;
        const endAngle = Math.PI * 0.2;

        const targetAngle = startAngle + (norm * (endAngle - startAngle));

        const currentAngle = this.needle.angle;
        let diff = targetAngle - currentAngle;
        Matter.Body.setAngularVelocity(this.needle, diff * 0.15);

        const energyForce = norm * 0.02;
        this.particles.forEach(p => {
            Matter.Body.applyForce(p, p.position, {
                x: (Math.random() - 0.5) * energyForce,
                y: (Math.random() - 0.5) * energyForce
            });

            const cx = this.width / 2;
            const cy = this.height / 2;
            const dx = cx - p.position.x;
            const dy = cy - p.position.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            const radius = Math.min(this.width, this.height) * 0.45;
            if (dist > radius) {
                Matter.Body.applyForce(p, p.position, {
                    x: dx * 0.0005,
                    y: dy * 0.0005
                });
            }
        });
    }

    drawRadar() {
        const ctx = this.radarCtx;
        const cx = this.width / 2;
        const cy = this.height / 2;
        const radius = Math.min(this.width, this.height) * 0.45;

        ctx.clearRect(0, 0, this.width, this.height);

        const duration = 60; // 60 Seconds per revolution
        const currentTime = this.playbackTime;

        ctx.save();
        ctx.translate(cx, cy);

        // --- Grid & Labels ---
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '10px Inter';
        ctx.fillStyle = '#000';

        const levels = [-48, -36, -24, -14, -6];

        ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillText("0", 0, -radius - 12);

        levels.forEach(lvl => {
            const r = ((lvl + 60) / 60) * radius;
            ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
            ctx.strokeStyle = (lvl === -14) ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.1)';
            ctx.lineWidth = (lvl === -14) ? 2 : 1;
            ctx.stroke();
            ctx.fillText(lvl, 0, -r - 5);
        });

        // --- History ---
        const segments = this.history;
        for (let i = 0; i < segments.length; i++) {
            const point = segments[i];

            // Angle based on Playback Time
            // 0s => -PI/2 (Top)
            // 15s => 0 (Right)
            // 30s => PI/2 (Bottom)
            // 45s => PI (Left)
            const angle = ((point.time % duration) / duration) * Math.PI * 2 - Math.PI / 2;

            const lufs = Math.max(-60, Math.min(0, point.val));
            const r = ((lufs + 60) / 60) * radius;

            ctx.beginPath();
            ctx.arc(0, 0, r, angle, angle + 0.03);

            if (point.val >= -14) {
                ctx.strokeStyle = '#FF1744';
            } else {
                ctx.strokeStyle = '#00C851';
            }
            ctx.lineWidth = 3;
            ctx.stroke();
        }

        // Head Line (Current Playback Position)
        const headAngle = ((currentTime % duration) / duration) * Math.PI * 2 - Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(headAngle) * radius, Math.sin(headAngle) * radius);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.restore();
    }
}
