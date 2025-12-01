import * as THREE from 'three';
import { WORLD_CONFIG, BLOCK } from './constants.js';
import { Chunk } from './chunk.js';
import { TextureGen } from './texture.js';

export class World {
    constructor(scene) {
        this.scene = scene;
        this.chunks = new Map();
        this.config = WORLD_CONFIG; // Для доступа к настройкам
        this.chunkLoadSpeed = 2; // По умолчанию

        // ИЗМЕНЕНИЕ: Загружаем атлас вместо генерации
        const texture = TextureGen.loadAtlas();

        this.material = new THREE.MeshStandardMaterial({
            map: texture, // Сюда встанет картинка
            side: THREE.DoubleSide,
            alphaTest: 0.1,
            transparent: true,
            roughness: 1.0,
            metalness: 0.0,
            vertexColors: true
        });
        
        // Добавляем кастомные uniforms для теней от облаков
        this.material.onBeforeCompile = (shader) => {
            // Добавляем uniforms
            shader.uniforms.uTime = { value: 0 };
            shader.uniforms.uCloudHeight = { value: 200.0 };
            shader.uniforms.uCloudCoverage = { value: 0.80 }; // Инвертировано: 1.0 - 0.20
            shader.uniforms.uAOIntensity = { value: 0.45 };
            
            // Сохраняем ссылку для обновления
            this.material.userData.shader = shader;
            this.material.userData.aoUniform = shader.uniforms.uAOIntensity;
            
            // VERTEX SHADER: Добавляем varying для мировой позиции
            shader.vertexShader = shader.vertexShader.replace(
                '#include <common>',
                `#include <common>
                varying vec3 vWorldPosition;
                `
            );
            
            shader.vertexShader = shader.vertexShader.replace(
                '#include <worldpos_vertex>',
                `
                vec4 worldPosition = vec4( transformed, 1.0 );
                #ifdef USE_INSTANCING
                    worldPosition = instanceMatrix * worldPosition;
                #endif
                worldPosition = modelMatrix * worldPosition;
                vWorldPosition = worldPosition.xyz;
                `
            );
            
            // FRAGMENT SHADER: Добавляем varying и функции для теней от облаков
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <common>',
                `#include <common>
                
                varying vec3 vWorldPosition;
                uniform float uTime;
                uniform float uCloudHeight;
                uniform float uCloudCoverage;
                uniform float uAOIntensity;
                
                float hash_simple(float n) {
                    return fract(sin(n) * 753.5453123);
                }
                
                float noise_simple(vec3 x) {
                    vec3 p = floor(x);
                    vec3 f = fract(x);
                    f = f * f * (3.0 - 2.0 * f);
                    
                    float n = p.x + p.y * 157.0 + 113.0 * p.z;
                    return mix(
                        mix(
                            mix(hash_simple(n + 0.0), hash_simple(n + 1.0), f.x),
                            mix(hash_simple(n + 157.0), hash_simple(n + 158.0), f.x),
                            f.y
                        ),
                        mix(
                            mix(hash_simple(n + 113.0), hash_simple(n + 114.0), f.x),
                            mix(hash_simple(n + 270.0), hash_simple(n + 271.0), f.x),
                            f.y
                        ),
                        f.z
                    );
                }
                
                float getCloudShadow(vec3 worldPos) {
                    if (worldPos.y > uCloudHeight) return 1.0;
                    
                    vec3 wind_dir = vec3(0.0, 0.0, -uTime * 0.2);
                    vec3 cloudPos = worldPos;
                    cloudPos.y = uCloudHeight + 30.0;
                    
                    vec3 p = cloudPos * 0.003 + wind_dir;
                    
                    float dens = abs(noise_simple(p * 2.032));
                    dens += abs(noise_simple(p * 2.032 * 2.6434)) * 0.5;
                    dens /= 1.5;
                    
                    // Используем настраиваемое покрытие
                    dens = smoothstep(uCloudCoverage, uCloudCoverage + 0.1, dens);
                    
                    // Фиксированная интенсивность теней 60%
                    float cloudShadow = 1.0 - (dens * 0.6);
                    
                    return cloudShadow;
                }
                `
            );

            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <color_fragment>',
                `#include <color_fragment>
                #ifdef USE_COLOR
                    float aoFactor = clamp((vColor.r + vColor.g + vColor.b) * 0.333, 0.0, 1.0);
                    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * aoFactor, uAOIntensity);
                #endif
                `
            );
            
