export const GRAPHICS_PRESETS = {
    performance: {
        label: 'Производительность',
        pixelRatio: 1.0,
        exposure: 1.0,
        renderDistance: 6,
        sunIntensity: 1.15,
        ambientIntensity: 0.24,
        hemiIntensity: 0.16,
        shadowMapSize: 1024,
        shadowDistance: 100,
        shadowType: 'pcf',
        shadowRadius: 1.0,
        fog: true,
        reflectionStrength: 0.03,
        aoIntensity: 0.26,
        nativeAA: false
    },
    balanced: {
        label: 'Сбалансировано',
        pixelRatio: 1.25,
        exposure: 1.02,
        renderDistance: 7,
        sunIntensity: 1.25,
        ambientIntensity: 0.28,
        hemiIntensity: 0.2,
        shadowMapSize: 2048,
        shadowDistance: 140,
        shadowType: 'pcfsoft',
        shadowRadius: 2.0,
        fog: true,
        reflectionStrength: 0.05,
        aoIntensity: 0.32,
        nativeAA: false
    },
    cinematic: {
        label: 'Кино',
        pixelRatio: 1.4,
        exposure: 1.05,
        renderDistance: 8,
        sunIntensity: 1.55,
        ambientIntensity: 0.24,
        hemiIntensity: 0.18,
        shadowMapSize: 3072,
        shadowDistance: 170,
        shadowType: 'pcfsoft',
        shadowRadius: 1.6,
        fog: true,
        reflectionStrength: 0.1,
        aoIntensity: 0.3,
        nativeAA: true
    }
};

// Система настроек игры
export class SettingsManager {
    constructor() {
        this.defaultKeyBindings = {
            moveForward: 'KeyW',
            moveBackward: 'KeyS',
            moveLeft: 'KeyA',
            moveRight: 'KeyD',
            jump: 'Space',
            inventory: 'KeyE',
            sprint: 'ShiftLeft',
            crouch: 'ControlLeft',
            toggleHUD: 'KeyP'
        };

        const defaultPreset = 'balanced';

        this.settings = {
            graphicsPreset: defaultPreset,
            cinematicEffects: true,
            shadows: true,
            renderDistance: GRAPHICS_PRESETS[defaultPreset].renderDistance,
            
            // Звук
            masterVolume: 1.0,
            soundEffectsVolume: 1.0,
            musicVolume: 0.5,
            soundEnabled: true,
            
            // Управление
            mouseSensitivity: 1.0,
            fov: 75,
            bobbing: true,
            
            // Время
            timeSpeed: 1.0,
            
            // Атмосфера
            cloudCoverage: 0.20,
            
            // Производительность
            maxFPS: 0,
            chunkLoadSpeed: 2,

            // Клавиши
            keyBindings: { ...this.defaultKeyBindings }
        };
        
        this.loadSettings();
    }

    loadSettings() {
        const saved = localStorage.getItem('voxelEngineSettings');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                if (parsed.keyBindings) {
                    this.settings.keyBindings = {
                        ...this.defaultKeyBindings,
                        ...parsed.keyBindings
                    };
                    delete parsed.keyBindings;
                }
                this.settings = { ...this.settings, ...parsed };
            } catch (e) {
                console.warn('Ошибка загрузки настроек:', e);
            }
        }
    }

    saveSettings() {
        try {
            localStorage.setItem('voxelEngineSettings', JSON.stringify(this.settings));
        } catch (e) {
            console.warn('Ошибка сохранения настроек:', e);
        }
    }

    get(key) {
        return this.settings[key];
    }

    set(key, value) {
        this.settings[key] = value;
        this.saveSettings();
    }

    applyGraphicsPreset(preset) {
        if (!GRAPHICS_PRESETS[preset]) return;
        this.settings.graphicsPreset = preset;
        this.settings.renderDistance = GRAPHICS_PRESETS[preset].renderDistance;
        this.saveSettings();
    }

    getGraphicsPresetName() {
        return GRAPHICS_PRESETS[this.settings.graphicsPreset] ? this.settings.graphicsPreset : 'balanced';
    }

    getGraphicsConfig() {
        const preset = GRAPHICS_PRESETS[this.getGraphicsPresetName()] || GRAPHICS_PRESETS.balanced;
        return {
            ...preset,
            renderDistance: this.settings.renderDistance,
            cinematicEffects: this.settings.cinematicEffects !== false,
            shadows: this.settings.shadows !== false
        };
    }

    getKeyBindings() {
        return { ...this.settings.keyBindings };
    }

    getKeyBinding(action) {
        return this.settings.keyBindings[action] || '';
    }

    setKeyBinding(action, code) {
        this.settings.keyBindings[action] = code;
        this.saveSettings();
    }

    resetKeyBindings() {
        this.settings.keyBindings = { ...this.defaultKeyBindings };
        this.saveSettings();
    }

    applyToRenderer(renderer) {
        if (!renderer) return;
        const graphics = this.getGraphicsConfig();
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, graphics.pixelRatio));
    }

    applyToCamera(camera) {
        camera.fov = this.get('fov');
        camera.updateProjectionMatrix();
    }

    applyToWorld(world) {
        if (world) {
            if (world.config) {
                world.config.RENDER_DISTANCE = this.get('renderDistance');
            }
            if (world.chunkLoadSpeed !== undefined) {
                world.chunkLoadSpeed = this.get('chunkLoadSpeed');
            }
            // Обновляем параметры облаков в материале
            if (world.material && world.material.userData.shader) {
                if (world.material.userData.shader.uniforms.uCloudCoverage) {
                    world.material.userData.shader.uniforms.uCloudCoverage.value = this.get('cloudCoverage');
                }
            }
            const graphics = this.getGraphicsConfig();
            if (typeof world.setAOIntensity === 'function') {
                world.setAOIntensity(graphics.aoIntensity);
            }
        }
    }

    applyToSound(soundManager) {
        if (soundManager) {
            soundManager.setMasterVolume(this.get('masterVolume'));
            soundManager.setSoundEffectsVolume(this.get('soundEffectsVolume'));
            soundManager.setMusicVolume(this.get('musicVolume'));
            soundManager.setEnabled(this.get('soundEnabled'));
        }
    }

    applyToSky(sky) {
        if (sky) {
            // Настройки применяются через uniforms в sky.update()
        }
    }
}
