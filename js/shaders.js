// Чистый GLSL шейдеры без макросов Three.js

// Voxel Shader - шейдер для воксельных блоков
export const VoxelShader = {
    vertex: `
        // Стандартные атрибуты добавляются Three.js автоматически:
        // attribute vec3 position;
        // attribute vec3 normal;
        // attribute vec2 uv;
        attribute vec3 color;
        
        // Стандартные униформы добавляются автоматически:
        // uniform mat4 modelMatrix;
        // uniform mat4 viewMatrix;
        // uniform mat4 projectionMatrix;
        uniform mat3 normalMatrix;
        
        uniform mat4 directionalShadowMatrix;
        uniform sampler2D directionalShadowMap;
        
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vWorldPosition;
        varying vec3 vColor;
        varying float vDist;
        varying vec4 vShadowCoord;
        
        void main() {
            vUv = uv;
            vColor = color;
            
            vec4 worldPosition = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPosition.xyz;
            
            vNormal = normalize(normalMatrix * normal);
            
            vec4 mvPosition = viewMatrix * worldPosition;
            vDist = -mvPosition.z;
            
            vShadowCoord = directionalShadowMatrix * worldPosition;
            
            gl_Position = projectionMatrix * mvPosition;
        }
    `,
    
    fragment: `
        precision mediump float;
        
        uniform sampler2D uMap;
        uniform sampler2D directionalShadowMap;
        uniform vec3 uSunDir;
        uniform vec3 uFogColor;
        uniform float uFogNear;
        uniform float uFogFar;
        uniform bool uShadowsEnabled;
        uniform float uTime; // Для расчета облаков
        uniform float uCloudHeight; // Высота облаков
        
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vWorldPosition;
        varying vec3 vColor;
        varying float vDist;
        varying vec4 vShadowCoord;
        
        // Shadow calculation
        float unpackDepth(const in vec4 rgba_depth) {
            const vec4 bit_shift = vec4(1.0/(256.0*256.0*256.0), 1.0/(256.0*256.0), 1.0/256.0, 1.0);
            float depth = dot(rgba_depth, bit_shift);
            return depth;
        }
        
        float texture2DCompare(sampler2D depths, vec2 uv, float compare) {
            return step(compare, unpackDepth(texture2D(depths, uv)));
        }
        
        // Cloud shadow calculation - упрощенная версия для теней на землю
        float hash_simple(float n) {
            return fract(sin(n) * 753.5453123);
        }
        
        float noise_simple(vec3 x) {
            vec3 p = floor(x);
            vec3 f = fract(x);
            f = f * f * (3.0 - 2.0 * f);
            
            float n = p.x + p.y * 157.0 + 113.0 * p.z;
            return mix(
                mix(
                    mix(hash_simple(n + 0.0), hash_simple(n + 1.0), f.x),
                    mix(hash_simple(n + 157.0), hash_simple(n + 158.0), f.x),
                    f.y
                ),
                mix(
                    mix(hash_simple(n + 113.0), hash_simple(n + 114.0), f.x),
                    mix(hash_simple(n + 270.0), hash_simple(n + 271.0), f.x),
                    f.y
                ),
                f.z
            );
        }
        
        float getCloudShadow(vec3 worldPos) {
            // Проверяем, не выше ли точка облаков
            if (worldPos.y > uCloudHeight) return 1.0;
            
            // Позиция для проверки облаков (проецируем вверх)
            vec3 wind_dir = vec3(0.0, 0.0, -uTime * 0.2);
            vec3 cloudPos = worldPos;
            cloudPos.y = uCloudHeight + 30.0; // Середина слоя облаков
            
            vec3 p = cloudPos * 0.003 + wind_dir;
            
            // Упрощенный FBM (2 октавы для производительности)
            float dens = abs(noise_simple(p * 2.032));
            dens += abs(noise_simple(p * 2.032 * 2.6434)) * 0.5;
            dens /= 1.5;
            
            // Применяем coverage
            const float coverage = 0.3125;
            dens = smoothstep(coverage, coverage + 0.1, dens);
            
            // Преобразуем плотность в затенение (0.5 = 50% затенения максимум)
            float cloudShadow = 1.0 - (dens * 0.5);
            
            return cloudShadow;
        }
        
        const vec2 poissonDisk[16] = vec2[](
            vec2(-0.94201624, -0.39906216),
            vec2(0.94558609, -0.76890725),
            vec2(-0.094184101, -0.92938870),
            vec2(0.34495938, 0.29387760),
            vec2(-0.91588581, 0.45771432),
            vec2(-0.81544232, -0.87912464),
            vec2(-0.38277543, 0.27676845),
            vec2(0.97484398, 0.75648379),
            vec2(0.44323325, -0.97511554),
            vec2(0.53742981, -0.47373420),
            vec2(-0.26496911, -0.41893023),
            vec2(0.79197514, 0.19090188),
            vec2(-0.24188840, 0.99706507),
            vec2(-0.81409955, 0.91437590),
            vec2(0.19984126, 0.78641367),
            vec2(0.14383161, -0.14100790)
        );
        
        float randomFloat(vec3 seed) {
            return fract(sin(dot(seed, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
        }
        
        float getShadow(sampler2D shadowMap, vec4 shadowCoord, float bias, float pcfRadius, float randomSeed) {
            if (!uShadowsEnabled) return 1.0;
            
            vec3 shadowCoord3 = shadowCoord.xyz / shadowCoord.w;
            
            // За пределами объема освещения считаем точку освещенной
            if (shadowCoord3.z > 1.0) {
                return 1.0;
            }
            
            // Clamp to shadow map bounds
            if (shadowCoord3.x < 0.0 || shadowCoord3.x > 1.0 ||
                shadowCoord3.y < 0.0 || shadowCoord3.y > 1.0 ||
                shadowCoord3.z < 0.0 || shadowCoord3.z > 1.0) {
                return 1.0;
            }
            
            float shadow = 0.0;
            
            // PCF (Percentage Closer Filtering) для мягких теней
            vec2 texelSize = vec2(1.0 / 2048.0); // Размер shadow map
            float samples = 8.0;
            int startIndex = int(randomSeed * 16.0) % 16;
            for (int i = 0; i < 8; ++i) {
                int idx = (startIndex + i) % 16;
                vec2 offset = poissonDisk[idx] * texelSize * pcfRadius;
                shadow += texture2DCompare(shadowMap, shadowCoord3.xy + offset, shadowCoord3.z - bias);
            }
            shadow /= samples;
            
            return shadow;
        }
        
        void main() {
            vec4 texColor = texture2D(uMap, vUv);
            
            if(texColor.a < 0.5) discard;
            
            // Применяем vertex colors
            vec3 finalTexColor = texColor.rgb * vColor;
            
            // РАСЧЕТ СВЕТА (SAFE MODE + Cloud Shadows)
            // 1. Прямой свет от солнца
            float NdotL = max(0.0, dot(vNormal, uSunDir));
            float directLight = NdotL * 0.5; // Сила солнца
            
            // 2. Тени от геометрии
            float ndotl = clamp(dot(vNormal, uSunDir), 0.0, 1.0);
            float slopeFactor = ndotl < 0.999 ? sqrt(max(1.0 - ndotl * ndotl, 0.0)) / max(ndotl, 0.001) : 0.0;
            float shadowBias = clamp(0.0005 + slopeFactor * 0.0035, 0.0005, 0.02);
            
            float distanceFactor = clamp(vDist / 120.0, 0.0, 1.0);
            float pcfRadius = mix(1.0, 3.75, distanceFactor);
            float randomSeed = randomFloat(vWorldPosition + vec3(uTime));
            float geometryShadow = getShadow(directionalShadowMap, vShadowCoord, shadowBias, pcfRadius, randomSeed);
            
            // 3. Тени от облаков
            float cloudShadow = getCloudShadow(vWorldPosition);
            
            // 4. Комбинированные тени (геометрия * облака)
            float combinedShadow = geometryShadow * cloudShadow;
            
            // 5. Фоновый свет (Ambient) - его НЕЛЬЗЯ умножать на тень!
            float ambientLight = 0.5;
            
            // Итоговый свет = (Солнце * Тени) + Фон
            // Это гарантирует, что даже в полной тени блоки видны на 50%
            float finalLight = ambientLight + (directLight * combinedShadow);
            
            vec3 finalColor = finalTexColor * finalLight;
            
            // Туман
            float fogFactor = smoothstep(uFogNear, uFogFar, vDist);
            gl_FragColor = vec4(mix(finalColor, uFogColor, fogFactor), 1.0);
        }
    `
};

