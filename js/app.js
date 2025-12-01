import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { World } from './world.js';
import { Player } from './player.js';
import { WORLD_CONFIG, BLOCKS } from './constants.js';
import { SoundManager } from './sound.js';
import { SettingsManager } from './settings.js';
import { Sky } from './sky.js';
import { Inventory } from './inventory.js';

class Application {
    constructor() {
        // Объявляем переменные ДО инициализации сцены
        this.skyColor = new THREE.Color(0x87CEEB); // Голубое небо
        this.caveColor = new THREE.Color(0x050505); // Почти черный для пещер
        this.tempColor = new THREE.Color();
        this.clock = new THREE.Clock();
        this.isPaused = true;
        this.lastFrameTime = 0;
        this.frameCount = 0;
        this.fpsUpdateInterval = 0.5; // Обновляем FPS каждые 0.5 секунды
        this.fpsUpdateTimer = 0;

        // UI State Machine: null (game), 'pause', 'settings', 'inventory'
        this.uiState = null; // Состояние выставляем через setUIState
        this.hudVisible = true;

        // Система дня и ночи
        this.dayTime = 0.5; // Начинаем с полдня
        this.baseDaySpeed = 0.0001; // Базовая скорость смены дня и ночи
        
        // Константы для системы дня/ночи
        this.SUN_RADIUS = 300; 
        this.SUN_BASE_HEIGHT = 100; 
        this.MOON_RADIUS_MULTIPLIER = 0.8; 
        this.MOON_Z_OFFSET = 0.3; 

        this.settings = new SettingsManager();
        this.keybindCapture = null;
        this.keybindButtons = new Map();
        this.keybindCaptureHandler = null;
        this.pmremGenerator = null;
        this.environmentTexture = null;
        this.composer = null;
        this.renderPass = null;
        this.fxaaPass = null;
        this.postProcessingEnabled = false;
        this.shadowSnapSize = 4;
        
        // Константы для теней
        this.SHADOW_MAP_SIZES = [512, 1024, 2048, 4096];

        // Теперь можно инициализировать системы
        this.initRenderer();
        this.initScene();
        this.initWorld();
        this.initUI();

        this.setupEvents();

        this.setHUDVisibility(true);
        
        // Устанавливаем начальное состояние UI
        this.setUIState('pause');
        
        // Глобальный доступ для inventory.js
        window.app = this;
        
        this.animate();
    }

    // --- UI STATE MANAGEMENT ---
    
    setUIState(newState) {
        // Если состояние не изменилось, ничего не делаем
        if (this.uiState === newState) {
            this.updateHUDStatus(newState);
            return;
        }

        console.log(`[UI] Transition: ${this.uiState} -> ${newState}`);
        
        // 1. Очистка текущего состояния (закрытие меню)
        const menuOverlay = document.getElementById('menu-overlay');
        const settingsOverlay = document.getElementById('settings-overlay');
        const inventoryOverlay = document.getElementById('inventory-overlay');
        const body = document.body;

        if (body) {
            body.classList.remove('inventory-active');
        }

        if (menuOverlay) menuOverlay.style.display = 'none';
        if (settingsOverlay) settingsOverlay.classList.remove('active');
        if (inventoryOverlay) inventoryOverlay.classList.remove('active');
        if (inventoryOverlay) inventoryOverlay.style.display = 'none';
        
        if (this.inventory) {
            this.inventory.isOpen = false;
        }

        // 2. Установка нового состояния
        this.uiState = newState;
        this.isPaused = (newState !== null);

        // 3. Применение нового состояния (открытие меню и управление курсором)
        switch (newState) {
            case null: // ИГРА
                // Пытаемся захватить курсор
                this.renderer.domElement.requestPointerLock();
                setTimeout(() => this.syncCursorState(), 0);
                break;
                
            case 'pause': // ПАУЗА
                if (menuOverlay) menuOverlay.style.display = 'flex';
                this.releasePointerLock();
                break;
                
            case 'settings': // НАСТРОЙКИ
                if (settingsOverlay) settingsOverlay.classList.add('active');
                this.updateSettingsUI();
                this.releasePointerLock();
                break;
                
            case 'inventory': // ИНВЕНТАРЬ
                if (body) {
                    body.classList.add('inventory-active');
                }
                if (this.inventory) {
                    this.inventory.isOpen = true;
                    if (inventoryOverlay) {
                        inventoryOverlay.classList.add('active');
                        inventoryOverlay.style.display = 'flex';
                    }
                    
                    // Синхронизируем выбранный блок
                    if (this.player) {
                        const currentBlockId = this.player.hotbar[this.player.selectedSlot] || 1;
                        this.inventory.selectedBlock = currentBlockId;
                    }
                }
                this.releasePointerLock();
                break;
        }

        this.updateHUDStatus(newState);
        this.syncCursorState();
    }

