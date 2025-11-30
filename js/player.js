import * as THREE from 'three';
import { WORLD_CONFIG, BLOCK, BLOCKS } from './constants.js';

export class Player {
    // 1. Принимаем soundManager и settings в конструкторе
    constructor(camera, domElement, world, soundManager, settings) {
        this.camera = camera;
        this.world = world;
        this.domElement = domElement;
        this.soundManager = soundManager; // Сохраняем ссылку
        this.settings = settings;

        // --- PHYSICS CONFIG ---
        this.position = new THREE.Vector3(10, 80, 10);
        this.velocity = new THREE.Vector3();
        this.direction = new THREE.Vector3();

        this.speed = WORLD_CONFIG.PLAYER_SPEED;
        this.jumpForce = WORLD_CONFIG.JUMP_STRENGTH;
        this.gravity = WORLD_CONFIG.GRAVITY;

        // Размеры хитбокса
        this.height = 1.8;
        this.cameraHeight = 1.6;
        this.radius = 0.3;

        // Настройки из менеджера настроек
        this.mouseSensitivity = settings ? settings.get('mouseSensitivity') : 1.0;
        this.bobbingEnabled = settings ? settings.get('bobbing') : true;
        this.bobTime = 0;
        this.bobAmount = 0.08; // УВЕЛИЧЕНА АМПЛИТУДА для размашистого движения
        this.lastBobY = 0;
        this.lastBobX = 0;

        // State
        this.moveState = { f: 0, b: 0, l: 0, r: 0 };
        this.yaw = 0;
        this.pitch = 0;
        this.onGround = false;

        // ЗВУКИ: Переменные для шагов
        this.stepDistance = 0;
        this.STEP_INTERVAL = 2.5; // Звук каждые 2.5 метра

        // Inventory
        this.selectedSlot = 0;
        // Хотбар: убран несуществующий блок 8
        this.hotbar = [1, 2, 3, 4, 6, 12, 13];

        this._tempVec = new THREE.Vector3();
        this._tempVec2 = new THREE.Vector3();

        this.setupInput();
        this.setupUI();
        this.initSelectionBox();
    }

