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

export function getTerrainHeight(gx, gz) {
    // Гарантируем, что высота всегда положительная и целочисленная
    let y = noise(gx * 0.03, gz * 0.03) * 20;
    y += noise(gx * 0.1, gz * 0.1) * 5;
    return Math.floor(Math.max(5, y + 30)); // Минимум 5 блоков высоты
}