    updateHUDStatus(state) {
        const statusEl = document.getElementById('status-text');
        if (!statusEl) return;

        const map = {
            pause: { label: 'ПАУЗА', state: 'pause' },
            settings: { label: 'НАСТРОЙКИ', state: 'settings' },
            inventory: { label: 'ИНВЕНТАРЬ', state: 'inventory' },
            game: { label: 'В ИГРЕ', state: 'game' }
        };

        const key = state === null ? 'game' : state;
        const config = map[key] || map.game;
        statusEl.textContent = config.label;
        statusEl.dataset.state = config.state;
    }

    setHUDVisibility(isVisible = true) {
        this.hudVisible = isVisible;
        const body = document.body;
        if (!body) return;
        body.classList.toggle('hud-hidden', !isVisible);
        this.syncCursorState();
    }

    toggleHUDVisibility() {
        this.setHUDVisibility(!this.hudVisible);
    }

    syncCursorState() {
        const body = document.body;
        if (!body) return;
        const pointerLocked = document.pointerLockElement === this.renderer?.domElement;
        const shouldHideCursor = this.uiState === null && pointerLocked;
        body.classList.toggle('cursor-hidden', shouldHideCursor);
        body.classList.toggle('cursor-visible', !shouldHideCursor);
        if (this.renderer && this.renderer.domElement) {
            this.renderer.domElement.style.cursor = shouldHideCursor ? 'none' : 'default';
        }
    }

    releasePointerLock() {
        const isLocked = document.pointerLockElement === this.renderer?.domElement;
        if (isLocked) {
            document.exitPointerLock();
            setTimeout(() => this.syncCursorState(), 0);
        } else {
            this.syncCursorState();
        }
    }

    initRenderer() {
        const antialias = this.settings.get('antialiasing');
        this.renderer = new THREE.WebGLRenderer({ 
            antialias: antialias, 
            powerPreference: "high-performance",
            stencil: false,
            depth: true
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.settings.get('pixelRatio')));
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = this.settings.get('toneMappingExposure');
        this.renderer.physicallyCorrectLights = true;
        this.renderer.shadowMap.enabled = this.settings.get('shadows');
        this.renderer.shadowMap.type = this.settings.get('softShadows') ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
        this.renderer.shadowMap.autoUpdate = true;
        document.body.appendChild(this.renderer.domElement);
        this.settings.applyToRenderer(this.renderer);

        this.pmremGenerator = new THREE.PMREMGenerator(this.renderer);
        const roomEnvironment = new RoomEnvironment();
        this.environmentTexture = this.pmremGenerator.fromScene(roomEnvironment, 0.04).texture;
        if (roomEnvironment.dispose) roomEnvironment.dispose();
    }

