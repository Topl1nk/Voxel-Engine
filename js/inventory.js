import * as THREE from 'three';
import { BLOCK_DATA, BLOCKS, WORLD_CONFIG } from './constants.js';

export class Inventory {
    constructor(scene, textureAtlas, player) {
        this.scene = scene;
        this.textureAtlas = textureAtlas;
        this.player = player;
        this._isOpen = false;
        this.selectedBlock = 1;
        
        this.inventoryBlocks = BLOCK_DATA.filter(b => 
            b.id !== 0 && b.id !== 14 && b.id !== 15 && b.id !== 16
        );
        
        this.iconCache = new Map();
        this.totalSlots = 64;
        this.inventorySlots = new Array(this.totalSlots).fill(null);
        this.populateInitialInventory();
        
        this.overlay = document.getElementById('inventory-overlay');
        this.grid = document.getElementById('inventory-grid');
        
        if (!this.overlay || !this.grid) {
            console.error('Inventory HTML elements not found!');
            return;
        }
        
        this.setupIconRenderer();
        
        const closeBtn = document.getElementById('inventory-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.close());
        }

        this.draggedItem = null;
        this.draggedItemIcon = null;
        
        this.setupDragAndDrop();
    }

    populateInitialInventory() {
        for (let i = 0; i < this.inventorySlots.length; i++) {
            if (this.inventoryBlocks[i]) {
                this.inventorySlots[i] = this.inventoryBlocks[i].id;
            }
        }
    }
    