            // Применяем тени от облаков к освещению и усиливаем контраст всех теней
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <lights_fragment_begin>',
                `#include <lights_fragment_begin>
                
                // Применяем тени от облаков к direct light
                float cloudShadow = getCloudShadow(vWorldPosition);
                reflectedLight.directDiffuse *= cloudShadow;
                reflectedLight.directSpecular *= cloudShadow;
                `
            );
            
            // УСИЛИВАЕМ КОНТРАСТ ТЕНЕЙ - уменьшаем ambient свет
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <lights_fragment_end>',
                `#include <lights_fragment_end>
                
                // Уменьшаем ambient свет для более контрастных теней
                reflectedLight.indirectDiffuse *= 0.3;
                `
            );
        };

        this.chunkCoordCache = new THREE.Vector2();
    }

    getChunkKey(cx, cz) {
        return cx + ":" + cz;
    }

    getCellFromPos(x, z) {
        this.chunkCoordCache.set(
            Math.floor(x / WORLD_CONFIG.CHUNK_SIZE),
            Math.floor(z / WORLD_CONFIG.CHUNK_SIZE)
        );
        return this.chunkCoordCache;
    }

    getBlock(x, y, z) {
        const cx = Math.floor(x / WORLD_CONFIG.CHUNK_SIZE);
        const cz = Math.floor(z / WORLD_CONFIG.CHUNK_SIZE);
        const key = this.getChunkKey(cx, cz);

        const chunk = this.chunks.get(key);
        if (!chunk) return BLOCK.AIR;

        const lx = x - cx * WORLD_CONFIG.CHUNK_SIZE;
        const lz = z - cz * WORLD_CONFIG.CHUNK_SIZE;
        return chunk.getBlock(lx, y, lz);
    }

    // Вспомогательный метод для регенерации конкретного чанка
    regenerateChunk(cx, cz) {
        const key = this.getChunkKey(cx, cz);
        const chunk = this.chunks.get(key);
        if (!chunk) return;

        // 1. Удаляем старый меш
        if (chunk.mesh) {
            this.scene.remove(chunk.mesh);
        }

        // 2. Генерируем новый (с учетом новых соседей)
        chunk.generateMesh();

        // 3. Добавляем в сцену
        if (chunk.mesh) {
            this.scene.add(chunk.mesh);
        }
    }

    setBlock(x, y, z, id) {
        const cx = Math.floor(x / WORLD_CONFIG.CHUNK_SIZE);
        const cz = Math.floor(z / WORLD_CONFIG.CHUNK_SIZE);
        const key = this.getChunkKey(cx, cz);

        const chunk = this.chunks.get(key);
        if (!chunk) return;

        const lx = x - cx * WORLD_CONFIG.CHUNK_SIZE;
        const lz = z - cz * WORLD_CONFIG.CHUNK_SIZE;

        // 1. Меняем данные в текущем чанке
        if (chunk.setBlock(lx, y, lz, id)) {

            // 2. Обновляем ТЕКУЩИЙ чанк
            this.regenerateChunk(cx, cz);

            // 3. Обновляем СОСЕДЕЙ, если блок на границе (радиус влияния AO = 1 блок)

            // Левый край -> Обновляем левого соседа
            if (lx === 0) this.regenerateChunk(cx - 1, cz);

            // Правый край -> Обновляем правого соседа
            if (lx === WORLD_CONFIG.CHUNK_SIZE - 1) this.regenerateChunk(cx + 1, cz);

            // Задний край -> Обновляем заднего соседа
            if (lz === 0) this.regenerateChunk(cx, cz - 1);

            // Передний край -> Обновляем переднего соседа
            if (lz === WORLD_CONFIG.CHUNK_SIZE - 1) this.regenerateChunk(cx, cz + 1);
        }
    }

    update(playerPos, time = 0, cloudHeight = 200, cloudCoverage = 0.20) {
        // Обновляем uniforms для теней от облаков
        if (this.material.userData.shader) {
            this.material.userData.shader.uniforms.uTime.value = time;
            this.material.userData.shader.uniforms.uCloudHeight.value = cloudHeight;
            // ИНВЕРТИРУЕМ для соответствия с небом
            this.material.userData.shader.uniforms.uCloudCoverage.value = 1.0 - cloudCoverage;
        }
        
        const pChunk = this.getCellFromPos(playerPos.x, playerPos.z);
        const px = pChunk.x;
        const pz = pChunk.y;
        // Используем renderDistance из настроек, если доступен
        const rd = this.config.RENDER_DISTANCE;

        const validKeys = new Set();
        for (let x = px - rd; x <= px + rd; x++) {
            for (let z = pz - rd; z <= pz + rd; z++) {
                if ((x-px)*(x-px) + (z-pz)*(z-pz) <= rd*rd) {
                    validKeys.add(this.getChunkKey(x, z));
                }
            }
        }

        for (const [key, chunk] of this.chunks) {
            if (!validKeys.has(key)) {
                if(chunk.mesh) this.scene.remove(chunk.mesh);
                chunk.dispose();
                this.chunks.delete(key);
            }
        }

        const pendingChunks = [];
        for (const key of validKeys) {
            if (this.chunks.has(key)) continue;

            const [cx, cz] = key.split(':').map(Number);
            if (isNaN(cx) || isNaN(cz)) {
                console.warn(`Неверный формат ключа чанка: ${key}`);
                continue;
            }

            const dx = cx - px;
            const dz = cz - pz;
            pendingChunks.push({ key, cx, cz, distSq: dx * dx + dz * dz });
        }

        pendingChunks.sort((a, b) => a.distSq - b.distSq);

        let loaded = 0;
        for (const info of pendingChunks) {
            const chunk = new Chunk(info.cx, info.cz, this.material, this);
            this.chunks.set(info.key, chunk);

            if (chunk.mesh) {
                this.scene.add(chunk.mesh);
            }

            loaded++;
            if (loaded >= this.chunkLoadSpeed) break;
        }

        const el = document.getElementById('chunk-count');
        if(el) el.innerText = this.chunks.size;
    }

    setAOIntensity(value) {
        if (this.material && this.material.userData && this.material.userData.aoUniform) {
            this.material.userData.aoUniform.value = value;
        }
    }
}