    initScene() {
        this.scene = new THREE.Scene();
        this.scene.background = this.skyColor.clone();
        if (this.environmentTexture) {
            this.scene.environment = this.environmentTexture;
        }

        const fogDist = this.settings.get('renderDistance') * WORLD_CONFIG.CHUNK_SIZE;
        if (this.settings.get('fogEnabled')) {
            this.scene.fog = new THREE.Fog(this.skyColor, 20, fogDist - 10);
        }

        this.camera = new THREE.PerspectiveCamera(
            this.settings.get('fov'), 
            window.innerWidth / window.innerHeight, 
            0.1, 
            2000 
        );
        this.settings.applyToCamera(this.camera);

        // 1. AMBIENT LIGHT
        this.ambient = new THREE.AmbientLight(0xffffff, 0.1);
        this.scene.add(this.ambient);

        // 2. HEMISPHERE LIGHT
        this.hemiLight = new THREE.HemisphereLight(0x87CEEB, 0x444444, 0.2);
        this.scene.add(this.hemiLight);

        // 3. SUN LIGHT
        this.sun = new THREE.DirectionalLight(0xffffff, 1.5);
        this.sun.position.set(50, 100, 50);
        this.sun.castShadow = true;

        const shadowQuality = this.settings.get('shadowQuality');
        const shadowMapSize = this.SHADOW_MAP_SIZES[Math.min(shadowQuality, this.SHADOW_MAP_SIZES.length - 1)] || 2048;
        
        const d = 100; 
        this.sun.shadow.camera.left = -d;
        this.sun.shadow.camera.right = d;
        this.sun.shadow.camera.top = d;
        this.sun.shadow.camera.bottom = -d;
        this.sun.shadow.camera.near = 0.1;
        this.sun.shadow.camera.far = 500;

        this.sun.shadow.mapSize.width = shadowMapSize;
        this.sun.shadow.mapSize.height = shadowMapSize;
        this.sun.shadow.bias = -0.0001;
        this.sun.shadow.normalBias = 0.005;

        this.scene.add(this.sun);
        this.scene.add(this.sun.target);
        this.shadowCameraPosition = new THREE.Vector3(0, 0, 0);
        this.updateShadowRig();

        this.soundManager = new SoundManager(this.camera);
        this.settings.applyToSound(this.soundManager);

        this.initPostProcessing();
    }

    initWorld() {
        this.world = new World(this.scene);
        this.player = new Player(
            this.camera, 
            this.renderer.domElement, 
            this.world, 
            this.soundManager,
            this.settings
        );
        
        this.settings.applyToWorld(this.world);
        
        if (this.world.material && this.world.material.map) {
            this.sky = new Sky(this.scene, this.world.material.map);
            this.sky.dayTime = this.dayTime;
            
            this.inventory = new Inventory(this.scene, this.world.material.map, this.player);
            
            setTimeout(() => {
                this.updateHotbarWithIcons();
            }, 100);
        }
        
        this.world.update(this.player.position);
    }
    
    updateHotbarWithIcons() {
        if (!this.inventory || !this.player) return;
        
        const hotbar = document.getElementById('hotbar');
        if (!hotbar) return;
        
        hotbar.innerHTML = '';
        this.player.hotbar.forEach((blockId, i) => {
            const slot = document.createElement('div');
            slot.className = `slot ${i === this.player.selectedSlot ? 'active' : ''}`;
            slot.dataset.type = 'hotbar';
            slot.dataset.index = i;
            if (blockId) slot.dataset.blockId = blockId;
            else delete slot.dataset.blockId;
            
            const slotNumber = document.createElement('span');
            slotNumber.className = 'slot-number';
            slotNumber.textContent = i + 1;
            slot.appendChild(slotNumber);
            
            const iconSrc = this.inventory.getBlockIcon(blockId);
            if (iconSrc) {
                const icon = document.createElement('img');
                icon.className = 'slot-icon';
                icon.src = iconSrc;
                icon.alt = BLOCKS[blockId] ? BLOCKS[blockId].name : 'Unknown';
                slot.appendChild(icon);
            }
            
            hotbar.appendChild(slot);

            if (this.inventory) {
                this.inventory.attachDragListeners(slot);
            }
        });
    }

    initUI() {
        this.updateSettingsUI();
        this.setupSettingsHandlers();
        this.setupKeybindUI();
        this.refreshKeybindButtons();
    }