    initSelectionBox() {
        const geometry = new THREE.BoxGeometry(1.001, 1.001, 1.001);
        const material = new THREE.LineBasicMaterial({ color: 0x000000 });
        this.selectionBox = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), material);
        this.selectionBox.visible = false;
        // World имеет свойство scene, которое устанавливается в конструкторе
        this.world.scene.add(this.selectionBox);
        this.targetBlock = null;
    }

    setupUI() {
        const hotbar = document.getElementById('hotbar');
        if (!hotbar) return;
        hotbar.innerHTML = '';
        this.hotbar.forEach((id, i) => {
            const div = document.createElement('div');
            div.className = `slot ${i === 0 ? 'active' : ''}`;
            const color = BLOCKS[id] ? BLOCKS[id].color : '#fff'; // Fallback если нет цвета

            // Если у блока есть текстура в атласе, можно бы показывать её,
            // но пока оставим цвет для простоты UI
            div.innerHTML = `<span>${i+1}</span><div class="block-preview" style="background:${color || '#ccc'}"></div>`;
            hotbar.appendChild(div);
        });
    }

    setupInput() {
        document.addEventListener('keydown', e => {
            // Исправлено: предотвращаем стандартное поведение для игровых клавиш
            switch(e.code) {
                case 'KeyW': 
                    e.preventDefault();
                    this.moveState.f = 1; 
                    break;
                case 'KeyS': 
                    e.preventDefault();
                    this.moveState.b = 1; 
                    break;
                case 'KeyA': 
                    e.preventDefault();
                    this.moveState.l = 1; 
                    break;
                case 'KeyD': 
                    e.preventDefault();
                    this.moveState.r = 1; 
                    break;
                case 'Space':
                    e.preventDefault(); // Исправлено: предотвращаем прокрутку страницы
                    if(this.onGround) {
                        this.velocity.y = this.jumpForce;
                        this.onGround = false;
                    }
                    break;
                default:
                    if(e.key >= '1' && e.key <= '9') {
                        e.preventDefault();
                        this.selectedSlot = parseInt(e.key) - 1;
                        if(this.selectedSlot >= this.hotbar.length) this.selectedSlot = this.hotbar.length - 1;
                        this.updateUI();
                    }
            }
        });

        document.addEventListener('keyup', e => {
            switch(e.code) {
                case 'KeyW': this.moveState.f = 0; break;
                case 'KeyS': this.moveState.b = 0; break;
                case 'KeyA': this.moveState.l = 0; break;
                case 'KeyD': this.moveState.r = 0; break;
            }
        });

        document.addEventListener('mousemove', e => {
            if (document.pointerLockElement === this.domElement) {
                // Используем настройку чувствительности мыши
                const sensitivity = 0.002 * this.mouseSensitivity;
                this.yaw -= e.movementX * sensitivity;
                this.pitch -= e.movementY * sensitivity;
                this.pitch = Math.max(-1.57, Math.min(1.57, this.pitch));
                this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
            }
        });

        // Исправлено: предотвращаем контекстное меню при ПКМ
        document.addEventListener('contextmenu', e => {
            if (document.pointerLockElement === this.domElement) {
                e.preventDefault();
            }
        });

        document.addEventListener('mousedown', e => {
            if (document.pointerLockElement !== this.domElement) return;
            if (!this.targetBlock) return;

            // Получаем инфо о блоке, который ломаем (для звука)
            const breakId = this.world.getBlock(this.targetBlock.x, this.targetBlock.y, this.targetBlock.z);
            const breakProps = BLOCKS[breakId];

            if (e.button === 0) { // ЛКМ - Ломать
                e.preventDefault(); // Исправлено: предотвращаем стандартное поведение
                this.world.setBlock(this.targetBlock.x, this.targetBlock.y, this.targetBlock.z, BLOCK.AIR);

                // 2. Играем звук ломания
                if (breakProps && breakProps.sound && this.soundManager) {
                    this.soundManager.playBreak(breakProps.sound);
                }

            } else if (e.button === 2) { // ПКМ - Ставить
                e.preventDefault(); // Исправлено: предотвращаем контекстное меню
                const {x, y, z} = this.targetBlock;
                const {x: nx, y: ny, z: nz} = this.targetBlock.normal;

                const bx = x + nx, by = y + ny, bz = z + nz;
                const px = this.position.x, py = this.position.y, pz = this.position.z;

                // Проверка: Игрок vs Блок (чтобы не застрять)
                if (!(px + this.radius > bx && px - this.radius < bx + 1 &&
                      py + this.height > by && py < by + 1 &&
                      pz + this.radius > bz && pz - this.radius < bz + 1)) {

                    const placeId = this.hotbar[this.selectedSlot] || BLOCK.STONE;
                    this.world.setBlock(bx, by, bz, placeId);

                    // 3. Играем звук установки
                    const placeProps = BLOCKS[placeId];
                    if (placeProps && placeProps.sound && this.soundManager) {
                        this.soundManager.playPlace(placeProps.sound);
                    }
                }
            }
        });
    }

    updateUI() {
        const slots = document.querySelectorAll('.slot');
        slots.forEach((s, i) => {
             s.classList.toggle('active', i === this.selectedSlot);
        });
        const nameEl = document.getElementById('block-name');
        const blockId = this.hotbar[this.selectedSlot];
        if(nameEl && BLOCKS[blockId]) nameEl.innerText = BLOCKS[blockId].name;
    }

    // AABB Physics
    checkCollision(pos) {
        const x = pos.x;
        const y = pos.y;
        const z = pos.z;
        const r = this.radius;
        const h = this.height;

        const minX = Math.floor(x - r);
        const maxX = Math.floor(x + r);
        const minY = Math.floor(y);
        const maxY = Math.floor(y + h);
        const minZ = Math.floor(z - r);
        const maxZ = Math.floor(z + r);

        for (let bx = minX; bx <= maxX; bx++) {
            for (let by = minY; by <= maxY; by++) {
                for (let bz = minZ; bz <= maxZ; bz++) {
                    const block = this.world.getBlock(bx, by, bz);
                    // Унифицированная проверка: используем ту же логику, что и в chunk.js
                    if (block !== BLOCK.AIR && BLOCKS[block] && !BLOCKS[block].transparent) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    update(dt) {
        // Физика
        this.velocity.y -= this.gravity * dt;

        const forward = this.moveState.f - this.moveState.b;
        const strafe = this.moveState.r - this.moveState.l;

        this.direction.set(0, 0, 0);
        if (forward || strafe) {
            const tempFwd = this._tempVec.set(0, 0, -1).applyAxisAngle(new THREE.Vector3(0,1,0), this.yaw);
            const tempRight = this._tempVec2.set(1, 0, 0).applyAxisAngle(new THREE.Vector3(0,1,0), this.yaw);

            this.direction.addScaledVector(tempFwd, forward);
            this.direction.addScaledVector(tempRight, strafe);
            this.direction.normalize().multiplyScalar(this.speed);
        }

        this.velocity.x = this.direction.x;
        this.velocity.z = this.direction.z;

        const originalPos = this.position.clone();

        // X
        this.position.x += this.velocity.x * dt;
        if (this.checkCollision(this.position)) this.position.x = originalPos.x;

        // Z
        this.position.z += this.velocity.z * dt;
        if (this.checkCollision(this.position)) this.position.z = originalPos.z;

        // Y
        this.position.y += this.velocity.y * dt;
        if (this.checkCollision(this.position)) {
            if (this.velocity.y < 0) {
                this.position.y = Math.floor(originalPos.y);
                this.onGround = true;
                this.velocity.y = 0;
                if (this.checkCollision(this.position)) this.position.y += 0.01;
            }
            else if (this.velocity.y > 0) {
                this.position.y = originalPos.y;
                this.velocity.y = 0;
            }
        } else {
            this.onGround = false;
        }

        if (this.position.y < -50) {
            this.position.set(0, 100, 0);
            this.velocity.set(0, 0, 0);
        }

        // 4. ЛОГИКА ШАГОВ (Sound Steps)
        if (this.onGround && (forward !== 0 || strafe !== 0)) {
            const moveSpeed = Math.sqrt(this.velocity.x**2 + this.velocity.z**2);
            this.stepDistance += moveSpeed * dt;

            if (this.stepDistance > this.STEP_INTERVAL) {
                this.stepDistance = 0;

                // Ищем блок под ногами
                const underBlockPos = {
                    x: Math.floor(this.position.x),
                    y: Math.floor(this.position.y - 0.2), // Чуть ниже
                    z: Math.floor(this.position.z)
                };

                const id = this.world.getBlock(underBlockPos.x, underBlockPos.y, underBlockPos.z);
                const props = BLOCKS[id];

                if (props && props.sound && this.soundManager) {
                    this.soundManager.playStep(props.sound);
                }
            }
        } else {
            this.stepDistance = 0;
        }

        // Обновляем камеру с покачиванием (bobbing) - знак бесконечности (восьмерка)
        // ПЛАВНОЕ И РАЗМАШИСТОЕ ДВИЖЕНИЕ
        this.camera.position.copy(this.position);
        
        let bobOffsetX = 0;
        let bobOffsetY = 0;
        
        if (this.bobbingEnabled && this.onGround && (forward !== 0 || strafe !== 0)) {
            const moveSpeed = Math.sqrt(this.velocity.x**2 + this.velocity.z**2);
            // УМЕНЬШЕНА СКОРОСТЬ для плавности - было 4.0, стало 2.0
            this.bobTime += moveSpeed * dt * 2.0;
            
            // Знак бесконечности (восьмерка): x = sin(t), y = sin(2*t)
            // УВЕЛИЧЕНА АМПЛИТУДА для размашистого движения
            const t = this.bobTime;
            bobOffsetX = Math.sin(t) * this.bobAmount;
            bobOffsetY = Math.sin(2.0 * t) * this.bobAmount * 0.6;
            
            // Применяем покачивание к камере относительно направления движения
            const forwardDir = this._tempVec.set(0, 0, -1).applyAxisAngle(new THREE.Vector3(0,1,0), this.yaw);
            const rightDir = this._tempVec2.set(1, 0, 0).applyAxisAngle(new THREE.Vector3(0,1,0), this.yaw);
            
            // ПЛАВНАЯ ИНТЕРПОЛЯЦИЯ для избежания тряски
            const targetBobX = bobOffsetX;
            const targetBobY = bobOffsetY;
            
            // Интерполируем от предыдущего значения
            this.lastBobX += (targetBobX - this.lastBobX) * dt * 8.0;
            this.lastBobY += (targetBobY - this.lastBobY) * dt * 8.0;
            
            this.camera.position.addScaledVector(forwardDir, this.lastBobX);
            this.camera.position.addScaledVector(rightDir, this.lastBobX * 0.4);
        } else {
            // Плавно возвращаем камеру в исходное положение
            this.lastBobX *= 0.9;
            this.lastBobY *= 0.9;
            this.bobTime *= 0.95;
            if (Math.abs(this.bobTime) < 0.01) {
                this.bobTime = 0;
            }
        }
        
        this.camera.position.y += this.cameraHeight + this.lastBobY;

        this.updateRaycast();
    }

    updateRaycast() {
        const dir = this._tempVec.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
        const start = this.camera.position;

        let t = 0;
        let maxDist = 5;
        let hit = null;
        const step = 0.05;

        for(; t < maxDist; t += step) {
             const px = start.x + dir.x * t;
             const py = start.y + dir.y * t;
             const pz = start.z + dir.z * t;

             const ix = Math.floor(px);
             const iy = Math.floor(py);
             const iz = Math.floor(pz);

             const block = this.world.getBlock(ix, iy, iz);

             // Унифицированная проверка: используем ту же логику, что и в chunk.js
             if (block !== BLOCK.AIR && BLOCKS[block] && !BLOCKS[block].transparent) {
                 const cx = ix + 0.5, cy = iy + 0.5, cz = iz + 0.5;
                 const dx = px - cx, dy = py - cy, dz = pz - cz;
                 const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);

                 let nx=0, ny=0, nz=0;
                 if(ax > ay && ax > az) nx = Math.sign(dx);
                 else if(ay > ax && ay > az) ny = Math.sign(dy);
                 else nz = Math.sign(dz);

                 hit = { x: ix, y: iy, z: iz, normal: {x: nx, y: ny, z: nz} };
                 break;
             }
        }

        this.targetBlock = hit;
        if (hit) {
            this.selectionBox.visible = true;
            this.selectionBox.scale.set(1.001, 1.001, 1.001);
            this.selectionBox.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
        } else {
            this.selectionBox.visible = false;
        }
    }
}
