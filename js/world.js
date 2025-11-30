// world.js - ОБНОВЛЕННЫЙ ДЛЯ GREEDY MESHING
import * as THREE from 'three';
import { WORLD_CONFIG, BLOCK } from './constants.js';
import { Chunk } from './chunk.js';
import { textureManager } from './texture.js';

export class World {
    constructor(scene) {
        this.scene = scene;
        this.chunks = new Map();

        const texture = textureManager.texture;

        // МАТЕРИАЛ ДЛЯ GREEDY MESHING
        this.material = new THREE.MeshStandardMaterial({
            map: texture,
            side: THREE.FrontSide,
            transparent: false,
            alphaTest: 0.1,
            roughness: 1.0,
            metalness: 0.0,
            vertexColors: true,
            flatShading: false
        });

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

    regenerateChunk(cx, cz) {
        const key = this.getChunkKey(cx, cz);
        const chunk = this.chunks.get(key);
        if (!chunk) return;

        if (chunk.mesh) {
            this.scene.remove(chunk.mesh);
            if (chunk.mesh.geometry) chunk.mesh.geometry.dispose();
        }

        chunk.generateGreedyMesh();

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

        if (chunk.setBlock(lx, y, lz, id)) {
            this.regenerateChunk(cx, cz);
            if (lx === 0) this.regenerateChunk(cx - 1, cz);
            if (lx === WORLD_CONFIG.CHUNK_SIZE - 1) this.regenerateChunk(cx + 1, cz);
            if (lz === 0) this.regenerateChunk(cx, cz - 1);
            if (lz === WORLD_CONFIG.CHUNK_SIZE - 1) this.regenerateChunk(cx, cz + 1);
        }
    }

    update(playerPos) {
        const pChunk = this.getCellFromPos(playerPos.x, playerPos.z);
        const px = pChunk.x;
        const pz = pChunk.y;
        const rd = WORLD_CONFIG.RENDER_DISTANCE;

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

        let loaded = 0;
        for (const key of validKeys) {
            if (!this.chunks.has(key)) {
                const [cx, cz] = key.split(':').map(Number);
                const chunk = new Chunk(cx, cz, this.material, this);
                this.chunks.set(key, chunk);

                if (chunk.mesh) {
                    this.scene.add(chunk.mesh);
                }

                loaded++;
                if (loaded > 2) break;
            }
        }

        if (this.ui && this.ui.chunks) {
            this.ui.chunks.textContent = this.chunks.size;
        }
    }
}