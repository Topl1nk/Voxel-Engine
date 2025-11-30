import * as THREE from 'three';
import { World } from './world.js';
import { Player } from './player.js';
import { WORLD_CONFIG } from './constants.js';
import { SoundManager } from './sound.js';
import { SettingsManager } from './settings.js';
import { Sky } from './sky.js';

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

        // Система дня и ночи
        // dayTime: 0.0 = полночь, 0.25 = рассвет, 0.5 = полдень, 0.75 = закат, 1.0 = полночь
        this.dayTime = 0.5; // Начинаем с полдня
        this.baseDaySpeed = 0.0001; // Базовая скорость смены дня и ночи
        
        // Константы для системы дня/ночи
        this.SUN_RADIUS = 300; // Радиус орбиты солнца
        this.SUN_BASE_HEIGHT = 100; // Базовая высота для центрирования
        this.MOON_RADIUS_MULTIPLIER = 0.8; // Луна немного ближе
        this.MOON_Z_OFFSET = 0.3; // Луна смещена по Z

        // Инициализируем менеджер настроек
        this.settings = new SettingsManager();
        
        // Константы для теней
        this.SHADOW_MAP_SIZES = [512, 1024, 2048, 4096];

        // Теперь можно инициализировать системы
        this.initRenderer();
        this.initScene();
        this.initWorld();
        this.initUI();

        this.setupEvents();
        this.animate();
    }

    initRenderer() {
        const antialias = this.settings.get('antialiasing');
        this.renderer = new THREE.WebGLRenderer({ 
            antialias: antialias, 
            powerPreference: "high-performance" 
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.settings.applyToRenderer(this.renderer);
        this.renderer.shadowMap.enabled = this.settings.get('shadows');
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        document.body.appendChild(this.renderer.domElement);
    }

    initScene() {
        this.scene = new THREE.Scene();
        this.scene.background = this.skyColor.clone();

        const fogDist = this.settings.get('renderDistance') * WORLD_CONFIG.CHUNK_SIZE;
        if (this.settings.get('fogEnabled')) {
            this.scene.fog = new THREE.Fog(this.skyColor, 20, fogDist - 10);
        }

        this.camera = new THREE.PerspectiveCamera(
            this.settings.get('fov'), 
            window.innerWidth / window.innerHeight, 
            0.1, 
            2000 // Увеличено для солнца/луны (радиус орбиты 300)
        );
        this.settings.applyToCamera(this.camera);

        // 1. AMBIENT LIGHT (уменьшен для более контрастных теней)
        this.ambient = new THREE.AmbientLight(0xffffff, 0.1);
        this.scene.add(this.ambient);

        // 2. HEMISPHERE LIGHT
        this.hemiLight = new THREE.HemisphereLight(0x87CEEB, 0x444444, 0.2);
        this.scene.add(this.hemiLight);

        // 3. SUN LIGHT
        this.sun = new THREE.DirectionalLight(0xffffff, 1.5);
        this.sun.position.set(50, 100, 50);
        // ИСПРАВЛЕНО: Тени всегда включены, меняется только качество
        this.sun.castShadow = true;

        // Настройка теней в зависимости от качества - ИСПРАВЛЕНО
        const shadowQuality = this.settings.get('shadowQuality');
        const shadowMapSize = this.SHADOW_MAP_SIZES[Math.min(shadowQuality, this.SHADOW_MAP_SIZES.length - 1)] || 2048;
        
        // ИСПРАВЛЕНО: Shadow camera НЕ следует за игроком, чтобы тени не скакали
        const d = 100; // Увеличена область теней
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
        
        // Сохраняем фиксированную позицию для shadow camera
        this.shadowCameraPosition = new THREE.Vector3(0, 0, 0);

        // Инициализируем звук ПОСЛЕ создания камеры
        this.soundManager = new SoundManager(this.camera);
        this.settings.applyToSound(this.soundManager);
    }

    initWorld() {
        this.world = new World(this.scene);
        // Передаем soundManager игроку
        this.player = new Player(
            this.camera, 
            this.renderer.domElement, 
            this.world, 
            this.soundManager,
            this.settings
        );
        
        // Применяем настройки к миру при инициализации
        this.settings.applyToWorld(this.world);
        
        // Создаем систему неба после создания мира (чтобы получить доступ к текстуре атласа)
        if (this.world.material && this.world.material.map) {
            this.sky = new Sky(this.scene, this.world.material.map);
            // Синхронизируем время суток
            this.sky.dayTime = this.dayTime;
        }
        
        this.world.update(this.player.position);
    }

    initUI() {
        // Загружаем настройки в UI
        this.updateSettingsUI();
        
        // Настраиваем обработчики событий для настроек
        this.setupSettingsHandlers();
    }

    setupSettingsHandlers() {
        // Чекбоксы
        document.getElementById('setting-antialiasing').checked = this.settings.get('antialiasing');
        document.getElementById('setting-shadows').checked = this.settings.get('shadows');
        document.getElementById('setting-fog').checked = this.settings.get('fogEnabled');
        document.getElementById('setting-vsync').checked = this.settings.get('vsync');
        document.getElementById('setting-sound-enabled').checked = this.settings.get('soundEnabled');
        document.getElementById('setting-bobbing').checked = this.settings.get('bobbing');

        // Селекты
        document.getElementById('setting-shadow-quality').value = this.settings.get('shadowQuality');

        // Слайдеры
        this.setupSlider('setting-render-distance', 'renderDistance', 'render-distance-value', (v) => v);
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

        // Обработчики чекбоксов
        document.getElementById('setting-antialiasing').addEventListener('change', (e) => {
            this.settings.set('antialiasing', e.target.checked);
            this.applySettings();
        });

        document.getElementById('setting-shadows').addEventListener('change', (e) => {
            this.settings.set('shadows', e.target.checked);
            this.applySettings();
        });

        document.getElementById('setting-fog').addEventListener('change', (e) => {
            this.settings.set('fogEnabled', e.target.checked);
            this.applySettings();
        });

        document.getElementById('setting-vsync').addEventListener('change', (e) => {
            this.settings.set('vsync', e.target.checked);
            // VSync управляется через requestAnimationFrame, здесь просто сохраняем
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

        // Кнопки
        document.getElementById('settings-apply-btn').addEventListener('click', () => {
            this.applySettings();
            this.closeSettings();
        });

        document.getElementById('settings-reset-btn').addEventListener('click', () => {
            if (confirm('Сбросить все настройки к значениям по умолчанию?')) {
                this.settings = new SettingsManager();
                this.updateSettingsUI();
                this.applySettings();
            }
        });
    }

    setupSlider(sliderId, settingKey, valueId, formatter) {
        const slider = document.getElementById(sliderId);
        const valueDisplay = document.getElementById(valueId);
        
        if (!slider || !valueDisplay) return;

        // Устанавливаем начальное значение
        const currentValue = this.settings.get(settingKey);
        slider.value = currentValue;
        valueDisplay.textContent = formatter(currentValue);

        // Обработчик изменения
        slider.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            this.settings.set(settingKey, value);
            valueDisplay.textContent = formatter(value);
            
            // Применяем некоторые настройки сразу
            if (settingKey === 'masterVolume' || settingKey === 'soundEffectsVolume' || settingKey === 'musicVolume') {
                this.settings.applyToSound(this.soundManager);
            } else if (settingKey === 'fov') {
                this.settings.applyToCamera(this.camera);
            } else if (settingKey === 'pixelRatio') {
                this.settings.applyToRenderer(this.renderer);
            } else if (settingKey === 'mouseSensitivity' && this.player) {
                this.player.mouseSensitivity = value;
            } else if (settingKey === 'timeSpeed') {
                // Скорость времени применяется автоматически в animate()
            } else if (settingKey === 'chunkLoadSpeed' && this.world) {
                this.world.chunkLoadSpeed = value;
            } else if (settingKey === 'cloudCoverage') {
                // Покрытие облаков применяется в следующем кадре
                console.log('[Settings] Cloud coverage changed to:', value.toFixed(2));
            }
        });
    }

    updateSettingsUI() {
        // Обновляем все элементы UI значениями из настроек
        document.getElementById('setting-antialiasing').checked = this.settings.get('antialiasing');
        document.getElementById('setting-shadows').checked = this.settings.get('shadows');
        document.getElementById('setting-fog').checked = this.settings.get('fogEnabled');
        document.getElementById('setting-vsync').checked = this.settings.get('vsync');
        document.getElementById('setting-sound-enabled').checked = this.settings.get('soundEnabled');
        document.getElementById('setting-bobbing').checked = this.settings.get('bobbing');
        document.getElementById('setting-shadow-quality').value = this.settings.get('shadowQuality');
        
        // Обновляем слайдеры
        document.getElementById('setting-render-distance').value = this.settings.get('renderDistance');
        document.getElementById('render-distance-value').textContent = this.settings.get('renderDistance');
        // ... остальные слайдеры обновляются через setupSlider
    }

    applySettings() {
        // Применяем настройки графики
        const antialias = this.settings.get('antialiasing');
        // Нельзя изменить antialiasing после создания renderer, нужно пересоздать
        // Для продакшена это нормально, но здесь просто предупреждаем
        
        // ИСПРАВЛЕНО: Тени всегда включены, меняется только качество
        this.renderer.shadowMap.enabled = this.settings.get('shadows');
        this.sun.castShadow = this.settings.get('shadows'); // Включаем/выключаем только через чекбокс
        
        // ИСПРАВЛЕНО: Качество теней меняет разрешение, но не выключает их
        if (this.settings.get('shadows')) {
            const shadowQuality = this.settings.get('shadowQuality');
            const shadowMapSize = this.SHADOW_MAP_SIZES[Math.min(shadowQuality, this.SHADOW_MAP_SIZES.length - 1)] || 2048;
            this.sun.shadow.mapSize.width = shadowMapSize;
            this.sun.shadow.mapSize.height = shadowMapSize;
        }

        // Туман
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

        // Применяем остальные настройки
        this.settings.applyToRenderer(this.renderer);
        this.settings.applyToCamera(this.camera);
        this.settings.applyToWorld(this.world);
        this.settings.applyToSound(this.soundManager);
        
        // Обновляем renderDistance в world.config
        if (this.world && this.world.config) {
            this.world.config.RENDER_DISTANCE = this.settings.get('renderDistance');
        }
    }

    setupEvents() {
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });

        document.getElementById('start-btn')?.addEventListener('click', () => {
            this.renderer.domElement.requestPointerLock();
        });

        document.getElementById('settings-menu-btn')?.addEventListener('click', () => {
            this.openSettings();
        });

        document.getElementById('settings-btn')?.addEventListener('click', () => {
            if (this.isPaused) {
                this.openSettings();
            } else {
                // Если игра идет, ставим на паузу и открываем настройки
                document.exitPointerLock();
            }
        });

        document.getElementById('settings-close-btn')?.addEventListener('click', () => {
            this.closeSettings();
        });

        // Закрытие настроек по ESC
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (document.getElementById('settings-overlay').classList.contains('active')) {
                    this.closeSettings();
                } else if (!this.isPaused) {
                    document.exitPointerLock();
                }
            }
        });

        document.addEventListener('pointerlockchange', () => {
            this.isPaused = (document.pointerLockElement !== this.renderer.domElement);
            document.getElementById('menu-overlay').style.display = this.isPaused ? 'flex' : 'none';
            if (this.isPaused) {
                document.getElementById('settings-overlay').classList.remove('active');
            }
        });
    }

    openSettings() {
        document.getElementById('settings-overlay').classList.add('active');
        this.updateSettingsUI();
    }

    closeSettings() {
        document.getElementById('settings-overlay').classList.remove('active');
    }

    updateEnvironment() {
        // Защита от NaN, если физика игрока заглючит
        if (!this.player || !this.player.position) {
            // Если игрок еще не инициализирован, используем базовый цвет неба
            this.scene.background = this.skyColor.clone();
            return;
        }

        const y = this.player.position.y;

        // Интерполяция для пещер/неба:
        // y > 40: Небо (factor = 1)
        // y < 10: Пещера (factor = 0)
        const caveFactor = THREE.MathUtils.smoothstep(y, 10, 40);
        
        // Получаем цвет неба от системы неба (если она существует)
        let skyColor;
        if (this.sky) {
            skyColor = this.sky.getSkyColor();
        } else {
            // Fallback на старую систему
            const sunAngle = (this.dayTime - 0.25) * Math.PI * 2.0;
            const sunElevation = Math.sin(sunAngle);
            const dayFactor = (sunElevation + 1.0) * 0.5;
            
            const daySkyColor = this.skyColor.clone();
            const nightSkyColor = new THREE.Color(0x000814);
            skyColor = new THREE.Color();
            skyColor.lerpColors(nightSkyColor, daySkyColor, dayFactor);
        }
        
        // Применяем фактор пещеры
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

        // Ограничение FPS
        const maxFPS = this.settings.get('maxFPS');
        if (maxFPS > 0) {
            const minFrameTime = 1000 / maxFPS;
            const elapsed = currentTime - this.lastFrameTime;
            if (elapsed < minFrameTime) {
                return;
            }
            this.lastFrameTime = currentTime;
        }

        // Обновляем систему неба
        if (this.sky && this.player && this.player.position) {
            const timeSpeed = this.settings.get('timeSpeed');
            const cloudCoverage = this.settings.get('cloudCoverage');
            const skyData = this.sky.update(dt, this.player.position, this.camera, this.isPaused ? 0 : timeSpeed, cloudCoverage);
            
            // Синхронизируем dayTime с системой неба
            this.dayTime = skyData.dayTime;
            
            // Обновляем освещение на основе данных системы неба
            if (this.sun) {
                // Базовая интенсивность от времени суток
                const baseSunIntensity = this.sky.getLightIntensity();
                
                // Применяем затенение от облаков
                const cloudShadowFactor = this.sky.getCloudShadowFactor();
                this.sun.intensity = baseSunIntensity * cloudShadowFactor;
                
                // Обновляем позицию солнца для теней
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
            
            // Ambient и hemisphere свет тоже слегка затеняются облаками
            if (this.ambient) {
                const baseAmbient = this.sky.getAmbientIntensity();
                const cloudFactor = this.sky.getCloudShadowFactor();
                // Ambient меньше затеняется (80% облачного фактора + 20% всегда)
                this.ambient.intensity = baseAmbient * (0.2 + cloudFactor * 0.8);
            }
            if (this.hemiLight) {
                const baseHemi = this.sky.getHemisphereIntensity();
                const cloudFactor = this.sky.getCloudShadowFactor();
                this.hemiLight.intensity = baseHemi * cloudFactor;
            }
        }
        
        // Обновляем фон и окружение
        this.updateEnvironment();

        if (!this.isPaused) {
            if (this.player) {
                this.player.update(dt);
                if (this.world && this.player.position && this.sky) {
                    // Передаем время и высоту облаков для теней
                    const time = this.sky.cloudMaterial ? this.sky.cloudMaterial.uniforms.uTime.value : 0;
                    const cloudCoverage = this.settings.get('cloudCoverage');
                    this.world.update(this.player.position, time, this.sky.CLOUD_HEIGHT, cloudCoverage);
                } else if (this.world && this.player.position) {
                    this.world.update(this.player.position);
                }
            }
        }

        this.renderer.render(this.scene, this.camera);

        // Обновляем FPS с интервалом
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