// Advanced Volumetric Clouds Shader - полная версия с физикой освещения
export const VolumetricCloudsShader = {
    vertex: `
        // Стандартные атрибуты и униформы добавляются Three.js автоматически
        varying vec2 vUv;
        varying vec3 vWorldPosition;
        
        void main() {
            vUv = uv;
            vec4 worldPosition = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPosition.xyz;
            
            vec4 mvPosition = viewMatrix * worldPosition;
            gl_Position = projectionMatrix * mvPosition;
        }
    `,
    
    fragment: `
        precision highp float;
        
        #define PI 3.14159265359
        
        uniform float uTime;
        uniform vec3 uCameraPosition;
        uniform vec3 uSunDirection;
        uniform float uCloudHeight;
        uniform float uCloudThickness;
        uniform float uCloudCoverage; // Настраиваемое покрытие
        
        varying vec2 vUv;
        varying vec3 vWorldPosition;
        
        /**** НАСТРОЙКИ ОБЛАКОВ *****************************************************/
        #define CLOUD_MARCH_STEPS 50
        #define CLOUD_THICK 90.0
        #define CLOUD_ABSORB_COEFF 1.0
        /***************************************************************************/
        
        // Volume sampler structure
        struct VolumeSampler {
            vec3 origin;
            vec3 pos;
            float height;
            float coeff_absorb;
            float T; // transmittance
            vec3 C; // color
            float alpha;
        };
        
        // Hash function
        float hash(float n) {
            return fract(sin(n) * 753.5453123);
        }
        
        // 3D noise
        float noise_iq(vec3 x) {
            vec3 p = floor(x);
            vec3 f = fract(x);
            f = f * f * (3.0 - 2.0 * f);
            
            float n = p.x + p.y * 157.0 + 113.0 * p.z;
            return mix(
                mix(
                    mix(hash(n + 0.0), hash(n + 1.0), f.x),
                    mix(hash(n + 157.0), hash(n + 158.0), f.x),
                    f.y
                ),
                mix(
                    mix(hash(n + 113.0), hash(n + 114.0), f.x),
                    mix(hash(n + 270.0), hash(n + 271.0), f.x),
                    f.y
                ),
                f.z
            );
        }
        
        // FBM для облаков (5 октав, с abs для billowy clouds)
        float fbm_clouds(vec3 pos, float lacunarity, float init_gain, float gain) {
            vec3 p = pos;
            float H = init_gain;
            float t = 0.0;
            
            for (int i = 0; i < 5; i++) {
                t += abs(noise_iq(p)) * H;
                p *= lacunarity;
                H *= gain;
            }
            
            return t;
        }
        
        // Sky color rendering
        vec3 render_sky_color(vec3 eye_dir) {
            vec3 sun_color = vec3(1.0, 0.7, 0.55);
            float sun_amount = max(dot(eye_dir, uSunDirection), 0.0);
            
            vec3 sky = mix(vec3(0.0, 0.1, 0.4), vec3(0.3, 0.6, 0.8), 1.0 - eye_dir.y);
            sky += sun_color * min(pow(sun_amount, 1500.0) * 5.0, 1.0);
            sky += sun_color * min(pow(sun_amount, 10.0) * 0.6, 1.0);
            
            return sky;
        }
        
        // Cloud density function
        float density_func(vec3 pos, float h) {
            vec3 wind_dir = vec3(0.0, 0.0, -uTime * 0.2);
            // Увеличили scale в 3 раза для более мелких облаков
            vec3 p = pos * 0.003 + wind_dir;
            
            float dens = fbm_clouds(p * 2.032, 2.6434, 0.5, 0.5);
            // Используем настраиваемое покрытие из uniform
            dens *= smoothstep(uCloudCoverage, uCloudCoverage + 0.035, dens);
            
            return dens;
        }
        
        // Volume illumination (Beer's law approximation)
        float illuminate_volume(float height) {
            return exp(height) / 1.95;
        }
        
        // Initialize volume sampler
        VolumeSampler begin_volume(vec3 origin, float coeff_absorb) {
            VolumeSampler v;
            v.origin = origin;
            v.pos = origin;
            v.height = 0.0;
            v.coeff_absorb = coeff_absorb;
            v.T = 1.0;
            v.C = vec3(0.0);
            v.alpha = 0.0;
            return v;
        }
        
        // Integrate volume step
        void integrate_volume(
            inout VolumeSampler vol,
            float density,
            float dt,
            float illumination
        ) {
            // Beer-Lambert law
            float T_i = exp(-vol.coeff_absorb * density * dt);
            vol.T *= T_i;
            
            // Integrate radiance
            vol.C += vol.T * illumination * density * dt;
            
            // Accumulate opacity
            vol.alpha += (1.0 - T_i) * (1.0 - vol.alpha);
        }
        
        // Main cloud rendering
        vec4 render_clouds(vec3 eye_origin, vec3 eye_dir) {
            const int steps = CLOUD_MARCH_STEPS;
            const float march_step = CLOUD_THICK / float(steps);
            
            // Project ray onto cloud layer
            vec3 projection = eye_dir / max(eye_dir.y, 0.001);
            vec3 iter = projection * march_step;
            
            float cutoff = dot(eye_dir, vec3(0.0, 1.0, 0.0));
            
            // Start volume sampling
            vec3 start_pos = eye_origin + projection * uCloudHeight;
            VolumeSampler cloud = begin_volume(start_pos, CLOUD_ABSORB_COEFF);
            
            for (int i = 0; i < CLOUD_MARCH_STEPS; i++) {
                // Calculate height in cloud layer
                cloud.height = (cloud.pos.y - cloud.origin.y) / CLOUD_THICK;
                
                // Get density at current position
                float dens = density_func(cloud.pos, cloud.height);
                
                // Calculate illumination
                float illum = illuminate_volume(cloud.height);
                
                // Integrate this step
                integrate_volume(cloud, dens, march_step, illum);
                
                // March forward
                cloud.pos += iter;
                
                // Early exit if opaque
                if (cloud.alpha > 0.999) break;
            }
            
            // Apply cutoff for horizon
            return vec4(cloud.C, cloud.alpha * smoothstep(0.0, 0.2, cutoff));
        }
        
        void main() {
            vec3 worldPos = vWorldPosition;
            vec3 rd = normalize(worldPos - uCameraPosition);
            vec3 ro = uCameraPosition;
            
            // Don't render clouds below horizon
            if (dot(rd, vec3(0.0, 1.0, 0.0)) < 0.05) {
                discard;
            }
            
            // Render sky
            vec3 sky = render_sky_color(rd);
            
            // Render clouds
            vec4 cld = render_clouds(ro, rd);
            
            // Composite
            vec3 col = mix(sky, cld.rgb, cld.a);
            
            gl_FragColor = vec4(col, max(cld.a, 0.0));
        }
    `
};