    setupSettingsHandlers() {
        document.getElementById('setting-antialiasing').addEventListener('change', (e) => {
            this.settings.set('antialiasing', e.target.checked);
            this.applySettings();
        });
        document.getElementById('setting-shadows').addEventListener('change', (e) => {
            this.settings.set('shadows', e.target.checked);
            this.applySettings();
        });
        document.getElementById('setting-soft-shadows').addEventListener('change', (e) => {
            this.settings.set('softShadows', e.target.checked);
            this.applySettings();
        });
        document.getElementById('setting-fog').addEventListener('change', (e) => {
            this.settings.set('fogEnabled', e.target.checked);
            this.applySettings();
        });
        document.getElementById('setting-vsync').addEventListener('change', (e) => {
            this.settings.set('vsync', e.target.checked);
        });
        document.getElementById('setting-sound-enabled').addEventListener('change', (e) => {
            this.settings.set('soundEnabled', e.target.checked);
            this.soundManager.setEnabled(e.target.checked);
        });
        document.getElementById('setting-bobbing').addEventListener('change', (e) => {
            this.settings.set('bobbing', e.target.checked);
            if (this.player) {
                this.player.bobbingEnabled = e.target.checked;
            }
        });
        document.getElementById('setting-shadow-quality').addEventListener('change', (e) => {
            this.settings.set('shadowQuality', parseInt(e.target.value));
            this.applySettings();
        });

        document.getElementById('settings-apply-btn').addEventListener('click', () => {
            this.applySettings();
            this.setUIState('pause'); 
        });

        document.getElementById('settings-reset-btn').addEventListener('click', () => {
            if (confirm('Сбросить все настройки?')) {
                this.settings = new SettingsManager();
                this.updateSettingsUI();
                this.applySettings();
                this.refreshBindings();
            }
        });
    }

