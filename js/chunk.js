import * as THREE from 'three';
import { WORLD_CONFIG, BLOCK, BLOCKS } from './constants.js';
import { getTerrainHeight } from './noise.js';

const { CHUNK_SIZE, CHUNK_HEIGHT, ATLAS_GRID } = WORLD_CONFIG;

// ШАГ СЕТКИ: 1 / 16 = 0.0625
const UV_STEP = 1 / ATLAS_GRID;
const EPS = 0.0001; // Маленький отступ, чтобы убрать швы между тайлами

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
        const id = this.world.getBlock(globalX, y, globalZ);
        // Исправлено: добавлена проверка на существование блока в BLOCKS
        return id !== BLOCK.AIR && BLOCKS[id] && !BLOCKS[id].transparent;
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

        const pushUV = (col, row) => {
            const uMin = col * UV_STEP + EPS;
            const uMax = (col + 1) * UV_STEP - EPS;
            const vMin = 1.0 - ((row + 1) * UV_STEP) + EPS;
            const vMax = 1.0 - (row * UV_STEP) - EPS;
            uvs.push(uMin, vMin, uMax, vMin, uMax, vMax, uMin, vMax);
        };

        const calculateAO = (side1, side2, corner) => {
            let occlusion = 0;
            if (side1) occlusion++;
            if (side2) occlusion++;
            if (corner) occlusion++;
            if (side1 && side2) occlusion = 3;
            switch(occlusion) {
                case 0: return 1.0;
                case 1: return 0.85;
                case 2: return 0.70;
                case 3: return 0.55;
                default: return 1.0;
            }
        };

        const pushColor = (c1, c2, c3, c4) => {
            colors.push(c1, c1, c1,  c2, c2, c2,  c3, c3, c3,  c4, c4, c4);
        };

        let indexOffset = 0;

        for (let y = 0; y < CHUNK_HEIGHT; y++) {
            for (let z = 0; z < CHUNK_SIZE; z++) {
                for (let x = 0; x < CHUNK_SIZE; x++) {
                    const id = this.data[this._getIndex(x, y, z)];
                    if (id === BLOCK.AIR) continue;

                    const blockProps = BLOCKS[id];
                    if (!blockProps) continue;

                    // Базовые координаты (для боков)
                    // Используем .atlas (как договорились в constants.js)
                    // Если у вас там .uv, поменяйте здесь на .uv
                    let col = blockProps.atlas[0];
                    let row = blockProps.atlas[1];

                    const isSolid = (dx, dy, dz) => this.isSolid(x + dx, y + dy, z + dz);

                    // --- TOP FACE (+Y) ---
                    if (this.isTransparent(x, y + 1, z)) {
                        positions.push(x, y + 1, z + 1,  x + 1, y + 1, z + 1,  x + 1, y + 1, z,  x, y + 1, z);
                        normals.push(0, 1, 0,  0, 1, 0,  0, 1, 0,  0, 1, 0);

                        // ЛОГИКА ТЕКСТУР:
                        // Если в конфиге есть atlasTop, берем его. Иначе берем стандартный atlas.
                        let topCol = blockProps.atlasTop ? blockProps.atlasTop[0] : col;
                        let topRow = blockProps.atlasTop ? blockProps.atlasTop[1] : row;

                        pushUV(topCol, topRow);

                        const nN = isSolid(0, 1, -1);
                        const nS = isSolid(0, 1, 1);
                        const nE = isSolid(1, 1, 0);
                        const nW = isSolid(-1, 1, 0);
                        const nNE = isSolid(1, 1, -1);
                        const nNW = isSolid(-1, 1, -1);
                        const nSE = isSolid(1, 1, 1);
                        const nSW = isSolid(-1, 1, 1);
                        pushColor(calculateAO(nW, nS, nSW), calculateAO(nE, nS, nSE), calculateAO(nE, nN, nNE), calculateAO(nW, nN, nNW));

                        indices.push(indexOffset, indexOffset + 1, indexOffset + 2, indexOffset, indexOffset + 2, indexOffset + 3);
                        indexOffset += 4;
                    }

                    // --- BOTTOM FACE (-Y) ---
                    if (this.isTransparent(x, y - 1, z)) {
                        positions.push(x, y, z,  x + 1, y, z,  x + 1, y, z + 1,  x, y, z + 1);
                        normals.push(0, -1, 0,  0, -1, 0,  0, -1, 0,  0, -1, 0);

                        // ЛОГИКА ТЕКСТУР:
                        let botCol = blockProps.atlasBottom ? blockProps.atlasBottom[0] : col;
                        let botRow = blockProps.atlasBottom ? blockProps.atlasBottom[1] : row;

                        pushUV(botCol, botRow);

                        pushColor(0.7, 0.7, 0.7, 0.7);
                        indices.push(indexOffset, indexOffset + 1, indexOffset + 2, indexOffset, indexOffset + 2, indexOffset + 3);
                        indexOffset += 4;
                    }

                    // --- RIGHT (+X) ---
                    if (this.isTransparent(x + 1, y, z)) {
                        positions.push(x + 1, y, z + 1,  x + 1, y, z,  x + 1, y + 1, z,  x + 1, y + 1, z + 1);
                        normals.push(1, 0, 0,  1, 0, 0,  1, 0, 0,  1, 0, 0);
                        pushUV(col, row); // Используем стандартные (боковые)

                        const nD=isSolid(1,-1,0), nU=isSolid(1,1,0), nF=isSolid(1,0,1), nB=isSolid(1,0,-1);
                        const nDF=isSolid(1,-1,1), nDB=isSolid(1,-1,-1), nUF=isSolid(1,1,1), nUB=isSolid(1,1,-1);
                        pushColor(calculateAO(nF,nD,nDF), calculateAO(nB,nD,nDB), calculateAO(nB,nU,nUB), calculateAO(nF,nU,nUF));

                        indices.push(indexOffset, indexOffset + 1, indexOffset + 2, indexOffset, indexOffset + 2, indexOffset + 3);
                        indexOffset += 4;
                    }

                    // --- LEFT (-X) ---
                    if (this.isTransparent(x - 1, y, z)) {
                        positions.push(x, y, z,  x, y, z + 1,  x, y + 1, z + 1,  x, y + 1, z);
                        normals.push(-1, 0, 0,  -1, 0, 0,  -1, 0, 0,  -1, 0, 0);
                        pushUV(col, row);

                        const nD=isSolid(-1,-1,0), nU=isSolid(-1,1,0), nF=isSolid(-1,0,1), nB=isSolid(-1,0,-1);
                        const nDF=isSolid(-1,-1,1), nDB=isSolid(-1,-1,-1), nUF=isSolid(-1,1,1), nUB=isSolid(-1,1,-1);
                        pushColor(calculateAO(nB,nD,nDB), calculateAO(nF,nD,nDF), calculateAO(nF,nU,nUF), calculateAO(nB,nU,nUB));

                        indices.push(indexOffset, indexOffset + 1, indexOffset + 2, indexOffset, indexOffset + 2, indexOffset + 3);
                        indexOffset += 4;
                    }

                    // --- FRONT (+Z) ---
                    if (this.isTransparent(x, y, z + 1)) {
                        positions.push(x, y, z + 1,  x + 1, y, z + 1,  x + 1, y + 1, z + 1,  x, y + 1, z + 1);
                        normals.push(0, 0, 1,  0, 0, 1,  0, 0, 1,  0, 0, 1);
                        pushUV(col, row);

                        const nD=isSolid(0,-1,1), nU=isSolid(0,1,1), nL=isSolid(-1,0,1), nR=isSolid(1,0,1);
                        const nDL=isSolid(-1,-1,1), nDR=isSolid(1,-1,1), nUL=isSolid(-1,1,1), nUR=isSolid(1,1,1);
                        pushColor(calculateAO(nL,nD,nDL), calculateAO(nR,nD,nDR), calculateAO(nR,nU,nUR), calculateAO(nL,nU,nUL));

                        indices.push(indexOffset, indexOffset + 1, indexOffset + 2, indexOffset, indexOffset + 2, indexOffset + 3);
                        indexOffset += 4;
                    }

                    // --- BACK (-Z) ---
                    if (this.isTransparent(x, y, z - 1)) {
                        positions.push(x + 1, y, z,  x, y, z,  x, y + 1, z,  x + 1, y + 1, z);
                        normals.push(0, 0, -1,  0, 0, -1,  0, 0, -1,  0, 0, -1);
                        pushUV(col, row);

                        const nD=isSolid(0,-1,-1), nU=isSolid(0,1,-1), nL=isSolid(-1,0,-1), nR=isSolid(1,0,-1);
                        const nDL=isSolid(-1,-1,-1), nDR=isSolid(1,-1,-1), nUL=isSolid(-1,1,-1), nUR=isSolid(1,1,-1);
                        pushColor(calculateAO(nR,nD,nDR), calculateAO(nL,nD,nDL), calculateAO(nL,nU,nUL), calculateAO(nR,nU,nUR));

                        indices.push(indexOffset, indexOffset + 1, indexOffset + 2, indexOffset, indexOffset + 2, indexOffset + 3);
                        indexOffset += 4;
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
    }

    isTransparent(x, y, z) {
        if (x < 0 || x >= CHUNK_SIZE || y < 0 || y >= CHUNK_HEIGHT || z < 0 || z >= CHUNK_SIZE) return true;
        const id = this.data[this._getIndex(x, y, z)];
        return BLOCKS[id] ? BLOCKS[id].transparent : true;
    }
}