    setupIconRenderer() {
        this.iconSize = 64;
        this.iconRenderer = new THREE.WebGLRenderer({ 
            antialias: true,
            alpha: true,
            powerPreference: "high-performance"
        });
        this.iconRenderer.setSize(this.iconSize, this.iconSize);
        this.iconRenderer.setClearColor(0x000000, 0);
        this.iconRenderer.shadowMap.enabled = false;
        
        const distance = 2.5;
        const angle = Math.PI / 6;
        const height = Math.PI / 4;
        
        this.iconCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 10);
        this.iconCamera.position.set(
            Math.cos(angle) * distance * Math.cos(height),
            Math.sin(height) * distance,
            Math.sin(angle) * distance * Math.cos(height)
        );
        this.iconCamera.lookAt(0, 0, 0);
    }
    
    renderBlockIcon(blockId) {
        if (this.iconCache.has(blockId)) return this.iconCache.get(blockId);
        
        const blockData = BLOCKS[blockId];
        if (!blockData || !this.textureAtlas || !this.textureAtlas.image) return null;
        
        const iconScene = new THREE.Scene();
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        iconScene.add(ambientLight);
        
        const mainLight = new THREE.DirectionalLight(0xffffff, 0.8);
        mainLight.position.set(1, 1.5, 0.5);
        iconScene.add(mainLight);
        
        const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
        fillLight.position.set(-1, 0.5, -0.5);
        iconScene.add(fillLight);
        
        const geometry = new THREE.BoxGeometry(1, 1, 1);
        const material = new THREE.MeshStandardMaterial({
            map: this.textureAtlas,
            vertexColors: true,
            transparent: blockData.transparent || false,
            alphaTest: 0.1
        });
        
        const mesh = new THREE.Mesh(geometry, material);
        const uvAttribute = geometry.attributes.uv;
        const uvStep = 1 / WORLD_CONFIG.ATLAS_GRID;
        const eps = 0.0001;
        
        const getUV = (atlasCoords) => {
            if (!atlasCoords) return null;
            const [col, row] = atlasCoords;
            const uMin = col * uvStep + eps;
            const uMax = (col + 1) * uvStep - eps;
            const vMin = 1.0 - ((row + 1) * uvStep) + eps;
            const vMax = 1.0 - (row * uvStep) - eps;
            return { uMin, uMax, vMin, vMax };
        };
        
        const sideUV = getUV(blockData.atlas);
        const topUV = getUV(blockData.atlasTop || blockData.atlas);
        const bottomUV = getUV(blockData.atlasBottom || blockData.atlas);
        
        const uvArray = [
            [sideUV.uMin, sideUV.vMax], [sideUV.uMax, sideUV.vMax], [sideUV.uMin, sideUV.vMin], [sideUV.uMax, sideUV.vMin],
            [sideUV.uMax, sideUV.vMax], [sideUV.uMin, sideUV.vMax], [sideUV.uMax, sideUV.vMin], [sideUV.uMin, sideUV.vMin],
            [topUV.uMin, topUV.vMin], [topUV.uMax, topUV.vMin], [topUV.uMin, topUV.vMax], [topUV.uMax, topUV.vMax],
            [bottomUV.uMin, bottomUV.vMax], [bottomUV.uMax, bottomUV.vMax], [bottomUV.uMin, bottomUV.vMin], [bottomUV.uMax, bottomUV.vMin],
            [sideUV.uMax, sideUV.vMax], [sideUV.uMax, sideUV.vMin], [sideUV.uMin, sideUV.vMax], [sideUV.uMin, sideUV.vMin],
            [sideUV.uMin, sideUV.vMax], [sideUV.uMin, sideUV.vMin], [sideUV.uMax, sideUV.vMax], [sideUV.uMax, sideUV.vMin]
        ];
        
        for (let i = 0; i < uvArray.length; i++) {
            uvAttribute.setXY(i, uvArray[i][0], uvArray[i][1]);
        }
        
        const colors = [];
        const color = new THREE.Color(0xffffff);
        for (let i = 0; i < geometry.attributes.position.count; i++) {
            colors.push(color.r, color.g, color.b);
        }
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        
        iconScene.add(mesh);
        
        try {
            this.iconRenderer.render(iconScene, this.iconCamera);
            const dataURL = this.iconRenderer.domElement.toDataURL('image/png');
            iconScene.clear();
            geometry.dispose();
            material.dispose();
            this.iconCache.set(blockId, dataURL);
            return dataURL;
        } catch (error) {
            console.error('Error rendering block icon:', error, blockId);
            return null;
        }
    }
    
    generateUI() {
        if (!this.grid) return;
        
        this.grid.innerHTML = '';
        this.inventorySlots.forEach((blockId, i) => {
            const slot = this.createSlotElement('inventory', i);
            if (blockId !== null && blockId !== undefined) {
                this.fillSlot(slot, blockId);
            }
            this.grid.appendChild(slot);
        });
        
        // Хотбар обновляется из app.js, но мы должны убедиться, что слушатели событий там есть.
        // Это делается через вызов attachDragListeners в app.js
    }
    
    createSlotElement(type, index) {
        const slot = document.createElement('div');
        slot.className = 'slot';
        slot.dataset.type = type;
        slot.dataset.index = index;
        
        this.attachDragListeners(slot);
        
        return slot;
    }
    
    attachDragListeners(slot) {
        slot.addEventListener('mousedown', (e) => this.handleSlotMouseDown(e, slot));
        slot.addEventListener('mouseup', (e) => this.handleSlotMouseUp(e, slot));
        slot.addEventListener('mouseenter', (e) => this.handleSlotMouseEnter(e, slot));
        slot.addEventListener('mouseleave', (e) => this.handleSlotMouseLeave(e, slot));
        slot.addEventListener('dblclick', (e) => {
            if (!this.isOpen || this.draggedItem) return;
            if (slot.dataset.type !== 'inventory') return;
            const blockId = parseInt(slot.dataset.blockId);
            if (!blockId) return;
            this.selectedBlock = blockId;
            this.player.hotbar[this.player.selectedSlot] = blockId;
            if (window.app) window.app.updateHotbarWithIcons();
            this.player.updateUI();
        });
    }
    
    fillSlot(slot, blockId) {
        slot.innerHTML = '';
        if (blockId === null || blockId === undefined) {
            delete slot.dataset.blockId;
            slot.title = '';
            return;
        }

        const blockData = BLOCKS[blockId];
        if (!blockData) return;
        
        slot.dataset.blockId = blockId;
        
        const icon = document.createElement('img');
        icon.className = 'slot-icon';
        const iconSrc = this.renderBlockIcon(blockId);
        if (iconSrc) {
            icon.src = iconSrc;
            icon.alt = blockData.name;
        }
        slot.appendChild(icon);
        slot.title = blockData.name;
    }
    
    setupDragAndDrop() {
        document.addEventListener('mousemove', (e) => {
            if (this.draggedItem && this.draggedItemIcon) {
                this.draggedItemIcon.style.left = e.pageX + 'px';
                this.draggedItemIcon.style.top = e.pageY + 'px';
            }
        });
        
        document.addEventListener('mouseup', (e) => {
            if (this.draggedItem) {
                const slot = e.target.closest('.slot');
                this.endDrag(slot || null); 
            }
        });
    }
    
    handleSlotMouseDown(e, slot) {
        // Разрешаем драг только если инвентарь открыт
        if (!this.isOpen) return;
        
        if (e.button !== 0) return; 
        const blockId = parseInt(slot.dataset.blockId);
        if (!blockId && slot.dataset.type === 'inventory') return; // Из пустого инвентаря нельзя тащить
        
        // Из пустого хотбара тоже нельзя
        if (!blockId) return;
        
        this.startDrag(slot, blockId);
    }
    
    handleSlotMouseUp(e, slot) {
        if (this.draggedItem) {
            e.stopPropagation();
            this.endDrag(slot);
        }
    }
    
    handleSlotMouseEnter(e, slot) {
        if (this.draggedItem) {
            slot.classList.add('drag-over');
        }
    }
    
    handleSlotMouseLeave(e, slot) {
        slot.classList.remove('drag-over');
    }
    
    startDrag(sourceSlot, blockId) {
        this.draggedItem = {
            sourceSlot: sourceSlot,
            blockId: blockId,
            type: sourceSlot.dataset.type,
            index: parseInt(sourceSlot.dataset.index)
        };
        
        const iconSrc = this.renderBlockIcon(blockId);
        this.draggedItemIcon = document.createElement('img');
        this.draggedItemIcon.src = iconSrc;
        this.draggedItemIcon.className = 'drag-ghost';
        document.body.appendChild(this.draggedItemIcon);
        
        sourceSlot.classList.add('drag-source');
    }
    
    endDrag(targetSlot) {
        if (!this.draggedItem) return;
        
        const sourceSlot = this.draggedItem.sourceSlot;
        sourceSlot.classList.remove('drag-source');
        
        if (targetSlot) {
            targetSlot.classList.remove('drag-over');
            
            const targetType = targetSlot.dataset.type;
            const targetIndex = parseInt(targetSlot.dataset.index);
            if (targetType === 'inventory') {
                this.handleInventoryDrop(targetIndex);
            } else if (targetType === 'hotbar') {
                this.handleHotbarDrop(targetIndex);
            }
        }
        
        if (this.draggedItemIcon) {
            this.draggedItemIcon.remove();
            this.draggedItemIcon = null;
        }
        
        this.draggedItem = null;
    }

    handleInventoryDrop(targetIndex) {
        if (!this.draggedItem) return;
        const blockId = this.draggedItem.blockId;
        if (!blockId) return;

        const sourceType = this.draggedItem.type;
        const sourceIndex = this.draggedItem.index;
        const current = this.inventorySlots[targetIndex] ?? null;

        if (sourceType === 'inventory') {
            this.inventorySlots[targetIndex] = blockId;
            if (sourceIndex !== targetIndex) {
                this.inventorySlots[sourceIndex] = current || null;
            }
        } else if (sourceType === 'hotbar') {
            this.inventorySlots[targetIndex] = blockId;
            this.player.hotbar[sourceIndex] = current || null;
        }

        this.generateUI();
        if (window.app) window.app.updateHotbarWithIcons();
        this.player.updateUI();
    }

    handleHotbarDrop(targetIndex) {
        if (!this.draggedItem) return;
        const blockId = this.draggedItem.blockId;
        if (!blockId) return;

        const sourceType = this.draggedItem.type;
        const sourceIndex = this.draggedItem.index;
        const previous = this.player.hotbar[targetIndex] || null;

        this.player.hotbar[targetIndex] = blockId;

        if (sourceType === 'inventory') {
            this.inventorySlots[sourceIndex] = previous || null;
            this.generateUI();
        } else if (sourceType === 'hotbar') {
            this.player.hotbar[sourceIndex] = previous || null;
        }

        if (this.player.selectedSlot === targetIndex) {
            const event = new CustomEvent('blockSelected', { detail: { blockId } });
            document.dispatchEvent(event);
        }

        if (window.app) window.app.updateHotbarWithIcons();
        this.player.updateUI();
    }
    
    toggle() {
        if (!this.overlay) return false;
        
        this._isOpen = !this._isOpen;
        
        if (this._isOpen) {
            this.overlay.classList.add('active');
            this.overlay.style.display = 'flex';
            this.generateUI(); 
        } else {
            this.overlay.classList.remove('active');
            this.overlay.style.display = 'none';
        }
        
        return this._isOpen;
    }
    
    get isOpen() { return this._isOpen; }
    set isOpen(value) { 
        this._isOpen = value; 
        if(this.overlay) {
            if(value) {
                this.overlay.classList.add('active');
                this.overlay.style.display = 'flex';
                this.generateUI();
            } else {
                this.overlay.classList.remove('active');
                this.overlay.style.display = 'none';
            }
        }
    }
    
    close() { this.isOpen = false; }
    getBlockIcon(blockId) { return this.renderBlockIcon(blockId); }
    setSelectedBlock(blockId) { this.selectedBlock = blockId; }
}
