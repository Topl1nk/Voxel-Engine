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
        this.dayTime = 0.32; // Начинаем с мягкого утра
        this.baseDaySpeed = 0.0001; // Базовая скорость смены дня и ночи
        
        // Константы для системы дня/ночи
        this.SUN_RADIUS = 300; 
        this.SUN_BASE_HEIGHT = 100; 
        this.MOON_RADIUS_MULTIPLIER = 0.8; 
        this.MOON_Z_OFFSET = 0.3; 

        this.settings = new SettingsManager();
        this.activeGraphicsProfile = this.settings.getGraphicsConfig();
        this.keybindCapture = null;
        this.keybindButtons = new Map();
        this.keybindCaptureHandler = null;
        this.pmremGenerator = null;
        this.environmentTexture = null;
        this.composer = null;
        this.renderPass = null;
        this.fxaaPass = null;
        this.postProcessingEnabled = false;
        this.shadowSnapSize = 6;
        this.debugAmbientEnabled = true;
        this.debugCloudLightingEnabled = true;
        this.debugViewIndex = 0;
        this.debugViews = ['none', 'lighting', 'cameraNormals', 'worldNormals', 'depth', 'shadowMap', 'wireframe'];
        this.shadowDebugMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });
        this.shadowDebugEnabled = false;
        const depthVertex = `
            varying float vViewZ;
            void main() {
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                vViewZ = -mvPosition.z;
                gl_Position = projectionMatrix * mvPosition;
            }
        `;
        const depthFragment = `
            varying float vViewZ;
            uniform float depthRange;
            uniform float depthBias;
            void main() {
                float d = clamp((vViewZ - depthBias) / depthRange, 0.0, 1.0);
                vec3 color = vec3(d, d * 0.65, 1.0 - d);
                gl_FragColor = vec4(color, 1.0);
            }
        `;
        const worldNormalVertex = `
            varying vec3 vWorldNormal;
            void main() {
                vec4 worldPos = modelMatrix * vec4(position, 1.0);
                vWorldNormal = normalize(mat3(modelMatrix) * normal) * 0.5 + 0.5;
                gl_Position = projectionMatrix * viewMatrix * worldPos;
            }
        `;
        const worldNormalFragment = `
            varying vec3 vWorldNormal;
            void main() {
                gl_FragColor = vec4(vWorldNormal, 1.0);
            }
        `;
        const shadowMapVertex = `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = vec4(position.xy, 0.0, 1.0);
            }
        `;
        const shadowMapFragment = `
            varying vec2 vUv;
            uniform sampler2D shadowMap;
            #include <packing>
            void main() {
                float depth = unpackRGBAToDepth( texture2D( shadowMap, vUv ) );
                if ( depth >= 0.9999 ) {
                    discard;
                }
                gl_FragColor = vec4(vec3(depth), 1.0);
            }
        `;
        this.debugMaterials = {
            lighting: new THREE.MeshLambertMaterial({ color: 0xffffff }),
            cameraNormals: new THREE.MeshNormalMaterial({ flatShading: false }),
            worldNormals: new THREE.ShaderMaterial({
                vertexShader: worldNormalVertex,
                fragmentShader: worldNormalFragment
            }),
            depth: new THREE.ShaderMaterial({
                uniforms: {
                    depthRange: { value: 150.0 },
                    depthBias: { value: 0.0 }
                },
                vertexShader: depthVertex,
                fragmentShader: depthFragment
            }),
            wireframe: new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true })
        };
        this.shadowMapScene = new THREE.Scene();
        this.shadowMapCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        const quadGeometry = new THREE.PlaneGeometry(2, 2);
        this.shadowMapMaterial = new THREE.ShaderMaterial({
            uniforms: { shadowMap: { value: null } },
            vertexShader: shadowMapVertex,
            fragmentShader: shadowMapFragment,
            depthWrite: false,
            depthTest: false
        });
        this.shadowMapQuad = new THREE.Mesh(quadGeometry, this.shadowMapMaterial);
        this.shadowMapScene.add(this.shadowMapQuad);

        // Теперь можно инициализировать системы
        this.initRenderer();
        this.initScene();
        this.initWorld();
        this.initUI();

        this.setupEvents();
        this.applySettings();

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
        const graphics = this.activeGraphicsProfile;
        this.renderer = new THREE.WebGLRenderer({ 
            antialias: !!graphics.nativeAA, 
            powerPreference: "high-performance",
            stencil: false,
            depth: true
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, graphics.pixelRatio));
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = graphics.exposure;
        this.renderer.physicallyCorrectLights = true;
        this.renderer.shadowMap.enabled = graphics.shadows;
        this.renderer.shadowMap.type = this.getShadowMapType(graphics.shadowType);
        this.renderer.shadowMap.autoUpdate = true;
        document.body.appendChild(this.renderer.domElement);
        this.settings.applyToRenderer(this.renderer);

        this.pmremGenerator = new THREE.PMREMGenerator(this.renderer);
        const roomEnvironment = new RoomEnvironment();
        this.environmentTexture = this.pmremGenerator.fromScene(roomEnvironment, 0.04).texture;
        if (roomEnvironment.dispose) roomEnvironment.dispose();
    }

    initScene() {
        const graphics = this.activeGraphicsProfile;
        this.scene = new THREE.Scene();
        this.scene.background = this.skyColor.clone();
        if (this.environmentTexture) {
            this.scene.environment = this.environmentTexture;
        }

        const fogDist = graphics.renderDistance * WORLD_CONFIG.CHUNK_SIZE;
        if (graphics.fog) {
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
        this.ambient = new THREE.AmbientLight(0xffffff, graphics.ambientIntensity);
        this.scene.add(this.ambient);

        // 2. HEMISPHERE LIGHT
        this.hemiLight = new THREE.HemisphereLight(0x87CEEB, 0x444444, graphics.hemiIntensity);
        this.scene.add(this.hemiLight);

        // 3. SUN LIGHT
        this.sun = new THREE.DirectionalLight(0xffffff, graphics.sunIntensity);
        this.sun.position.set(50, 100, 50);
        this.sun.castShadow = graphics.shadows;
        const shadowMapSize = graphics.shadowMapSize || 2048;
        
        const d = 100; 
        this.sun.shadow.camera.left = -d;
        this.sun.shadow.camera.right = d;
        this.sun.shadow.camera.top = d;
        this.sun.shadow.camera.bottom = -d;
        this.sun.shadow.camera.near = 0.1;
        this.sun.shadow.camera.far = 500;

        this.sun.shadow.mapSize.width = shadowMapSize;
        this.sun.shadow.mapSize.height = shadowMapSize;
        this.sun.shadow.radius = graphics.shadowRadius || 2.0;
        const initialShadowBias = this.computeShadowBiasValues(graphics.shadowDistance);
        this.sun.shadow.bias = initialShadowBias.bias;
        this.sun.shadow.normalBias = initialShadowBias.normalBias;

        this.scene.add(this.sun);
        this.scene.add(this.sun.target);
        this.shadowCameraPosition = new THREE.Vector3(0, 0, 0);
        this.updateShadowRig(graphics.shadowDistance);

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
            this.configureAtlasTexture(this.activeGraphicsProfile);
            
            this.inventory = new Inventory(this.scene, this.world.material.map, this.player);
            
            setTimeout(() => {
                this.updateHotbarWithIcons();
            }, 100);
        }
        
        this.world.update(this.player.position, 0, this.sky ? this.sky.CLOUD_HEIGHT : 200, this.settings.get('cloudCoverage'));
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
        this.setupGraphicsPresetButtons();
        this.setupKeybindUI();
        this.refreshKeybindButtons();
    }

    setupSettingsHandlers() {
        const cinematicToggle = document.getElementById('setting-cinematic-effects');
        if (cinematicToggle) {
            cinematicToggle.addEventListener('change', (e) => {
                this.settings.set('cinematicEffects', e.target.checked);
                this.applySettings();
            });
        }
        const shadowToggle = document.getElementById('setting-shadows');
        if (shadowToggle) {
            shadowToggle.addEventListener('change', (e) => {
                this.settings.set('shadows', e.target.checked);
                this.applySettings();
            });
        }
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
            } else if (settingKey === 'mouseSensitivity' && this.player) {
                this.player.mouseSensitivity = value;
            } else if (settingKey === 'chunkLoadSpeed' && this.world) {
                this.world.chunkLoadSpeed = value;
            } else if (settingKey === 'renderDistance') {
                if (this.world && this.world.config) {
                    this.world.config.RENDER_DISTANCE = value;
                }
                if (this.scene && this.scene.fog) {
                    const fogDist = value * WORLD_CONFIG.CHUNK_SIZE;
                    this.scene.fog.far = fogDist - 10;
                }
                this.applySettings();
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

    getShadowMapType(type) {
        switch (type) {
            case 'pcf':
                return THREE.PCFShadowMap;
            case 'pcfsoft':
                return THREE.PCFSoftShadowMap;
            case 'vsm':
                return THREE.VSMShadowMap;
            default:
                return THREE.PCFSoftShadowMap;
        }
    }

    configureAtlasTexture(graphics = this.activeGraphicsProfile) {
        if (!this.renderer || !this.world || !this.world.material || !this.world.material.map) return;
        const atlas = this.world.material.map;
        atlas.generateMipmaps = false;
        atlas.minFilter = THREE.NearestFilter;
        atlas.magFilter = THREE.NearestFilter;
        const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
        const targetAniso = graphics ? Math.max(1, Math.floor(graphics.pixelRatio * 4)) : 1;
        atlas.anisotropy = Math.min(maxAniso, targetAniso);
        atlas.wrapS = THREE.ClampToEdgeWrapping;
        atlas.wrapT = THREE.ClampToEdgeWrapping;
        atlas.needsUpdate = true;
    }

    computeShadowBiasValues(distanceOverride) {
        const graphics = this.activeGraphicsProfile || this.settings.getGraphicsConfig();
        const targetDistance = distanceOverride || graphics.shadowDistance || 140;
        const mapSize = this.sun?.shadow?.mapSize?.x || graphics.shadowMapSize || 2048;
        const clampedMapSize = Math.max(512, mapSize);
        const sizeFactor = 2048 / clampedMapSize;
        const distanceFactor = targetDistance / 140;
        const biasBase = -0.00055;
        const normalBiasBase = 0.05;
        const bias = THREE.MathUtils.clamp(biasBase * sizeFactor * distanceFactor, -0.0035, -0.0001);
        const normalBias = THREE.MathUtils.clamp(normalBiasBase * distanceFactor, 0.02, 0.12);
        return { bias, normalBias };
    }

    updateShadowRig(distanceOverride) {
        if (!this.sun || !this.sun.shadow) return;
        const graphics = this.activeGraphicsProfile || this.settings.getGraphicsConfig();
        const shadowRange = distanceOverride || graphics.shadowDistance || 140;
        this.sun.shadow.camera.left = -shadowRange;
        this.sun.shadow.camera.right = shadowRange;
        this.sun.shadow.camera.top = shadowRange;
        this.sun.shadow.camera.bottom = -shadowRange;
        this.sun.shadow.camera.near = 0.5;
        this.sun.shadow.camera.far = shadowRange * 3;
        this.sun.shadow.radius = graphics.shadowRadius ?? this.sun.shadow.radius;
        const { bias, normalBias } = this.computeShadowBiasValues(distanceOverride);
        this.sun.shadow.bias = bias;
        this.sun.shadow.normalBias = normalBias;
        this.sun.shadow.camera.updateProjectionMatrix();
    }


    updateSettingsUI() {
        const cinematicToggle = document.getElementById('setting-cinematic-effects');
        if (cinematicToggle) cinematicToggle.checked = this.settings.get('cinematicEffects');
        const shadowToggle = document.getElementById('setting-shadows');
        if (shadowToggle) shadowToggle.checked = this.settings.get('shadows');
        const soundToggle = document.getElementById('setting-sound-enabled');
        if (soundToggle) soundToggle.checked = this.settings.get('soundEnabled');
        const bobbingToggle = document.getElementById('setting-bobbing');
        if (bobbingToggle) bobbingToggle.checked = this.settings.get('bobbing');
        
        this.setupSlider('setting-render-distance', 'renderDistance', 'render-distance-value', (v) => Math.round(v));
        this.setupSlider('setting-master-volume', 'masterVolume', 'master-volume-value', (v) => Math.round(v * 100));
        this.setupSlider('setting-sfx-volume', 'soundEffectsVolume', 'sfx-volume-value', (v) => Math.round(v * 100));
        this.setupSlider('setting-music-volume', 'musicVolume', 'music-volume-value', (v) => Math.round(v * 100));
        this.setupSlider('setting-mouse-sensitivity', 'mouseSensitivity', 'mouse-sensitivity-value', (v) => v.toFixed(1));
        this.setupSlider('setting-fov', 'fov', 'fov-value', (v) => Math.round(v));
        this.setupSlider('setting-time-speed', 'timeSpeed', 'time-speed-value', (v) => v.toFixed(2));
        this.setupSlider('setting-max-fps', 'maxFPS', 'max-fps-value', (v) => v || '∞');
        this.setupSlider('setting-chunk-load-speed', 'chunkLoadSpeed', 'chunk-load-speed-value', (v) => v);
        this.setupSlider('setting-cloud-coverage', 'cloudCoverage', 'cloud-coverage-value', (v) => Math.round(v * 100) + '%');
        
        this.highlightPresetButton();
    }

    applyDebugView() {
        const mode = this.debugViews[this.debugViewIndex] || 'none';
        const statusEl = document.getElementById('status-text');
        if (statusEl) {
            statusEl.textContent = `DEBUG: ${mode.toUpperCase()}`;
        }
        switch (mode) {
            case 'lighting':
                this.scene.overrideMaterial = this.debugMaterials.lighting;
                break;
            case 'cameraNormals':
                this.scene.overrideMaterial = this.debugMaterials.cameraNormals;
                break;
            case 'worldNormals':
                this.scene.overrideMaterial = this.debugMaterials.worldNormals;
                break;
            case 'depth':
                const range = Math.max(20, (this.activeGraphicsProfile?.shadowDistance || 140) * 1.5);
                this.debugMaterials.depth.uniforms.depthRange.value = range;
                this.debugMaterials.depth.uniforms.depthBias.value = this.camera.near;
                this.scene.overrideMaterial = this.debugMaterials.depth;
                break;
            case 'shadowMap':
                this.scene.overrideMaterial = null;
                break;
            case 'wireframe':
                this.scene.overrideMaterial = this.debugMaterials.wireframe;
                break;
            default:
                this.scene.overrideMaterial = null;
        }
        console.log(`[Debug] View: ${mode}`);
    }

    cycleDebugView(direction = 1) {
        const count = this.debugViews.length;
        this.debugViewIndex = (this.debugViewIndex + direction + count) % count;
        this.applyDebugView();
    }

    setupGraphicsPresetButtons() {
        const buttons = document.querySelectorAll('[data-graphics-preset]');
        this.graphicsPresetButtons = buttons;
        buttons.forEach((btn) => {
            btn.addEventListener('click', () => {
                const preset = btn.dataset.graphicsPreset;
                if (!preset) return;
                this.settings.applyGraphicsPreset(preset);
                this.activeGraphicsProfile = this.settings.getGraphicsConfig();
                this.updateSettingsUI();
                this.applySettings();
            });
        });
        this.highlightPresetButton();
    }

    highlightPresetButton() {
        if (!this.graphicsPresetButtons) return;
        const current = this.settings.getGraphicsPresetName();
        this.graphicsPresetButtons.forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.graphicsPreset === current);
        });
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
        this.activeGraphicsProfile = this.settings.getGraphicsConfig();
        const graphics = this.activeGraphicsProfile;
        if (this.renderer) {
            this.renderer.shadowMap.enabled = graphics.shadows;
            this.renderer.shadowMap.type = this.getShadowMapType(graphics.shadowType);
            this.renderer.toneMappingExposure = graphics.exposure;
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, graphics.pixelRatio));
            if (this.composer) {
                this.composer.setPixelRatio(this.renderer.getPixelRatio());
            }
        }
        if (this.sun) {
            this.sun.castShadow = graphics.shadows;
            this.sun.intensity = graphics.sunIntensity;
            this.sun.shadow.mapSize.set(graphics.shadowMapSize || 2048, graphics.shadowMapSize || 2048);
            this.sun.shadow.radius = graphics.shadowRadius ?? this.sun.shadow.radius;
            this.renderer.shadowMap.needsUpdate = true;
        }

        if (graphics.fog) {
            const fogDist = graphics.renderDistance * WORLD_CONFIG.CHUNK_SIZE;
            if (!this.scene.fog) {
                this.scene.fog = new THREE.Fog(this.skyColor, 20, fogDist - 10);
            } else {
                this.scene.fog.far = fogDist - 10;
            }
        } else {
            this.scene.fog = null;
        }

        if (this.ambient) this.ambient.intensity = graphics.ambientIntensity;
        if (this.hemiLight) this.hemiLight.intensity = graphics.hemiIntensity;

        this.settings.applyToRenderer(this.renderer);
        this.settings.applyToCamera(this.camera);
        this.settings.applyToWorld(this.world);
        this.settings.applyToSound(this.soundManager);
        this.updateFXAASize();
        this.configureAtlasTexture(graphics);
        this.updateShadowRig(graphics.shadowDistance);

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
            if (e.code === 'BracketRight') {
                e.preventDefault();
                this.cycleDebugView(1);
                return;
            }
            if (e.code === 'BracketLeft') {
                e.preventDefault();
                this.cycleDebugView(-1);
                return;
            }
            if (e.code === 'Comma') {
                e.preventDefault();
                this.debugAmbientEnabled = !this.debugAmbientEnabled;
                console.log(`[Debug] Ambient influence: ${this.debugAmbientEnabled ? 'on' : 'off'}`);
                return;
            }
            if (e.code === 'Period') {
                e.preventDefault();
                this.debugCloudLightingEnabled = !this.debugCloudLightingEnabled;
                console.log(`[Debug] Cloud lighting factor: ${this.debugCloudLightingEnabled ? 'on' : 'off'}`);
                return;
            }
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
                const cloudLightFactor = this.debugCloudLightingEnabled ? this.sky.getCloudShadowFactor() : 1.0;
                this.sun.intensity = Math.max(0.2, baseSunIntensity * cloudLightFactor);
                
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
                const ambientMod = this.debugAmbientEnabled ? (0.2 + cloudFactor * 0.8) : 1.0;
                this.ambient.intensity = baseAmbient * ambientMod;
            }
            if (this.hemiLight) {
                const baseHemi = this.sky.getHemisphereIntensity();
                const cloudFactor = this.sky.getCloudShadowFactor();
                const hemiMod = this.debugAmbientEnabled ? cloudFactor : 1.0;
                this.hemiLight.intensity = baseHemi * hemiMod;
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
                    this.world.update(this.player.position, 0, this.sky ? this.sky.CLOUD_HEIGHT : 200, this.settings.get('cloudCoverage'));
                }
            }
        }

        const currentDebugMode = this.debugViews[this.debugViewIndex];
        if (currentDebugMode === 'shadowMap') {
            const shadowTexture = this.sun?.shadow?.map?.texture;
            if (shadowTexture) {
                this.shadowMapMaterial.uniforms.shadowMap.value = shadowTexture;
                this.renderer.render(this.shadowMapScene, this.shadowMapCamera);
            } else {
                this.renderer.render(this.scene, this.camera);
            }
        } else if (this.postProcessingEnabled && this.composer) {
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
