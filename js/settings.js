// Система настроек игры
export class SettingsManager {
    constructor() {
        this.settings = {
            // Графика
            antialiasing: false,
            shadows: true,
            shadowQuality: 2, // 0 = low, 1 = medium, 2 = high
            renderDistance: 6,
            fogEnabled: true,
            vsync: false,
            pixelRatio: 2,
            
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
            timeSpeed: 1.0, // Скорость времени (1.0 = нормальная)
            
            // Облака
            cloudCoverage: 0.20, // Покрытие облаками (0.0 - 1.0)
            
            // Производительность
            maxFPS: 0, // 0 = unlimited
            chunkLoadSpeed: 2
        };
        
        this.loadSettings();
    }

    loadSettings() {
        const saved = localStorage.getItem('voxelEngineSettings');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
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

    applyToRenderer(renderer) {
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.get('pixelRatio')));
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
