// app.js - ИСПРАВЛЕННАЯ ВЕРСИЯ ДЛЯ ВАШЕЙ СТРУКТУРЫ
import * as THREE from 'three';
import { World } from './world.js';
import { Player } from './player.js';
import { Sky } from './sky.js';
import { SoundManager } from './sound.js';
import { BLOCKS } from './constants.js';

class Application {
    constructor() {
        this.dayTime = 0;
        this.dayDuration = 300;

        this.clock = new THREE.Clock();
        this.isPaused = true;

        // ИНИЦИАЛИЗАЦИЯ UI С ПРОВЕРКОЙ
        this.ui = {
            fps: document.getElementById('fps-counter'),
            chunks: document.getElementById('chunk-count'),
            coords: document.getElementById('coords'),
            block: document.getElementById('block-name'),
            menu: document.getElementById('menu-overlay'),
            startBtn: document.getElementById('start-btn'),
            status: document.getElementById('status-text'),
            crosshair: document.getElementById('crosshair'),
            hotbar: document.getElementById('hotbar')
        };

        this.frames = 0;
        this.lastTime = 0;

        this.initRenderer();
        this.initScene();
        this.soundManager = new SoundManager(this.camera);
        this.initWorld();
        this.setupEvents();
        this.animate();
    }

    initRenderer() {
        // АНТИАЛИАСИНГ ВКЛЮЧЕН С GREEDY MESHING
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            powerPreference: "high-performance"
        });

        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.NoToneMapping;
        document.body.appendChild(this.renderer.domElement);
    }

    initScene() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87CEEB);
        this.scene.fog = new THREE.Fog(0x87CEEB, 50, 200);

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

        // ОПТИМИЗИРОВАННЫЕ НАСТРОЙКИ ОСВЕЩЕНИЯ
        this.sun = new THREE.DirectionalLight(0xffffff, 1.5);
        this.sun.castShadow = true;
        this.sun.shadow.mapSize.width = 2048;
        this.sun.shadow.mapSize.height = 2048;
        this.sun.shadow.camera.near = 0.1;
        this.sun.shadow.camera.far = 200;

        const shadowDistance = 60;
        this.sun.shadow.camera.left = -shadowDistance;
        this.sun.shadow.camera.right = shadowDistance;
        this.sun.shadow.camera.top = shadowDistance;
        this.sun.shadow.camera.bottom = -shadowDistance;

        // КРИТИЧЕСКИЕ НАСТРОЙКИ ДЛЯ УСТРАНЕНИЯ АРТЕФАКТОВ
        this.sun.shadow.bias = -0.0001;
        this.sun.shadow.normalBias = 0.02;

        this.scene.add(this.sun);
        this.scene.add(this.sun.target);

        this.moonLight = new THREE.DirectionalLight(0x445566, 0.2);
        this.scene.add(this.moonLight);

        this.ambient = new THREE.AmbientLight(0xffffff, 0.05);
        this.scene.add(this.ambient);

        this.sky = new Sky(this.scene);
    }

    initWorld() {
        this.world = new World(this.scene);
        this.player = new Player(this.camera, this.renderer.domElement, this.world, this.soundManager);
        this.world.update(this.player.position);
    }

    setupEvents() {
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });

        // ОБРАБОТКА КНОПКИ START С ПРОВЕРКОЙ
        if (this.ui.startBtn) {
            this.ui.startBtn.addEventListener('click', () => {
                this.renderer.domElement.requestPointerLock();
            });
        }

        document.addEventListener('pointerlockchange', () => {
            if (document.pointerLockElement === this.renderer.domElement) {
                this.isPaused = false;
                if (this.ui.menu) this.ui.menu.style.display = 'none';
                if (this.ui.status) this.ui.status.textContent = '';
                if (this.ui.crosshair) this.ui.crosshair.style.display = 'block';
            } else {
                this.isPaused = true;
                if (this.ui.menu) this.ui.menu.style.display = 'flex';
                if (this.ui.status) this.ui.status.textContent = 'PAUSED';
                if (this.ui.crosshair) this.ui.crosshair.style.display = 'none';
            }
        });

        // КЛАВИША ESC ДЛЯ ВЫХОДА
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && document.pointerLockElement) {
                document.exitPointerLock();
            }
        });
    }

    updateEnvironment(dt) {
        this.dayTime += dt;
        if (this.dayTime > this.dayDuration) this.dayTime = 0;

        const theta = (this.dayTime / this.dayDuration) * Math.PI * 2;
        const sunHeight = Math.sin(theta);
        const sunDist = 100;

        const sunX = Math.cos(theta) * sunDist;
        const sunY = Math.sin(theta) * sunDist;
        const sunZ = Math.sin(theta * 0.5) * 20;

        const moonX = -sunX;
        const moonY = -sunY;
        const moonZ = -sunZ;

        this.sky.updateSunMoon(new THREE.Vector3(sunX, sunY, sunZ), new THREE.Vector3(moonX, moonY, moonZ));

        this.sun.position.set(
            this.player.position.x + sunX,
            this.player.position.y + sunY,
            this.player.position.z + sunZ
        );
        this.sun.target.position.copy(this.player.position);
        this.sun.target.updateMatrixWorld();

        this.sun.intensity = Math.max(0, sunHeight) * 1.5;
        this.moonLight.position.set(this.player.position.x + moonX, this.player.position.y + moonY, this.player.position.z + moonZ);
        this.moonLight.intensity = Math.max(0, -sunHeight) * 0.2;

        this.ambient.intensity = 0.05 + Math.max(0, sunHeight) * 0.4;

        const colorNight = new THREE.Color(0x050510);
        const colorSunset = new THREE.Color(0xFD5E53);
        const colorDay = new THREE.Color(0x87CEEB);

        let targetColor = new THREE.Color();

        if (sunHeight < -0.2) {
            targetColor.copy(colorNight);
        } else if (sunHeight < 0.2) {
            const t = (sunHeight + 0.2) / 0.4;
            if (t < 0.5) {
                targetColor.lerpColors(colorNight, colorSunset, t * 2.0);
            } else {
                targetColor.lerpColors(colorSunset, colorDay, (t - 0.5) * 2.0);
            }
        } else {
            targetColor.copy(colorDay);
        }

        this.scene.fog.color.copy(targetColor);
        if (this.scene.background) this.scene.background.copy(targetColor);
    }

    updateUI() {
        this.frames++;
        const time = performance.now();
        if (time >= this.lastTime + 1000) {
            if (this.ui.fps) this.ui.fps.textContent = this.frames;
            this.frames = 0;
            this.lastTime = time;
        }

        if (this.ui.coords && this.player) {
            const x = Math.floor(this.player.position.x);
            const y = Math.floor(this.player.position.y);
            const z = Math.floor(this.player.position.z);
            this.ui.coords.textContent = `${x}, ${y}, ${z}`;
        }

        if (this.ui.chunks && this.world.chunks) {
            const count = this.world.chunks.size || 0;
            this.ui.chunks.textContent = count;
        }

        if (this.ui.block && this.player && this.player.selectedBlock) {
            let blockName = "Unknown";
            for (const [key, val] of Object.entries(BLOCKS)) {
                if (val.id === this.player.selectedBlock) {
                    blockName = key;
                    break;
                }
            }
            this.ui.block.textContent = blockName;
        }
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        const dt = Math.min(this.clock.getDelta(), 0.1);

        if (!this.isPaused) {
            this.player.update(dt);
            this.world.update(this.player.position);
            this.updateEnvironment(dt);
            if (this.sky) this.sky.update(this.player.position, this.clock.elapsedTime);
            this.updateUI();
        }

        this.renderer.render(this.scene, this.camera);
    }
}

// ЗАГРУЗКА С ОБРАБОТКОЙ ОШИБОК
window.onload = () => {
    try {
        const app = new Application();
        console.log('Voxel Engine started successfully');
    } catch (error) {
        console.error('Failed to start Voxel Engine:', error);
    }
};