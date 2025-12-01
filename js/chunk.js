import * as THREE from 'three';
import { WORLD_CONFIG, BLOCK, BLOCKS } from './constants.js';
import { getTerrainHeight } from './noise.js';

const { CHUNK_SIZE, CHUNK_HEIGHT } = WORLD_CONFIG;
const warnedTileMissing = new Set();
const warnedTileMismatch = new Set();
const loggedStats = new Set();


export class Chunk {
    constructor(chunkX, chunkZ, material, world) {
        this.chunkX = chunkX;
        this.chunkZ = chunkZ;
        this.material = material;
        this.world = world;
        this.data = new Uint8Array(CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE);
        this.mesh = null;
        this.generateData();
        this.generateMesh();
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

    // --- FIX: Умная проверка твердости (с учетом соседей) ---
    isSolid(x, y, z) {
        // 1. Если координаты ВНУТРИ текущего чанка - проверяем массив (быстро)
        if (x >= 0 && x < CHUNK_SIZE && z >= 0 && z < CHUNK_SIZE) {
            if (y < 0 || y >= CHUNK_HEIGHT) return false;

            const id = this.data[this._getIndex(x, y, z)];
            // Исправлено: добавлена проверка на существование блока в BLOCKS
            return id !== BLOCK.AIR && BLOCKS[id] && !BLOCKS[id].transparent;
        }

        // 2. Если координаты СНАРУЖИ - спрашиваем у Мира (медленнее, но видит соседей)
        // Переводим локальные координаты (например -1) в глобальные
        const globalX = this.chunkX * CHUNK_SIZE + x;
        const globalZ = this.chunkZ * CHUNK_SIZE + z;

        // world.getBlock сам найдет нужный чанк и спросит у него
        const id = this.world ? this.world.getBlock(globalX, y, globalZ) : BLOCK.AIR;
        // Исправлено: добавлена проверка на существование блока в BLOCKS
        return id !== BLOCK.AIR && BLOCKS[id] && !BLOCKS[id].transparent;
    }

    _getBlockIdWithNeighbors(x, y, z) {
        if (y < 0 || y >= CHUNK_HEIGHT) return BLOCK.AIR;
        if (x >= 0 && x < CHUNK_SIZE && z >= 0 && z < CHUNK_SIZE) {
            return this.data[this._getIndex(x, y, z)];
        }
        if (!this.world) return BLOCK.AIR;
        const globalX = this.chunkX * CHUNK_SIZE + x;
        const globalZ = this.chunkZ * CHUNK_SIZE + z;
        return this.world.getBlock(globalX, y, globalZ);
    }

    _getFaceTile(blockProps, face) {
        if (!blockProps) return null;
        if (face === 'top' && blockProps.atlasTop) return blockProps.atlasTop;
        if (face === 'bottom' && blockProps.atlasBottom) return blockProps.atlasBottom;
        return blockProps.atlas || null;
    }

    _shouldRenderFace(currentId, neighborId) {
        if (currentId === BLOCK.AIR) return false;
        const block = BLOCKS[currentId];
        if (!block) return false;
        const neighbor = BLOCKS[neighborId];
        return !neighbor || neighbor.transparent;
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
                    if (y === 0) id = BLOCK.BEDROCK;
                    else if (y < h - 2) id = BLOCK.STONE;
                    else if (y < h) id = BLOCK.DIRT;
                    else if (y === h) id = BLOCK.GRASS;

                    this.data[this._getIndex(x, y, z)] = id;
                }
            }
        }
    }

    generateMesh() {
        this.dispose();

        const positions = [];
        const normals = [];
        const uvs = [];
        const colors = [];
        const indices = [];
        const tileIndices = [];

        let indexOffset = 0;

        const pushIndices = () => {
            indices.push(indexOffset, indexOffset + 1, indexOffset + 2, indexOffset, indexOffset + 2, indexOffset + 3);
            indexOffset += 4;
        };

        const pushColor = (shade) => {
            const c = shade;
            for (let i = 0; i < 4; i++) {
                colors.push(c, c, c);
            }
        };

        const pushPlaceholderUV = () => {
            for (let i = 0; i < 4; i++) {
                uvs.push(0, 0);
            }
        };

        const pushTileIndex = (tile) => {
            for (let i = 0; i < 4; i++) {
                tileIndices.push(tile[0], tile[1]);
            }
        };

        const appendQuad = (vertexList, normal, tile, shade) => {
            for (const v of vertexList) {
                positions.push(v[0], v[1], v[2]);
            }
            for (let i = 0; i < 4; i++) {
                normals.push(normal[0], normal[1], normal[2]);
            }
            pushPlaceholderUV();
            pushTileIndex(tile);
            pushColor(shade);
            pushIndices();
        };

        const mask2d = new Array(CHUNK_SIZE * CHUNK_SIZE);
        const maskVertical = new Array(CHUNK_SIZE * CHUNK_HEIGHT);

        const cellsEqual = (a, b) => {
            if (!a || !b) return false;
            return a.id === b.id && a.col === b.col && a.row === b.row;
        };

        const greedyMerge = (mask, width, height, emit) => {
            for (let j = 0; j < height; j++) {
                for (let i = 0; i < width;) {
                    const cell = mask[i + j * width];
                    if (!cell) {
                        i++;
                        continue;
                    }

                    let w = 1;
                    while (i + w < width && cellsEqual(cell, mask[i + w + j * width])) w++;

                    let h = 1;
                    outer: for (; j + h < height; h++) {
                        for (let k = 0; k < w; k++) {
                            if (!cellsEqual(cell, mask[i + k + (j + h) * width])) break outer;
                        }
                    }

                    emit(cell, i, j, w, h);

                    for (let y = 0; y < h; y++) {
                        for (let x = 0; x < w; x++) {
                            mask[i + x + (j + y) * width] = null;
                        }
                    }

                    i += w;
                }
            }
        };

        const fillMaskTop = (mask, y) => {
            for (let z = 0; z < CHUNK_SIZE; z++) {
                for (let x = 0; x < CHUNK_SIZE; x++) {
                    const idx = z * CHUNK_SIZE + x;
                    const currentId = this._getBlockIdWithNeighbors(x, y, z);
                    const neighborId = this._getBlockIdWithNeighbors(x, y + 1, z);
                    if (!this._shouldRenderFace(currentId, neighborId)) {
                        mask[idx] = null;
                        continue;
                    }
                    const props = BLOCKS[currentId];
                    const tile = this._getFaceTile(props, 'top');
                    if (!tile) {
                        mask[idx] = null;
                        continue;
                    }
                    mask[idx] = { id: currentId, col: tile[0], row: tile[1] };
                }
            }
        };

        const fillMaskBottom = (mask, y) => {
            for (let z = 0; z < CHUNK_SIZE; z++) {
                for (let x = 0; x < CHUNK_SIZE; x++) {
                    const idx = z * CHUNK_SIZE + x;
                    const currentId = this._getBlockIdWithNeighbors(x, y, z);
                    const neighborId = this._getBlockIdWithNeighbors(x, y - 1, z);
                    if (!this._shouldRenderFace(currentId, neighborId)) {
                        mask[idx] = null;
                        continue;
                    }
                    const props = BLOCKS[currentId];
                    const tile = this._getFaceTile(props, 'bottom');
                    if (!tile) {
                        mask[idx] = null;
                        continue;
                    }
                    mask[idx] = { id: currentId, col: tile[0], row: tile[1] };
                }
            }
        };

        const fillMaskPositiveX = (mask, xPlane) => {
            for (let y = 0; y < CHUNK_HEIGHT; y++) {
                for (let z = 0; z < CHUNK_SIZE; z++) {
                    const idx = y * CHUNK_SIZE + z;
                    const currentId = this._getBlockIdWithNeighbors(xPlane, y, z);
                    const neighborId = this._getBlockIdWithNeighbors(xPlane + 1, y, z);
                    if (!this._shouldRenderFace(currentId, neighborId)) {
                        mask[idx] = null;
                        continue;
                    }
                    const props = BLOCKS[currentId];
                    const tile = this._getFaceTile(props, 'side');
                    if (!tile) {
                        mask[idx] = null;
                        continue;
                    }
                    mask[idx] = { id: currentId, col: tile[0], row: tile[1] };
                }
            }
        };

        const fillMaskNegativeX = (mask, xPlane) => {
            for (let y = 0; y < CHUNK_HEIGHT; y++) {
                for (let z = 0; z < CHUNK_SIZE; z++) {
                    const idx = y * CHUNK_SIZE + z;
                    const currentId = this._getBlockIdWithNeighbors(xPlane, y, z);
                    const neighborId = this._getBlockIdWithNeighbors(xPlane - 1, y, z);
                    if (!this._shouldRenderFace(currentId, neighborId)) {
                        mask[idx] = null;
                        continue;
                    }
                    const props = BLOCKS[currentId];
                    const tile = this._getFaceTile(props, 'side');
                    if (!tile) {
                        mask[idx] = null;
                        continue;
                    }
                    mask[idx] = { id: currentId, col: tile[0], row: tile[1] };
                }
            }
        };

        const fillMaskPositiveZ = (mask, zPlane) => {
            for (let y = 0; y < CHUNK_HEIGHT; y++) {
                for (let x = 0; x < CHUNK_SIZE; x++) {
                    const idx = y * CHUNK_SIZE + x;
                    const currentId = this._getBlockIdWithNeighbors(x, y, zPlane);
                    const neighborId = this._getBlockIdWithNeighbors(x, y, zPlane + 1);
                    if (!this._shouldRenderFace(currentId, neighborId)) {
                        mask[idx] = null;
                        continue;
                    }
                    const props = BLOCKS[currentId];
                    const tile = this._getFaceTile(props, 'side');
                    if (!tile) {
                        mask[idx] = null;
                        continue;
                    }
                    mask[idx] = { id: currentId, col: tile[0], row: tile[1] };
                }
            }
        };

        const fillMaskNegativeZ = (mask, zPlane) => {
            for (let y = 0; y < CHUNK_HEIGHT; y++) {
                for (let x = 0; x < CHUNK_SIZE; x++) {
                    const idx = y * CHUNK_SIZE + x;
                    const currentId = this._getBlockIdWithNeighbors(x, y, zPlane);
                    const neighborId = this._getBlockIdWithNeighbors(x, y, zPlane - 1);
                    if (!this._shouldRenderFace(currentId, neighborId)) {
                        mask[idx] = null;
                        continue;
                    }
                    const props = BLOCKS[currentId];
                    const tile = this._getFaceTile(props, 'side');
                    if (!tile) {
                        mask[idx] = null;
                        continue;
                    }
                    mask[idx] = { id: currentId, col: tile[0], row: tile[1] };
                }
            }
        };

        // --- TOP ---
        for (let y = 0; y < CHUNK_HEIGHT; y++) {
            fillMaskTop(mask2d, y);
            greedyMerge(mask2d, CHUNK_SIZE, CHUNK_SIZE, (cell, startX, startZ, width, height) => {
                const x0 = startX;
                const x1 = startX + width;
                const z0 = startZ;
                const z1 = startZ + height;
                const vy = y + 1;
                appendQuad([
                    [x0, vy, z1],
                    [x1, vy, z1],
                    [x1, vy, z0],
                    [x0, vy, z0]
                ], [0, 1, 0], [cell.col, cell.row], 1.0);
            });
        }

        // --- BOTTOM ---
        for (let y = 0; y < CHUNK_HEIGHT; y++) {
            fillMaskBottom(mask2d, y);
            greedyMerge(mask2d, CHUNK_SIZE, CHUNK_SIZE, (cell, startX, startZ, width, height) => {
                const x0 = startX;
                const x1 = startX + width;
                const z0 = startZ;
                const z1 = startZ + height;
                const vy = y;
                appendQuad([
                    [x0, vy, z0],
                    [x1, vy, z0],
                    [x1, vy, z1],
                    [x0, vy, z1]
                ], [0, -1, 0], [cell.col, cell.row], 0.65);
            });
        }

        // --- +X ---
        for (let x = 0; x < CHUNK_SIZE; x++) {
            fillMaskPositiveX(maskVertical, x);
            greedyMerge(maskVertical, CHUNK_SIZE, CHUNK_HEIGHT, (cell, startZ, startY, width, height) => {
                const z0 = startZ;
                const z1 = startZ + width;
                const y0 = startY;
                const y1 = startY + height;
                const vx = x + 1;
                appendQuad([
                    [vx, y0, z1],
                    [vx, y0, z0],
                    [vx, y1, z0],
                    [vx, y1, z1]
                ], [1, 0, 0], [cell.col, cell.row], 0.85);
            });
        }

        // --- -X ---
        for (let x = 0; x < CHUNK_SIZE; x++) {
            fillMaskNegativeX(maskVertical, x);
            greedyMerge(maskVertical, CHUNK_SIZE, CHUNK_HEIGHT, (cell, startZ, startY, width, height) => {
                const z0 = startZ;
                const z1 = startZ + width;
                const y0 = startY;
                const y1 = startY + height;
                const vx = x;
                appendQuad([
                    [vx, y0, z0],
                    [vx, y0, z1],
                    [vx, y1, z1],
                    [vx, y1, z0]
                ], [-1, 0, 0], [cell.col, cell.row], 0.8);
            });
        }

        // --- +Z ---
        for (let z = 0; z < CHUNK_SIZE; z++) {
            fillMaskPositiveZ(maskVertical, z);
            greedyMerge(maskVertical, CHUNK_SIZE, CHUNK_HEIGHT, (cell, startX, startY, width, height) => {
                const x0 = startX;
                const x1 = startX + width;
                const y0 = startY;
                const y1 = startY + height;
                const vz = z + 1;
                appendQuad([
                    [x0, y0, vz],
                    [x1, y0, vz],
                    [x1, y1, vz],
                    [x0, y1, vz]
                ], [0, 0, 1], [cell.col, cell.row], 0.9);
            });
        }

        // --- -Z ---
        for (let z = 0; z < CHUNK_SIZE; z++) {
            fillMaskNegativeZ(maskVertical, z);
            greedyMerge(maskVertical, CHUNK_SIZE, CHUNK_HEIGHT, (cell, startX, startY, width, height) => {
                const x0 = startX;
                const x1 = startX + width;
                const y0 = startY;
                const y1 = startY + height;
                const vz = z;
                appendQuad([
                    [x1, y0, vz],
                    [x0, y0, vz],
                    [x0, y1, vz],
                    [x1, y1, vz]
                ], [0, 0, -1], [cell.col, cell.row], 0.9);
            });
        }

        if (positions.length === 0) return;

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setAttribute('tileIndex', new THREE.Float32BufferAttribute(tileIndices, 2));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.setIndex(indices);
        geometry.computeBoundingSphere();

        this._validateGeometry(geometry, positions.length / 3, tileIndices.length / 2);

        this.mesh = new THREE.Mesh(geometry, this.material);
        this.mesh.position.set(this.chunkX * CHUNK_SIZE, 0, this.chunkZ * CHUNK_SIZE);
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;
    }

    _validateGeometry(geometry, vertexCount, tileCount) {
        if (!geometry) return;
        const key = `${this.chunkX}:${this.chunkZ}`;
        const tileAttr = geometry.getAttribute('tileIndex');
        const posAttr = geometry.getAttribute('position');

        if (!tileAttr) {
            if (!warnedTileMissing.has(key)) {
                console.warn(`[Chunk ${key}] отсутствует атрибут tileIndex.`, geometry);
                warnedTileMissing.add(key);
            }
            return;
        }

        if (!posAttr) return;

        if (tileAttr.count !== posAttr.count && !warnedTileMismatch.has(key)) {
            console.warn(
                `[Chunk ${key}] tileIndex.count (${tileAttr.count}) != position.count (${posAttr.count}).`,
                { tileAttr, posAttr }
            );
            warnedTileMismatch.add(key);
        }

        if (!loggedStats.has(key)) {
            const firstTile = tileAttr.array.slice(0, 8);
            console.info(
                `[Chunk ${key}] vertices=${vertexCount}, tiles=${tileCount}, firstTile=${Array.from(firstTile)}`
            );
            loggedStats.add(key);
        }
    }
}