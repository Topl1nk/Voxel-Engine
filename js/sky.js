import * as THREE from 'three';
import { WORLD_CONFIG, BLOCK, BLOCKS } from './constants.js';
import { VolumetricCloudsShader } from './shaders.js';

export class Sky {
    constructor(scene, textureAtlas) {
        this.scene = scene;
        this.textureAtlas = textureAtlas;
        
        // Параметры неба
        this.dayTime = 0.5; // 0 = полночь, 0.5 = полдень
        this.baseDaySpeed = 0.0001; // Базовая скорость смены дня и ночи
        
        // Параметры солнца и луны
        this.SUN_RADIUS = 300; // Радиус орбиты
        this.SUN_BASE_HEIGHT = 100; // Базовая высота
        this.MOON_RADIUS_MULTIPLIER = 0.8;
        this.MOON_Z_OFFSET = 0.3;
        this.SUN_SIZE = 30; // Размер солнца
        this.MOON_SIZE = 25; // Размер луны
        
        // Параметры облаков (соответствуют продвинутому шейдеру)
        this.CLOUD_HEIGHT = 200; // Высота начала облаков (в блоках) - подняли выше
        this.CLOUD_THICKNESS = 60; // Толщина слоя облаков (volumetric) - сделали тоньше
        
        // Цвета неба
        this.daySkyColor = new THREE.Color(0x87CEEB); // Голубое небо
        this.nightSkyColor = new THREE.Color(0x000814); // Темно-синее небо ночью
        this.duskColor = new THREE.Color(0xFF6B4A); // Цвет заката/рассвета
        
        // Инициализация
        this.createSun();
        this.createMoon();
        this.createClouds();
    }
    
    // Создание солнца как billboard
    createSun() {
        const sunBlockData = BLOCKS[BLOCK.SUN];
        if (!sunBlockData) {
            console.warn('Sun block not found in BLOCKS');
            return;
        }
        
        const geometry = new THREE.PlaneGeometry(this.SUN_SIZE, this.SUN_SIZE);
        const material = new THREE.MeshBasicMaterial({
            map: this.textureAtlas,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false,
            depthTest: true, // Включаем тест глубины для правильного рендеринга
            fog: false // Солнце не скрывается туманом
        });
        
        // Устанавливаем UV координаты для текстуры солнца
        const uvAttribute = geometry.attributes.uv;
        const [col, row] = sunBlockData.atlas;
        const uvStep = 1 / WORLD_CONFIG.ATLAS_GRID;
        const eps = 0.0001;
        
        const uMin = col * uvStep + eps;
        const uMax = (col + 1) * uvStep - eps;
        const vMin = 1.0 - ((row + 1) * uvStep) + eps;
        const vMax = 1.0 - (row * uvStep) - eps;
        
        uvAttribute.setXY(0, uMin, vMax);
        uvAttribute.setXY(1, uMax, vMax);
        uvAttribute.setXY(2, uMin, vMin);
        uvAttribute.setXY(3, uMax, vMin);
        
        this.sunMesh = new THREE.Mesh(geometry, material);
        this.sunMesh.renderOrder = -1; // Рендерим в фоновом режиме
        this.sunMesh.frustumCulled = false; // Не отсекать по frustum
        this.scene.add(this.sunMesh);
    }
    
    // Создание луны как billboard
    createMoon() {
        const moonBlockData = BLOCKS[BLOCK.MOON];
        if (!moonBlockData) {
            console.warn('Moon block not found in BLOCKS');
            return;
        }
        
        const geometry = new THREE.PlaneGeometry(this.MOON_SIZE, this.MOON_SIZE);
        const material = new THREE.MeshBasicMaterial({
            map: this.textureAtlas,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false,
            depthTest: true, // Включаем тест глубины для правильного рендеринга
            fog: false // Луна не скрывается туманом
        });
        
        // Устанавливаем UV координаты для текстуры луны
        const uvAttribute = geometry.attributes.uv;
        const [col, row] = moonBlockData.atlas;
        const uvStep = 1 / WORLD_CONFIG.ATLAS_GRID;
        const eps = 0.0001;
        
        const uMin = col * uvStep + eps;
        const uMax = (col + 1) * uvStep - eps;
        const vMin = 1.0 - ((row + 1) * uvStep) + eps;
        const vMax = 1.0 - (row * uvStep) - eps;
        
        uvAttribute.setXY(0, uMin, vMax);
        uvAttribute.setXY(1, uMax, vMax);
        uvAttribute.setXY(2, uMin, vMin);
        uvAttribute.setXY(3, uMax, vMin);
        
        this.moonMesh = new THREE.Mesh(geometry, material);
        this.moonMesh.renderOrder = -1; // Рендерим в фоновом режиме
        this.moonMesh.frustumCulled = false; // Не отсекать по frustum
        this.scene.add(this.moonMesh);
    }
    
    
    // Создание объемных облаков через raymarching
    createClouds() {
        // Создаем огромный купол для облаков
        const geometry = new THREE.SphereGeometry(1000, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.5);
        
        // Создаем материал с продвинутым volumetric shader
        this.cloudMaterial = new THREE.ShaderMaterial({
            vertexShader: VolumetricCloudsShader.vertex,
            fragmentShader: VolumetricCloudsShader.fragment,
            uniforms: {
                uTime: { value: 0 },
                uCameraPosition: { value: new THREE.Vector3() },
                uSunDirection: { value: new THREE.Vector3(0, 1, 0) },
                uCloudHeight: { value: this.CLOUD_HEIGHT },
                uCloudThickness: { value: this.CLOUD_THICKNESS },
                uCloudCoverage: { value: 0.80 } // Инвертировано: 1.0 - 0.20 = 0.80
            },
            side: THREE.BackSide, // Рендерим внутреннюю сторону купола
            transparent: true,
            depthWrite: false,
            depthTest: false, // Отключаем depth test для облаков
            blending: THREE.NormalBlending
        });
        
        this.cloudMesh = new THREE.Mesh(geometry, this.cloudMaterial);
        this.cloudMesh.renderOrder = -2; // Рендерим перед всем остальным (после неба)
        this.cloudMesh.frustumCulled = false;
        this.scene.add(this.cloudMesh);
        
        console.log('[Sky] Облака созданы с высотой:', this.CLOUD_HEIGHT);
    }
    
