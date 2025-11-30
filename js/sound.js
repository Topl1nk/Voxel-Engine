import * as THREE from 'three';

export class SoundManager {
    constructor(camera) {
        this.listener = new THREE.AudioListener();
        camera.add(this.listener);

        this.loader = new THREE.AudioLoader();
        this.buffers = new Map();

        // Настройки громкости
        this.masterVolume = 1.0;
        this.soundEffectsVolume = 1.0;
        this.musicVolume = 0.5;
        this.enabled = true;

        // Список файлов для загрузки (пример)
        // В реальности лучше генерировать это список автоматически или грузить лениво
        this.preloadList = [
            'assets/sounds/stone_step.mp3', 'assets/sounds/stone_break.mp3', 'assets/sounds/stone_place.mp3',
            'assets/sounds/grass_step.mp3', 'assets/sounds/grass_break.mp3', 'assets/sounds/grass_place.mp3',
            'assets/sounds/wood_step.mp3',  'assets/sounds/wood_break.mp3',  'assets/sounds/wood_place.mp3',
            'assets/sounds/dirt_step.mp3',  'assets/sounds/dirt_break.mp3',  'assets/sounds/dirt_place.mp3'
        ];

        this.loadSounds();
    }

    loadSounds() {
        this.preloadList.forEach(path => {
            const name = path.split('/').pop().replace('.mp3', ''); // 'stone_step'
            this.loader.load(
                path,
                (buffer) => {
                    this.buffers.set(name, buffer);
                },
                undefined, // onProgress
                (error) => {
                    // Исправлено: добавлена обработка ошибок загрузки звуков
                    console.warn(`Не удалось загрузить звук: ${path}`, error);
                }
            );
        });
    }

    play(soundName, volume = 1.0, detune = true) {
        if (!this.enabled || !this.buffers.has(soundName)) return;

        const sound = new THREE.Audio(this.listener);
        sound.setBuffer(this.buffers.get(soundName));
        
        // Применяем настройки громкости
        const finalVolume = volume * this.masterVolume * this.soundEffectsVolume;
        sound.setVolume(finalVolume);

        // Немного меняем питч, чтобы звук не звучал роботизированно
        if (detune) {
            sound.setDetune((Math.random() - 0.5) * 400);
        }

        sound.play();
    }

    playStep(soundType) {
        if (!soundType) return;
        this.play(soundType.step, 0.3);
    }

    playBreak(soundType) {
        if (!soundType) return;
        this.play(soundType.break, 0.8);
    }

    playPlace(soundType) {
        if (!soundType) return;
        this.play(soundType.place, 0.8);
    }

    // Методы для настроек
    setMasterVolume(value) {
        this.masterVolume = Math.max(0, Math.min(1, value));
    }

    setSoundEffectsVolume(value) {
        this.soundEffectsVolume = Math.max(0, Math.min(1, value));
    }

    setMusicVolume(value) {
        this.musicVolume = Math.max(0, Math.min(1, value));
    }

    setEnabled(value) {
        this.enabled = value;
    }
}
