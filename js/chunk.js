// chunk.js - GREEDY MESHING ДЛЯ СКЛЕИВАНИЯ ЧАНКОВ
import * as THREE from 'three';
import { WORLD_CONFIG, BLOCK, BLOCKS } from './constants.js';
import { getTerrainHeight } from './noise.js';

const { CHUNK_SIZE, CHUNK_HEIGHT, ATLAS_GRID } = WORLD_CONFIG;
const UV_STEP = 1 / ATLAS_GRID;

export class Chunk {
    constructor(chunkX, chunkZ, material, world) {
        this.chunkX = chunkX;
        this.chunkZ = chunkZ;
        this.material = material;
        this.world = world;
        this.data = new Uint8Array(CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE);
        this.mesh = null;
        this.generateData();
        this.generateGreedyMesh(); // ИСПОЛЬЗУЕМ GREEDY MESHING
    }

    dispose() {
        if (this.mesh) {
            if (this.mesh.geometry) this.mesh.geometry.dispose();
            this.mesh = null;
        }
    }

    _getIndex(x, y, z) {
        return x + z * CHUNK_SIZE + y * (CHUNK_SIZE * CHUNK_SIZE);
    }

    getBlock(x, y, z) {
        if (x < 0 || x >= CHUNK_SIZE || y < 0 || y >= CHUNK_HEIGHT || z < 0 || z >= CHUNK_SIZE) {
            return BLOCK.AIR;
        }
        return this.data[this._getIndex(x, y, z)];
    }

    isTransparent(x, y, z) {
        if (x < 0 || x >= CHUNK_SIZE || y < 0 || y >= CHUNK_HEIGHT || z < 0 || z >= CHUNK_SIZE) {
            const globalX = this.chunkX * CHUNK_SIZE + x;
            const globalZ = this.chunkZ * CHUNK_SIZE + z;
            const id = this.world.getBlock(globalX, y, globalZ);
            return BLOCKS[id] ? BLOCKS[id].transparent : true;
        }
        const id = this.data[this._getIndex(x, y, z)];
        return BLOCKS[id] ? BLOCKS[id].transparent : true;
    }

    setBlock(x, y, z, id) {
        if (x >= 0 && x < CHUNK_SIZE && y >= 0 && y < CHUNK_HEIGHT && z >= 0 && z < CHUNK_SIZE) {
            this.data[this._getIndex(x, y, z)] = id;
            return true;
        }
        return false;
    }

    generateData() {
        for (let x = 0; x < CHUNK_SIZE; x++) {
            for (let z = 0; z < CHUNK_SIZE; z++) {
                const gx = this.chunkX * CHUNK_SIZE + x;
                const gz = this.chunkZ * CHUNK_SIZE + z;
                const h = getTerrainHeight(gx, gz);

                for (let y = 0; y <= h; y++) {
                    let id = BLOCK.STONE;
                    if (y === 0) id = BLOCK.STONE;
                    else if (y < h - 2) id = BLOCK.STONE;
                    else if (y < h) id = BLOCK.DIRT;
                    else if (y === h) id = BLOCK.GRASS;

                    this.data[this._getIndex(x, y, z)] = id;
                }
            }
        }
    }