    // Обновление системы неба
    update(dt, playerPosition, camera, timeSpeed, cloudCoverage = 0.20) {
        // Обновляем время суток
        this.dayTime += this.baseDaySpeed * dt * timeSpeed;
        if (this.dayTime > 1.0) {
            this.dayTime -= 1.0;
        }
        
        // Обновляем uniforms для продвинутого volumetric clouds shader
        if (this.cloudMaterial && this.cloudMaterial.uniforms) {
            this.cloudMaterial.uniforms.uTime.value += dt * 0.05; // Медленная анимация ветра
            this.cloudMaterial.uniforms.uCameraPosition.value.copy(camera.position);
            
            // Обновляем направление солнца для освещения облаков
            const sunAngle = (this.dayTime - 0.25) * Math.PI * 2.0;
            const sunX = Math.cos(sunAngle);
            const sunY = Math.sin(sunAngle);
            this.cloudMaterial.uniforms.uSunDirection.value.set(sunX, sunY, 0).normalize();
            
            // Обновляем параметры облаков
            this.cloudMaterial.uniforms.uCloudHeight.value = this.CLOUD_HEIGHT;
            this.cloudMaterial.uniforms.uCloudThickness.value = this.CLOUD_THICKNESS;
            // ИНВЕРТИРУЕМ: 0% = нет облаков, 100% = максимум облаков
            // В шейдере это threshold для smoothstep, поэтому инвертируем
            this.cloudMaterial.uniforms.uCloudCoverage.value = 1.0 - cloudCoverage;
            
            // Debug: выводим покрытие каждые 5 секунд
            if (!this._lastCoverageLog || Date.now() - this._lastCoverageLog > 5000) {
                console.log('[Sky] Cloud Coverage UI:', cloudCoverage.toFixed(2), '→ Shader:', (1.0 - cloudCoverage).toFixed(2));
                this._lastCoverageLog = Date.now();
            }
        }
        
        // Обновляем позицию купола облаков (следует за камерой)
        if (this.cloudMesh && camera) {
            this.cloudMesh.position.copy(camera.position);
            this.cloudMesh.position.y = 0; // Купол центрирован на уровне игрока
        }
        
        // Вычисляем угол солнца
        const sunAngle = (this.dayTime - 0.25) * Math.PI * 2.0;
        const sunElevation = Math.sin(sunAngle);
        
        // Обновляем позиции солнца и луны
        if (this.sunMesh) {
            const sunX = Math.cos(sunAngle) * this.SUN_RADIUS;
            const sunY = Math.sin(sunAngle) * this.SUN_RADIUS;
            
            const sunPosition = new THREE.Vector3(
                playerPosition.x + sunX,
                sunY + this.SUN_BASE_HEIGHT,
                playerPosition.z
            );
            
            this.sunMesh.position.copy(sunPosition);
            
            // Солнце всегда смотрит на камеру (billboard)
            this.sunMesh.lookAt(camera.position);
            
            // Видимость солнца зависит от высоты над горизонтом
            this.sunMesh.visible = sunElevation > -0.1;
        }
        
        if (this.moonMesh) {
            const moonAngle = sunAngle + Math.PI;
            const moonX = Math.cos(moonAngle) * this.SUN_RADIUS * this.MOON_RADIUS_MULTIPLIER;
            const moonY = Math.sin(moonAngle) * this.SUN_RADIUS * this.MOON_RADIUS_MULTIPLIER;
            
            const moonPosition = new THREE.Vector3(
                playerPosition.x + moonX,
                moonY + this.SUN_BASE_HEIGHT,
                playerPosition.z + this.SUN_RADIUS * this.MOON_Z_OFFSET
            );
            
            this.moonMesh.position.copy(moonPosition);
            
            // Луна всегда смотрит на камеру (billboard)
            this.moonMesh.lookAt(camera.position);
            
            // Видимость луны
            const moonElevation = Math.sin(moonAngle);
            this.moonMesh.visible = moonElevation > -0.1;
        }
        
        // Обновляем UI
        const skyInfoEl = document.getElementById('sky-info');
        if (skyInfoEl) {
            const timeOfDay = this.dayTime < 0.25 ? 'Ночь' : 
                              this.dayTime < 0.5 ? 'Утро' :
                              this.dayTime < 0.75 ? 'День' : 'Вечер';
            skyInfoEl.textContent = `${timeOfDay} (${(this.dayTime * 100).toFixed(0)}%) | Солнце: ${sunElevation > 0 ? 'видно' : 'скрыто'}`;
        }
        
        return {
            sunElevation: sunElevation,
            dayTime: this.dayTime
        };
    }
    
