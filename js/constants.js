export const WORLD_CONFIG = {
    CHUNK_SIZE: 16,
    CHUNK_HEIGHT: 128,
    RENDER_DISTANCE: 6,
    TILE_SIZE: 64,
    ATLAS_SIZE: 1024,
    ATLAS_GRID: 16,
    GRAVITY: 28.0,
    PLAYER_SPEED: 10.0,
    JUMP_STRENGTH: 10.0
};

// SOUND_TYPES удален. Теперь настройки индивидуальны.

export const BLOCK_DATA = [
    { 
        id: 0, name: 'Air', 
        atlas: [0, 0], 
        transparent: true, 
        solid: false, 
        sound: null
    },
    { 
        id: 1, name: 'Stone', 
        atlas: [0, 1], 
        atlasBottom: [0, 1], 
        transparent: false, 
        solid: true, 
        sound: { step: 'stone_step', break: 'stone_break', place: 'stone_place' }
    },
    { 
        id: 2, name: 'Dirt', 
        atlas: [1, 1], 
        atlasBottom: [1, 1], 
        transparent: false, 
        solid: true, 
        sound: { step: 'dirt_step', break: 'dirt_break', place: 'dirt_place' }
    },
    { 
        id: 3, name: 'Grass', 
        atlas: [2, 1], 
        atlasTop: [3, 1], 
        atlasBottom: [1, 1], 
        transparent: false, 
        solid: true, 
        sound: { step: 'grass_step', break: 'grass_break', place: 'grass_place' }
    },
    { 
        id: 4, name: 'Planks', 
        atlas: [1, 2], 
        transparent: false, 
        solid: true, 
        sound: { step: 'wood_step', break: 'wood_break', place: 'wood_place' }
    },
    { 
        id: 6, name: 'Glass', 
        atlas: [9, 4], 
        transparent: true, 
        solid: true, 
        sound: { step: 'stone_step', break: 'stone_break', place: 'stone_place' }
    },
    { 
        id: 12, name: 'Log', 
        atlas: [8, 1], 
        atlasTop: [8, 0], 
        atlasBottom: [8, 0], 
        transparent: false, 
        solid: true, 
        sound: { step: 'wood_step', break: 'wood_break', place: 'wood_place' }
    },
    { 
        id: 13, name: 'Leaves', 
        atlas: [9, 1], 
        transparent: true, 
        solid: true, 
        sound: { step: 'grass_step', break: 'grass_break', place: 'grass_place' }
    },
];

export const BLOCKS = {};
BLOCK_DATA.forEach(b => BLOCKS[b.id] = b);

export const BLOCK = {
    AIR: 0, STONE: 1, DIRT: 2, GRASS: 3, PLANKS: 4,
    GLASS: 6, LOG: 12, LEAVES: 13
};