    setupSlider(sliderId, settingKey, valueId, formatter) {
        const slider = document.getElementById(sliderId);
        const valueDisplay = document.getElementById(valueId);
        if (!slider || !valueDisplay) return;

        const currentValue = this.settings.get(settingKey);
        slider.value = currentValue;
        valueDisplay.textContent = formatter(currentValue);

        slider.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            this.settings.set(settingKey, value);
            valueDisplay.textContent = formatter(value);
            
            if (['masterVolume', 'soundEffectsVolume', 'musicVolume'].includes(settingKey)) {
                this.settings.applyToSound(this.soundManager);
            } else if (settingKey === 'fov') {
                this.settings.applyToCamera(this.camera);
            } else if (settingKey === 'pixelRatio') {
                this.settings.applyToRenderer(this.renderer);
                this.updateFXAASize();
            } else if (settingKey === 'mouseSensitivity' && this.player) {
                this.player.mouseSensitivity = value;
            } else if (settingKey === 'chunkLoadSpeed' && this.world) {
                this.world.chunkLoadSpeed = value;
            } else if (settingKey === 'cloudCoverage') {
                console.log('[Settings] Cloud coverage changed to:', value.toFixed(2));
            } else if (settingKey === 'renderDistance') {
                if (this.world && this.world.config) {
                    this.world.config.RENDER_DISTANCE = value;
                }
                if (this.scene && this.scene.fog) {
                    const fogDist = value * WORLD_CONFIG.CHUNK_SIZE;
                    this.scene.fog.far = fogDist - 10;
                }
            } else if (settingKey === 'toneMappingExposure') {
                this.renderer.toneMappingExposure = value;
            } else if (settingKey === 'sunIntensity') {
                if (this.sun) this.sun.intensity = value;
            } else if (settingKey === 'ambientIntensity') {
                if (this.ambient) this.ambient.intensity = value;
                if (this.hemiLight) this.hemiLight.intensity = value * 0.6;
                if (this.world && typeof this.world.setAOIntensity === 'function') {
                    this.world.setAOIntensity(value);
                }
            } else if (settingKey === 'shadowDistance') {
                this.updateShadowRig();
            }
        });
    }

    initPostProcessing() {
        if (!this.renderer || !this.scene || !this.camera) return;
        this.composer = new EffectComposer(this.renderer);
        this.renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(this.renderPass);
        this.fxaaPass = new ShaderPass(FXAAShader);
        this.updateFXAASize();
        this.composer.addPass(this.fxaaPass);
        this.postProcessingEnabled = true;
    }

    updateFXAASize() {
        if (!this.fxaaPass || !this.renderer) return;
        const pixelRatio = this.renderer.getPixelRatio();
        this.fxaaPass.material.uniforms['resolution'].value.set(
            1 / (window.innerWidth * pixelRatio),
            1 / (window.innerHeight * pixelRatio)
        );
    }

    updateShadowRig() {
        if (!this.sun || !this.sun.shadow) return;
        const shadowRange = this.settings.get('shadowDistance') || 140;
        this.sun.shadow.camera.left = -shadowRange;
        this.sun.shadow.camera.right = shadowRange;
        this.sun.shadow.camera.top = shadowRange;
        this.sun.shadow.camera.bottom = -shadowRange;
        this.sun.shadow.camera.near = 0.5;
        this.sun.shadow.camera.far = shadowRange * 3;
        this.sun.shadow.radius = this.settings.get('softShadows') ? 2.5 : 0.5;
        this.sun.shadow.bias = -0.00008;
        this.sun.shadow.normalBias = 0.02;
        this.sun.shadow.camera.updateProjectionMatrix();
    }

    updateSettingsUI() {
        document.getElementById('setting-antialiasing').checked = this.settings.get('antialiasing');
        document.getElementById('setting-shadows').checked = this.settings.get('shadows');
        document.getElementById('setting-fog').checked = this.settings.get('fogEnabled');
        document.getElementById('setting-vsync').checked = this.settings.get('vsync');
        document.getElementById('setting-sound-enabled').checked = this.settings.get('soundEnabled');
        document.getElementById('setting-bobbing').checked = this.settings.get('bobbing');
        document.getElementById('setting-shadow-quality').value = this.settings.get('shadowQuality');
        document.getElementById('setting-soft-shadows').checked = this.settings.get('softShadows');
        
        this.setupSlider('setting-render-distance', 'renderDistance', 'render-distance-value', (v) => Math.round(v));
        this.setupSlider('setting-pixel-ratio', 'pixelRatio', 'pixel-ratio-value', (v) => v);
        this.setupSlider('setting-master-volume', 'masterVolume', 'master-volume-value', (v) => Math.round(v * 100));
        this.setupSlider('setting-sfx-volume', 'soundEffectsVolume', 'sfx-volume-value', (v) => Math.round(v * 100));
        this.setupSlider('setting-music-volume', 'musicVolume', 'music-volume-value', (v) => Math.round(v * 100));
        this.setupSlider('setting-mouse-sensitivity', 'mouseSensitivity', 'mouse-sensitivity-value', (v) => v.toFixed(1));
        this.setupSlider('setting-fov', 'fov', 'fov-value', (v) => Math.round(v));
        this.setupSlider('setting-time-speed', 'timeSpeed', 'time-speed-value', (v) => v.toFixed(2));
        this.setupSlider('setting-max-fps', 'maxFPS', 'max-fps-value', (v) => v || '∞');
        this.setupSlider('setting-chunk-load-speed', 'chunkLoadSpeed', 'chunk-load-speed-value', (v) => v);
        this.setupSlider('setting-cloud-coverage', 'cloudCoverage', 'cloud-coverage-value', (v) => Math.round(v * 100) + '%');
        this.setupSlider('setting-tone-mapping', 'toneMappingExposure', 'tone-mapping-value', (v) => v.toFixed(2));
        this.setupSlider('setting-shadow-distance', 'shadowDistance', 'shadow-distance-value', (v) => Math.round(v));
        this.setupSlider('setting-sun-intensity', 'sunIntensity', 'sun-intensity-value', (v) => v.toFixed(2));
        this.setupSlider('setting-ambient-intensity', 'ambientIntensity', 'ambient-intensity-value', (v) => v.toFixed(2));
    }

    setupKeybindUI() {
        const buttons = document.querySelectorAll('.keybind-btn');
        this.keybindButtons = new Map();
        buttons.forEach((btn) => {
            const action = btn.dataset.keybind;
            if (!action) return;
            this.keybindButtons.set(action, btn);
            btn.textContent = this.getBindingLabel(this.settings.getKeyBinding(action));
            btn.addEventListener('click', () => this.beginKeybindCapture(action, btn));
        });

        if (!this.keybindCaptureHandler) {
            this.keybindCaptureHandler = (e) => {
                if (!this.keybindCapture) return;
                e.preventDefault();
                e.stopPropagation();
                if (e.code === 'Escape') {
                    this.finishKeybindCapture(null);
                    return;
                }
                this.finishKeybindCapture(e.code);
            };
            document.addEventListener('keydown', this.keybindCaptureHandler, true);
        }
    }

    beginKeybindCapture(action, button) {
        if (this.keybindCapture && this.keybindCapture.button) {
            const prevAction = this.keybindCapture.action;
            const prevButton = this.keybindCapture.button;
            prevButton.classList.remove('listening');
            prevButton.textContent = this.getBindingLabel(this.settings.getKeyBinding(prevAction));
        }

        this.keybindCapture = { action, button };
        button.classList.add('listening');
        button.textContent = 'Нажмите клавишу';
    }

    finishKeybindCapture(newCode) {
        if (!this.keybindCapture) return;
        const { action, button } = this.keybindCapture;

        if (newCode) {
            this.settings.setKeyBinding(action, newCode);
            button.textContent = this.getBindingLabel(newCode);
            this.refreshBindings();
        } else {
            button.textContent = this.getBindingLabel(this.settings.getKeyBinding(action));
        }

        button.classList.remove('listening');
        this.keybindCapture = null;
    }

    refreshBindings() {
        if (this.player) {
            this.player.updateBindings(this.settings.getKeyBindings());
        }
        this.refreshKeybindButtons();
    }

    refreshKeybindButtons() {
        if (!this.keybindButtons) return;
        this.keybindButtons.forEach((btn, action) => {
            btn.textContent = this.getBindingLabel(this.settings.getKeyBinding(action));
        });
    }

    getBindingLabel(code) {
        if (!code) return '—';
        const arrowMap = {
            ArrowUp: '↑',
            ArrowDown: '↓',
            ArrowLeft: '←',
            ArrowRight: '→'
        };
        if (arrowMap[code]) return arrowMap[code];
        if (code.startsWith('Key')) return code.slice(3);
        if (code.startsWith('Digit')) return code.slice(5);
        if (code.startsWith('Shift')) return 'Shift';
        if (code.startsWith('Control')) return 'Ctrl';
        if (code.startsWith('Alt')) return 'Alt';
        if (code === 'Space') return 'Space';
        if (code === 'Escape') return 'Esc';
        return code;
    }

    isCapturingKeybind() {
        return !!this.keybindCapture;
    }

    applySettings() {
        const antialias = this.settings.get('antialiasing');
        this.renderer.shadowMap.enabled = this.settings.get('shadows');
        this.sun.castShadow = this.settings.get('shadows');
        this.renderer.shadowMap.type = this.settings.get('softShadows') ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
        this.renderer.toneMappingExposure = this.settings.get('toneMappingExposure');
        
        if (this.settings.get('shadows')) {
            const shadowQuality = this.settings.get('shadowQuality');
            const shadowMapSize = this.SHADOW_MAP_SIZES[Math.min(shadowQuality, this.SHADOW_MAP_SIZES.length - 1)] || 2048;
            this.sun.shadow.mapSize.width = shadowMapSize;
            this.sun.shadow.mapSize.height = shadowMapSize;
            this.renderer.shadowMap.needsUpdate = true;
        }

        if (this.settings.get('fogEnabled')) {
            const fogDist = this.settings.get('renderDistance') * WORLD_CONFIG.CHUNK_SIZE;
            if (!this.scene.fog) {
                this.scene.fog = new THREE.Fog(this.skyColor, 20, fogDist - 10);
            } else {
                this.scene.fog.far = fogDist - 10;
            }
        } else {
            this.scene.fog = null;
        }

        this.settings.applyToRenderer(this.renderer);
        this.settings.applyToCamera(this.camera);
        this.settings.applyToWorld(this.world);
        this.settings.applyToSound(this.soundManager);
        this.updateFXAASize();
        
        if (this.sun) this.sun.intensity = this.settings.get('sunIntensity');
        if (this.ambient) this.ambient.intensity = this.settings.get('ambientIntensity');
        if (this.hemiLight) this.hemiLight.intensity = this.settings.get('ambientIntensity') * 0.6;
        this.updateShadowRig();

        if (this.world && this.world.config) {
            this.world.config.RENDER_DISTANCE = this.settings.get('renderDistance');
        }
    }

    setupEvents() {
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
            if (this.composer) {
                this.composer.setSize(window.innerWidth, window.innerHeight);
                this.composer.setPixelRatio(this.renderer.getPixelRatio());
            }
            this.updateFXAASize();
        });

        // --- КЛИКИ ---

        document.getElementById('start-btn')?.addEventListener('click', () => {
            this.setUIState(null); // В ИГРУ
        });

        document.getElementById('settings-menu-btn')?.addEventListener('click', () => {
            this.setUIState('settings');
        });

        document.getElementById('settings-btn')?.addEventListener('click', () => {
            if (this.uiState === null) this.setUIState('settings');
            else if (this.uiState === 'settings') this.setUIState(null);
        });

        document.getElementById('settings-close-btn')?.addEventListener('click', () => {
            this.setUIState('pause'); 
        });
        
        document.getElementById('inventory-close-btn')?.addEventListener('click', () => {
            this.setUIState(null); 
        });

        // --- КЛАВИАТУРА ---
        document.addEventListener('keydown', (e) => {
            if (this.isCapturingKeybind()) return;
            // 1. ESC
            if (e.key === 'Escape') {
                e.preventDefault(); 
                
                switch (this.uiState) {
                    case null: // В игре -> Пауза
                        this.setUIState('pause');
                        break;
                        
                    case 'pause': // В паузе -> Игнорируем ESC (выход только кнопкой Resume)
                        break;
                        
                    case 'settings': // В настройках -> Пауза
                        this.setUIState('pause');
                        break;
                        
                    case 'inventory': // В инвентаре -> Игра
                        this.setUIState(null);
                        break;
                }
                return;
            }

            const inventoryKey = this.settings.getKeyBinding('inventory');
            if (inventoryKey && e.code === inventoryKey) {
                if (this.uiState === null) {
                    e.preventDefault();
                    this.setUIState('inventory');
                } else if (this.uiState === 'inventory') {
                    e.preventDefault();
                    this.setUIState(null);
                }
                return;
            }

            const hudKey = this.settings.getKeyBinding('toggleHUD');
            if (hudKey && e.code === hudKey) {
                e.preventDefault();
                this.toggleHUDVisibility();
                return;
            }
        });
        
        // --- ИНВЕНТАРЬ ---
        document.addEventListener('blockSelected', (e) => {
            const blockId = e.detail.blockId;
            if (this.player) {
                let slotIndex = this.player.hotbar.indexOf(blockId);
                if (slotIndex === -1) {
                    slotIndex = this.player.selectedSlot;
                    this.player.hotbar[slotIndex] = blockId;
                }
                this.player.selectedSlot = slotIndex;
                this.player.updateUI();
                this.updateHotbarWithIcons();
            }
        });

        // --- POINTER LOCK CHANGE (Системный выход) ---
        document.addEventListener('pointerlockchange', () => {
            const isLocked = (document.pointerLockElement === this.renderer.domElement);
            
            if (!isLocked) {
                // Если курсор потерян, а мы думаем, что в игре (uiState === null)
                // Значит это был ESC или Alt-Tab -> ПАУЗА
                if (this.uiState === null) {
                    this.setUIState('pause');
                }
                // Если мы были в меню (инвентарь/настройки), то все ок, курсор и должен быть свободен
            } else {
                // Если курсор захвачен, значит мы в игре
                if (this.uiState !== null) {
                    this.setUIState(null);
                }
            }
            this.syncCursorState();
        });

        document.addEventListener('pointerlockerror', () => {
            this.syncCursorState();
        });
    }

    updateEnvironment() {
        if (!this.player || !this.player.position) {
            this.scene.background = this.skyColor.clone();
            return;
        }

        const y = this.player.position.y;
        const caveFactor = THREE.MathUtils.smoothstep(y, 10, 40);
        
        let skyColor;
        if (this.sky) {
            skyColor = this.sky.getSkyColor();
        } else {
            const sunAngle = (this.dayTime - 0.25) * Math.PI * 2.0;
            const sunElevation = Math.sin(sunAngle);
            const dayFactor = (sunElevation + 1.0) * 0.5;
            
            const daySkyColor = this.skyColor.clone();
            const nightSkyColor = new THREE.Color(0x000814);
            skyColor = new THREE.Color();
            skyColor.lerpColors(nightSkyColor, daySkyColor, dayFactor);
        }
        
        this.tempColor.lerpColors(this.caveColor, skyColor, caveFactor);
        this.scene.background.copy(this.tempColor);

        if (this.scene.fog) {
            this.scene.fog.color.copy(this.tempColor);
        }
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        const currentTime = performance.now();
        const dt = Math.min(this.clock.getDelta(), 0.1);

        const maxFPS = this.settings.get('maxFPS');
        if (maxFPS > 0) {
            const minFrameTime = 1000 / maxFPS;
            const elapsed = currentTime - this.lastFrameTime;
            if (elapsed < minFrameTime) return;
            this.lastFrameTime = currentTime;
        }

        if (this.player && this.shadowCameraPosition) {
            const snap = this.shadowSnapSize || 2;
            this.shadowCameraPosition.set(
                Math.round(this.player.position.x / snap) * snap,
                Math.max(0, Math.round(this.player.position.y / snap) * snap),
                Math.round(this.player.position.z / snap) * snap
            );
        }

        if (this.sky && this.player && this.player.position) {
            const timeSpeed = this.settings.get('timeSpeed');
            const cloudCoverage = this.settings.get('cloudCoverage');
            const skyData = this.sky.update(dt, this.player.position, this.camera, this.isPaused ? 0 : timeSpeed, cloudCoverage);
            
            this.dayTime = skyData.dayTime;
            
            if (this.sun) {
                const baseSunIntensity = this.sky.getLightIntensity();
                const cloudShadowFactor = this.sky.getCloudShadowFactor();
                this.sun.intensity = baseSunIntensity * cloudShadowFactor;
                
                const sunAngle = (this.dayTime - 0.25) * Math.PI * 2.0;
                const sunX = Math.cos(sunAngle) * this.SUN_RADIUS;
                const sunY = Math.sin(sunAngle) * this.SUN_RADIUS;
                
                const sunPos = new THREE.Vector3(
                    this.player.position.x + sunX,
                    sunY + this.SUN_BASE_HEIGHT,
                    this.player.position.z
                );
                
                this.sun.position.copy(sunPos);
                this.sun.target.position.set(
                    this.shadowCameraPosition.x,
                    this.shadowCameraPosition.y,
                    this.shadowCameraPosition.z
                );
                this.sun.target.updateMatrixWorld();
                
                this.sun.shadow.camera.position.copy(sunPos);
                this.sun.shadow.camera.lookAt(this.shadowCameraPosition);
                this.sun.shadow.camera.updateMatrixWorld();
            }
            
            if (this.ambient) {
                const baseAmbient = this.sky.getAmbientIntensity();
                const cloudFactor = this.sky.getCloudShadowFactor();
                this.ambient.intensity = baseAmbient * (0.2 + cloudFactor * 0.8);
            }
            if (this.hemiLight) {
                const baseHemi = this.sky.getHemisphereIntensity();
                const cloudFactor = this.sky.getCloudShadowFactor();
                this.hemiLight.intensity = baseHemi * cloudFactor;
            }
        }
        
        this.updateEnvironment();

        if (!this.isPaused) {
            if (this.player) {
                const previousSlot = this.player.selectedSlot;
                this.player.update(dt);
                
                if (this.player.selectedSlot !== previousSlot && this.inventory) {
                    this.updateHotbarWithIcons();
                }
                
                if (this.world && this.player.position && this.sky) {
                    const time = this.sky.cloudMaterial ? this.sky.cloudMaterial.uniforms.uTime.value : 0;
                    const cloudCoverage = this.settings.get('cloudCoverage');
                    this.world.update(this.player.position, time, this.sky.CLOUD_HEIGHT, cloudCoverage);
                } else if (this.world && this.player.position) {
                    this.world.update(this.player.position);
                }
            }
        }

        if (this.postProcessingEnabled && this.composer) {
            this.composer.render();
        } else {
            this.renderer.render(this.scene, this.camera);
        }

        this.fpsUpdateTimer += dt;
        if (this.fpsUpdateTimer >= this.fpsUpdateInterval) {
            const fpsEl = document.getElementById('fps-counter');
            if (fpsEl) {
                const fps = dt > 0.001 ? Math.round(1/dt) : 0;
                fpsEl.innerText = fps;
            }
            this.fpsUpdateTimer = 0;
        }

        const coordEl = document.getElementById('coords');
        if (coordEl && this.player && this.player.position) {
            coordEl.innerText = `${Math.floor(this.player.position.x)}, ${Math.floor(this.player.position.y)}, ${Math.floor(this.player.position.z)}`;
        }
    }
}

new Application();