    // Обновление облаков (для raymarching не нужно генерировать чанки)
    updateClouds(playerPosition) {
        // Для raymarching ничего не нужно обновлять
        // Облака рендерятся в шейдере на основе позиции камеры
    }
    
    // Получить цвет неба в зависимости от времени суток
    getSkyColor() {
        const sunAngle = (this.dayTime - 0.25) * Math.PI * 2.0;
        const sunElevation = Math.sin(sunAngle);
        
        // Интерполяция между ночью и днем
        const dayFactor = Math.max(0, Math.min(1, (sunElevation + 0.2) / 1.2));
        
        // Определяем, закат/рассвет ли сейчас
        const isDuskOrDawn = (this.dayTime > 0.2 && this.dayTime < 0.3) || 
                             (this.dayTime > 0.7 && this.dayTime < 0.8);
        
        const color = new THREE.Color();
        
        if (isDuskOrDawn && sunElevation > -0.2 && sunElevation < 0.3) {
            // Закат/рассвет - добавляем красноватый оттенок
            const duskFactor = Math.abs(sunElevation);
            color.lerpColors(this.nightSkyColor, this.duskColor, duskFactor * 2);
        } else {
            // Обычная интерполяция день/ночь
            color.lerpColors(this.nightSkyColor, this.daySkyColor, dayFactor);
        }
        
        return color;
    }
    
    // Получить интенсивность света в зависимости от времени суток
    getLightIntensity() {
        const sunAngle = (this.dayTime - 0.25) * Math.PI * 2.0;
        const sunElevation = Math.sin(sunAngle);
        
        // Интенсивность от 0 (ночь) до 1.5 (полдень)
        return Math.max(0, sunElevation) * 1.5;
    }
    
    // Получить интенсивность окружающего света
    getAmbientIntensity() {
        const sunAngle = (this.dayTime - 0.25) * Math.PI * 2.0;
        const sunElevation = Math.sin(sunAngle);
        
        return 0.05 + Math.max(0, sunElevation) * 0.2;
    }
    
    // Получить интенсивность полусферного света
    getHemisphereIntensity() {
        const sunAngle = (this.dayTime - 0.25) * Math.PI * 2.0;
        const sunElevation = Math.sin(sunAngle);
        
        return Math.max(0, sunElevation) * 0.25;
    }
    
    // Получить затенение от облаков (влияет на общее освещение)
    getCloudShadowFactor() {
        // Облака уменьшают прямой свет, но не ambient
        // В зависимости от времени суток и покрытия облаками
        const coverage = 0.3125; // CLOUD_COVERAGE из шейдера
        const cloudDensityFactor = 0.7 + (1.0 - coverage) * 0.3; // 0.7 - 1.0
        
        return cloudDensityFactor;
    }
    
    // Очистка ресурсов
    dispose() {
        if (this.sunMesh) {
            this.scene.remove(this.sunMesh);
            if (this.sunMesh.geometry) this.sunMesh.geometry.dispose();
            if (this.sunMesh.material) this.sunMesh.material.dispose();
        }
        
        if (this.moonMesh) {
            this.scene.remove(this.moonMesh);
            if (this.moonMesh.geometry) this.moonMesh.geometry.dispose();
            if (this.moonMesh.material) this.moonMesh.material.dispose();
        }
        
        if (this.cloudMesh) {
            this.scene.remove(this.cloudMesh);
            if (this.cloudMesh.geometry) this.cloudMesh.geometry.dispose();
            if (this.cloudMesh.material) this.cloudMesh.material.dispose();
        }
    }
}

