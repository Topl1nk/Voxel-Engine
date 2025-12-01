import * as THREE from 'three';

export class TextureGen {
    static loadAtlas() { // Переименовали метод в loadAtlas
        const loader = new THREE.TextureLoader();

        // Укажите правильный путь к вашему файлу
        const texture = loader.load(
            './assets/atlas.png',
            () => {
                texture.needsUpdate = true;
                console.info('[TextureGen] Атлас успешно загружен');
            },
            undefined, // onProgress
            (error) => {
                console.error('Не удалось загрузить текстуру атласа:', error);
            }
        );

        texture.generateMipmaps = false;
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.anisotropy = 0;
        return texture;
    }
}