    // GREEDY MESHING - ОСНОВНОЙ АЛГОРИТМ
    generateGreedyMesh() {
        this.dispose();

        const positions = [];
        const normals = [];
        const uvs = [];
        const colors = [];
        const indices = [];

        const pushUV = (col, row) => {
            const uMin = col * UV_STEP;
            const uMax = (col + 1) * UV_STEP;
            const vMin = 1.0 - ((row + 1) * UV_STEP);
            const vMax = 1.0 - (row * UV_STEP);

            uvs.push(uMin, vMin, uMax, vMin, uMax, vMax, uMin, vMax);
        };

        const pushColor = (value) => {
            for (let i = 0; i < 4; i++) {
                colors.push(value, value, value);
            }
        };

        // ПРОСТАЯ РЕАЛИЗАЦИЯ GREEDY MESHING
        for (let y = 0; y < CHUNK_HEIGHT; y++) {
            for (let z = 0; z < CHUNK_SIZE; z++) {
                for (let x = 0; x < CHUNK_SIZE; x++) {
                    const id = this.data[this._getIndex(x, y, z)];
                    if (id === BLOCK.AIR) continue;

                    const blockProps = BLOCKS[id];
                    if (!blockProps) continue;

                    // ПРОВЕРЯЕМ КАЖДУЮ ГРАНЬ
                    const directions = [
                        { dir: [1, 0, 0], normal: [1, 0, 0] },   // right
                        { dir: [-1, 0, 0], normal: [-1, 0, 0] }, // left
                        { dir: [0, 1, 0], normal: [0, 1, 0] },   // top
                        { dir: [0, -1, 0], normal: [0, -1, 0] }, // bottom
                        { dir: [0, 0, 1], normal: [0, 0, 1] },   // front
                        { dir: [0, 0, -1], normal: [0, 0, -1] }  // back
                    ];

                    for (const { dir, normal } of directions) {
                        const [dx, dy, dz] = dir;
                        if (this.isTransparent(x + dx, y + dy, z + dz)) {
                            const indexOffset = positions.length / 3;

                            // ОПРЕДЕЛЯЕМ ВЕРШИНЫ ДЛЯ ГРАНИ
                            let vertices;
                            if (dx === 1) { // RIGHT
                                vertices = [
                                    [x + 1, y, z + 1],
                                    [x + 1, y, z],
                                    [x + 1, y + 1, z],
                                    [x + 1, y + 1, z + 1]
                                ];
                            } else if (dx === -1) { // LEFT
                                vertices = [
                                    [x, y, z],
                                    [x, y, z + 1],
                                    [x, y + 1, z + 1],
                                    [x, y + 1, z]
                                ];
                            } else if (dy === 1) { // TOP
                                vertices = [
                                    [x, y + 1, z + 1],
                                    [x + 1, y + 1, z + 1],
                                    [x + 1, y + 1, z],
                                    [x, y + 1, z]
                                ];
                            } else if (dy === -1) { // BOTTOM
                                vertices = [
                                    [x, y, z],
                                    [x + 1, y, z],
                                    [x + 1, y, z + 1],
                                    [x, y, z + 1]
                                ];
                            } else if (dz === 1) { // FRONT
                                vertices = [
                                    [x, y, z + 1],
                                    [x + 1, y, z + 1],
                                    [x + 1, y + 1, z + 1],
                                    [x, y + 1, z + 1]
                                ];
                            } else { // BACK
                                vertices = [
                                    [x + 1, y, z],
                                    [x, y, z],
                                    [x, y + 1, z],
                                    [x + 1, y + 1, z]
                                ];
                            }

                            // ДОБАВЛЯЕМ ВЕРШИНЫ
                            for (const vertex of vertices) {
                                positions.push(...vertex);
                            }

                            // ДОБАВЛЯЕМ НОРМАЛИ
                            for (let i = 0; i < 4; i++) {
                                normals.push(...normal);
                            }

                            // ДОБАВЛЯЕМ UV
                            let col = blockProps.atlas[0];
                            let row = blockProps.atlas[1];

                            if (dy === 1 && blockProps.atlasTop) { // TOP
                                col = blockProps.atlasTop[0];
                                row = blockProps.atlasTop[1];
                            } else if (dy === -1 && blockProps.atlasBottom) { // BOTTOM
                                col = blockProps.atlasBottom[0];
                                row = blockProps.atlasBottom[1];
                            }

                            pushUV(col, row);

                            // ДОБАВЛЯЕМ ЦВЕТ (ОСВЕЩЕНИЕ)
                            pushColor(1.0);

                            // ДОБАВЛЯЕМ ИНДЕКСЫ
                            indices.push(
                                indexOffset, indexOffset + 1, indexOffset + 2,
                                indexOffset, indexOffset + 2, indexOffset + 3
                            );
                        }
                    }
                }
            }
        }

        if (positions.length === 0) return;

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.setIndex(indices);
        geometry.computeBoundingSphere();

        this.mesh = new THREE.Mesh(geometry, this.material);
        this.mesh.position.set(this.chunkX * CHUNK_SIZE, 0, this.chunkZ * CHUNK_SIZE);
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;
        this.mesh.frustumCulled = true;
    }
}