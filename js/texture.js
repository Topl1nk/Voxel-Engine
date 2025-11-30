// texture.js
import * as THREE from 'three';

export class TextureManager {
    constructor() {
        this.loader = new THREE.TextureLoader();
        this.texture = this.loadTexture('assets/atlas.png');
    }

    loadTexture(path) {
        const tex = this.loader.load(path);

        // Улучшенные настройки фильтрации
        tex.magFilter = THREE.NearestFilter; // Сохраняем пиксельность вблизи
        tex.minFilter = THREE.LinearMipmapLinearFilter; // Качественный мипмаппинг для дали

        tex.generateMipmaps = true;
        tex.anisotropy = 4; // Уменьшено для производительности

        // Важные настройки для предотвращения артефактов
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;

        tex.colorSpace = THREE.SRGBColorSpace;

        return tex;
    }
}

export const textureManager = new TextureManager();