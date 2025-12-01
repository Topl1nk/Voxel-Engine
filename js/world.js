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
            side: THREE.FrontSide,
            alphaTest: 0.1,
            transparent: false,
            depthWrite: true,
            roughness: 1.0,
            metalness: 0.0,
            vertexColors: true,
            shadowSide: THREE.FrontSide
        });

        this.shadowCasters = new Set();
        this.customDepthMaterial = this.createDepthMaterial();
        this.customDistanceMaterial = this.createDistanceMaterial();
        this.debugMode = 0;
        this.baseAlphaTest = this.material.alphaTest ?? 0.1;
        
        // Добавляем кастомные uniforms для теней от облаков
        this.material.onBeforeCompile = (shader) => {
            // Добавляем uniforms
            shader.uniforms.uTime = { value: 0 };
            shader.uniforms.uCloudHeight = { value: 200.0 };
            shader.uniforms.uCloudCoverage = { value: 0.80 }; // Инвертировано: 1.0 - 0.20
            shader.uniforms.uAOIntensity = { value: 0.45 };
            shader.uniforms.uAtlasGrid = { value: WORLD_CONFIG.ATLAS_GRID };
            shader.uniforms.uTilePadding = { value: 0.5 / WORLD_CONFIG.ATLAS_SIZE };
            shader.uniforms.uDebugMode = { value: this.debugMode };
            
            // Сохраняем ссылку для обновления
            this.material.userData.shader = shader;
            this.material.userData.aoUniform = shader.uniforms.uAOIntensity;
            this.material.userData.debugUniform = shader.uniforms.uDebugMode;
            this.material.userData.baseAlphaTest = this.baseAlphaTest;
            
            // VERTEX SHADER: Добавляем varying для мировой позиции
            shader.vertexShader = shader.vertexShader.replace(
                '#include <common>',
                `#include <common>
                attribute vec2 tileIndex;
                varying vec2 vTileIndex;
                varying vec3 vWorldPosition;
                varying vec3 vWorldNormal;
                varying vec3 vLocalPosition;
                uniform float uAtlasGrid;
                uniform float uTilePadding;
                uniform int uDebugMode;
                `
            );

            shader.vertexShader = shader.vertexShader.replace(
                '#include <uv_vertex>',
                `#include <uv_vertex>
                vTileIndex = tileIndex;
                `
            );
            
            shader.vertexShader = shader.vertexShader.replace(
                '#include <worldpos_vertex>',
                `
                vec3 localPosition = transformed;
                vec4 worldPosition = vec4( transformed, 1.0 );
                #ifdef USE_INSTANCING
                    worldPosition = instanceMatrix * worldPosition;
                    localPosition = ( instanceMatrix * vec4( localPosition, 1.0 ) ).xyz;
                #endif
                worldPosition = modelMatrix * worldPosition;
                vWorldPosition = worldPosition.xyz;
                vLocalPosition = localPosition;
                
                vec3 worldNormal = normal;
                #ifdef USE_INSTANCING
                    worldNormal = mat3( instanceMatrix ) * worldNormal;
                #endif
                vWorldNormal = normalize( mat3( modelMatrix ) * worldNormal );
                `
            );
            
            // FRAGMENT SHADER: Добавляем varying и функции для теней от облаков
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <common>',
                `#include <common>
                
                varying vec2 vTileIndex;
                varying vec3 vWorldPosition;
                varying vec3 vWorldNormal;
                varying vec3 vLocalPosition;
                uniform float uTime;
                uniform float uCloudHeight;
                uniform float uCloudCoverage;
                uniform float uAOIntensity;
                uniform float uAtlasGrid;
                uniform float uTilePadding;
                uniform int uDebugMode;
                
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
                    return 1.0;
                }
                
                vec2 calcLocalUV(vec3 normal, vec3 pos) {
                    vec3 n = normalize(normal);
                    if (n.y > 0.5) {
                        return vec2(fract(pos.x), fract(pos.z));
                    }
                    if (n.y < -0.5) {
                        vec2 uv = vec2(fract(pos.x), fract(pos.z));
                        uv.y = 1.0 - uv.y;
                        return uv;
                    }
                    if (n.x > 0.5) {
                        vec2 uv = vec2(1.0 - fract(pos.z), fract(pos.y));
                        return uv;
                    }
                    if (n.x < -0.5) {
                        return vec2(fract(pos.z), fract(pos.y));
                    }
                    if (n.z > 0.5) {
                        return vec2(fract(pos.x), fract(pos.y));
                    }
                    vec2 uv = vec2(1.0 - fract(pos.x), fract(pos.y));
                    return uv;
                }
                
                vec2 calcAtlasUV(vec3 normal, vec3 localPos, vec2 tileIndex) {
                    vec2 local = calcLocalUV(normal, localPos);
                    float cell = 1.0 / uAtlasGrid;
                    float uMin = tileIndex.x * cell + uTilePadding;
                    float uMax = (tileIndex.x + 1.0) * cell - uTilePadding;
                    float vMax = 1.0 - (tileIndex.y * cell) - uTilePadding;
                    float vMin = 1.0 - ((tileIndex.y + 1.0) * cell) + uTilePadding;
                    float u = mix(uMin, uMax, clamp(local.x, 0.0, 1.0));
                    float v = mix(vMin, vMax, clamp(local.y, 0.0, 1.0));
                    return vec2(u, v);
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
            
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <map_fragment>',
                `
                #ifdef USE_MAP
                    vec2 atlasUV = calcAtlasUV(vWorldNormal, vLocalPosition, vTileIndex);
                    vec4 texelColor = texture2D(map, atlasUV);
                    diffuseColor *= texelColor;
                #endif
                `
            );
            
            // Применяем тени от облаков к освещению и усиливаем контраст всех теней
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <lights_fragment_begin>',
                `#include <lights_fragment_begin>
                
                float cloudShadow = getCloudShadow(vWorldPosition);
                `
            );
            
            // УСИЛИВАЕМ КОНТРАСТ ТЕНЕЙ - уменьшаем ambient свет
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <lights_fragment_end>',
                `#include <lights_fragment_end>
                
                // Уменьшаем ambient свет для более контрастных теней
            reflectedLight.indirectDiffuse *= 0.85;
            
            if (uDebugMode > 0) {
                vec3 debugColor = vec3(0.0);
                if (uDebugMode == 1) {
                    vec2 normIdx = vTileIndex / uAtlasGrid;
                    debugColor = vec3(normIdx, 0.0);
                } else if (uDebugMode == 2) {
                    vec2 local = calcLocalUV(vWorldNormal, vLocalPosition);
                    debugColor = vec3(local, 0.0);
                } else if (uDebugMode == 3) {
                    vec2 atlasUVDbg = calcAtlasUV(vWorldNormal, vLocalPosition, vTileIndex);
                    debugColor = vec3(atlasUVDbg, 0.0);
                }
                gl_FragColor = vec4(debugColor, 1.0);
                return;
            }
                `
            );
        };

        this.chunkCoordCache = new THREE.Vector2();
    }
    
    registerCaster(mesh) {
        if (!mesh) return;
        this.shadowCasters.add(mesh);
        mesh.customDepthMaterial = this.customDepthMaterial;
        mesh.customDistanceMaterial = this.customDistanceMaterial;
    }
    
    logCasterInfo(limit = 5) {
        const entries = Array.from(this.shadowCasters).slice(0, limit);
        console.table(entries.map((mesh, idx) => ({
            idx,
            castShadow: mesh.castShadow,
            receiveShadow: mesh.receiveShadow,
            visible: mesh.visible,
            position: mesh.position ? mesh.position.toArray().map(v => v.toFixed(2)) : 'n/a'
        })));
    }
    
    createDepthMaterial() {
        const material = new THREE.MeshDepthMaterial({
            depthPacking: THREE.RGBADepthPacking,
            alphaTest: 0.0
        });
        material.onBeforeCompile = (shader) => {
            shader.uniforms.uAtlasGrid = { value: WORLD_CONFIG.ATLAS_GRID };
            shader.uniforms.uTilePadding = { value: 0.5 / WORLD_CONFIG.ATLAS_SIZE };
            shader.vertexShader = shader.vertexShader.replace(
                '#include <common>',
                `#include <common>
                attribute vec2 tileIndex;
                varying vec2 vTileIndex;
                uniform float uAtlasGrid;
                uniform float uTilePadding;
                `
            );
            shader.vertexShader = shader.vertexShader.replace(
                '#include <uv_vertex>',
                `#include <uv_vertex>
                vTileIndex = tileIndex;
                `
            );
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <common>',
                `#include <common>
                varying vec2 vTileIndex;
                uniform float uAtlasGrid;
                uniform float uTilePadding;
                
                vec2 calcLocalUV(vec3 normal, vec3 pos) {
                    vec3 n = normalize(normal);
                    if (n.y > 0.5) {
                        return vec2(fract(pos.x), fract(pos.z));
                    }
                    if (n.y < -0.5) {
                        vec2 uv = vec2(fract(pos.x), fract(pos.z));
                        uv.y = 1.0 - uv.y;
                        return uv;
                    }
                    if (n.x > 0.5) {
                        vec2 uv = vec2(1.0 - fract(pos.z), fract(pos.y));
                        return uv;
                    }
                    if (n.x < -0.5) {
                        return vec2(fract(pos.z), fract(pos.y));
                    }
                    if (n.z > 0.5) {
                        return vec2(fract(pos.x), fract(pos.y));
                    }
                    vec2 uv = vec2(1.0 - fract(pos.x), fract(pos.y));
                    return uv;
                }
                
                vec2 calcAtlasUV(vec2 tileIndex, vec2 local) {
                    float cell = 1.0 / uAtlasGrid;
                    float uMin = tileIndex.x * cell + uTilePadding;
                    float uMax = (tileIndex.x + 1.0) * cell - uTilePadding;
                    float vMax = 1.0 - (tileIndex.y * cell) - uTilePadding;
                    float vMin = 1.0 - ((tileIndex.y + 1.0) * cell) + uTilePadding;
                    float u = mix(uMin, uMax, clamp(local.x, 0.0, 1.0));
                    float v = mix(vMin, vMax, clamp(local.y, 0.0, 1.0));
                    return vec2(u, v);
                }
                `
            );
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <map_fragment>',
                `
                #ifdef USE_UV
                    vec2 local = calcLocalUV(vViewPosition.xyz, vViewPosition.xyz);
                    vec2 atlasUV = calcAtlasUV(vTileIndex, local);
                    vec4 texelColor = texture2D( map, atlasUV );
                    diffuseColor *= texelColor;
                #endif
                `
            );
        };
        material.depthTest = true;
        material.depthWrite = true;
        return material;
    }
    
    createDistanceMaterial() {
        const material = new THREE.MeshDistanceMaterial({
            alphaTest: 0.0
        });
        material.onBeforeCompile = (shader) => {
            shader.uniforms.uAtlasGrid = { value: WORLD_CONFIG.ATLAS_GRID };
            shader.uniforms.uTilePadding = { value: 0.5 / WORLD_CONFIG.ATLAS_SIZE };
            shader.vertexShader = shader.vertexShader.replace(
                '#include <common>',
                `#include <common>
                attribute vec2 tileIndex;
                varying vec2 vTileIndex;
                uniform float uAtlasGrid;
                uniform float uTilePadding;
                `
            );
            shader.vertexShader = shader.vertexShader.replace(
                '#include <uv_vertex>',
                `#include <uv_vertex>
                vTileIndex = tileIndex;
                `
            );
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <common>',
                `#include <common>
                varying vec2 vTileIndex;
                uniform float uAtlasGrid;
                uniform float uTilePadding;
                
                vec2 calcLocalUV(vec3 normal, vec3 pos) {
                    vec3 n = normalize(normal);
                    if (n.y > 0.5) {
                        return vec2(fract(pos.x), fract(pos.z));
                    }
                    if (n.y < -0.5) {
                        vec2 uv = vec2(fract(pos.x), fract(pos.z));
                        uv.y = 1.0 - uv.y;
                        return uv;
                    }
                    if (n.x > 0.5) {
                        vec2 uv = vec2(1.0 - fract(pos.z), fract(pos.y));
                        return uv;
                    }
                    if (n.x < -0.5) {
                        return vec2(fract(pos.z), fract(pos.y));
                    }
                    if (n.z > 0.5) {
                        return vec2(fract(pos.x), fract(pos.y));
                    }
                    vec2 uv = vec2(1.0 - fract(pos.x), fract(pos.y));
                    return uv;
                }
                
                vec2 calcAtlasUV(vec2 tileIndex, vec2 local) {
                    float cell = 1.0 / uAtlasGrid;
                    float uMin = tileIndex.x * cell + uTilePadding;
                    float uMax = (tileIndex.x + 1.0) * cell - uTilePadding;
                    float vMax = 1.0 - (tileIndex.y * cell) - uTilePadding;
                    float vMin = 1.0 - ((tileIndex.y + 1.0) * cell) + uTilePadding;
                    float u = mix(uMin, uMax, clamp(local.x, 0.0, 1.0));
                    float v = mix(vMin, vMax, clamp(local.y, 0.0, 1.0));
                    return vec2(u, v);
                }
                `
            );
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <color_fragment>',
                `
                #ifdef USE_UV
                    vec2 local = calcLocalUV(vViewPosition.xyz, vViewPosition.xyz);
                    vec2 atlasUV = calcAtlasUV(vTileIndex, local);
                    vec4 texelColor = texture2D( map, atlasUV );
                    diffuseColor *= texelColor;
                #endif
                `
            );
        };
        material.depthTest = true;
        material.depthWrite = true;
        return material;
    }

    setDebugMode(mode = 0) {
        this.debugMode = mode;
        const uniform = this.material?.userData?.debugUniform;
        if (uniform) {
            uniform.value = mode;
        }
        const baseAlpha = this.material?.userData?.baseAlphaTest ?? this.baseAlphaTest ?? 0.0;
        const targetAlpha = mode > 0 ? 0.0 : baseAlpha;
        if (this.material && Math.abs(this.material.alphaTest - targetAlpha) > 1e-4) {
            this.material.alphaTest = targetAlpha;
            this.material.needsUpdate = true;
        }
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

    _refreshNeighborChunks(cx, cz) {
        const offsets = [
            [1, 0], [-1, 0], [0, 1], [0, -1]
        ];
        for (const [dx, dz] of offsets) {
            this.regenerateChunk(cx + dx, cz + dz);
        }
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

    update(playerPos, time = 0, cloudHeight = 200, cloudCoverage = 0.20, sunDir = null) {
        // Обновляем uniforms для теней от облаков
        if (this.material.userData.shader) {
            this.material.userData.shader.uniforms.uTime.value = time;
            this.material.userData.shader.uniforms.uCloudHeight.value = cloudHeight;
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
            this._refreshNeighborChunks(info.cx, info.cz);

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