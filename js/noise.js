// NOISE UTILS
export function hash(x, z) {
    let n = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
    return n - Math.floor(n);
}

export function noise(x, z) {
    const floorX = Math.floor(x);
    const floorZ = Math.floor(z);

    const s = hash(floorX, floorZ);
    const t = hash(floorX + 1, floorZ);
    const u = hash(floorX, floorZ + 1);
    const v = hash(floorX + 1, floorZ + 1);

    const fractX = x - floorX;
    const fractZ = z - floorZ;

    const i1 = s + (t - s) * fractX;
    const i2 = u + (v - u) * fractX;

    return i1 + (i2 - i1) * fractZ;
}

// 3D шум для объемных облаков
export function hash3d(x, y, z) {
    let n = Math.sin(x * 12.9898 + y * 78.233 + z * 45.164) * 43758.5453;
    return n - Math.floor(n);
}

export function noise3d(x, y, z) {
    const floorX = Math.floor(x);
    const floorY = Math.floor(y);
    const floorZ = Math.floor(z);

    // 8 углов куба
    const c000 = hash3d(floorX, floorY, floorZ);
    const c001 = hash3d(floorX, floorY, floorZ + 1);
    const c010 = hash3d(floorX, floorY + 1, floorZ);
    const c011 = hash3d(floorX, floorY + 1, floorZ + 1);
    const c100 = hash3d(floorX + 1, floorY, floorZ);
    const c101 = hash3d(floorX + 1, floorY, floorZ + 1);
    const c110 = hash3d(floorX + 1, floorY + 1, floorZ);
    const c111 = hash3d(floorX + 1, floorY + 1, floorZ + 1);

    const fractX = x - floorX;
    const fractY = y - floorY;
    const fractZ = z - floorZ;

    // Трилинейная интерполяция
    const i00 = c000 + (c100 - c000) * fractX;
    const i01 = c001 + (c101 - c001) * fractX;
    const i10 = c010 + (c110 - c010) * fractX;
    const i11 = c011 + (c111 - c011) * fractX;

    const i0 = i00 + (i10 - i00) * fractY;
    const i1 = i01 + (i11 - i01) * fractY;

    return i0 + (i1 - i0) * fractZ;
}

export function getTerrainHeight(gx, gz) {
    // Гарантируем, что высота всегда положительная и целочисленная
    let y = noise(gx * 0.03, gz * 0.03) * 20;
    y += noise(gx * 0.1, gz * 0.1) * 5;
    return Math.floor(Math.max(5, y + 30)); // Минимум 5 блоков высоты
}