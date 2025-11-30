// shaders.js
// УЛУЧШЕННЫЕ ШЕЙДЕРЫ ДЛЯ УСТРАНЕНИЯ АРТЕФАКТОВ
export const VoxelShader = {
    vertex: `
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vWorldPosition;
        varying float vDist;

        #include <common>
        #include <shadowmap_pars_vertex>

        void main() {
            vUv = uv;
            vNormal = normalize(normalMatrix * normal);

            vec4 worldPosition = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPosition.xyz;

            vec4 mvPosition = viewMatrix * worldPosition;
            vDist = -mvPosition.z;

            gl_Position = projectionMatrix * mvPosition;

            #include <shadowmap_vertex>
        }
    `,

    fragment: `
        uniform sampler2D uMap;
        uniform vec3 uSunDir;
        uniform vec3 uFogColor;
        uniform float uFogNear;
        uniform float uFogFar;

        varying vec2 vUv;
        varying vec3 vNormal;
        varying float vDist;

        #include <common>
        #include <packing>
        #include <shadowmap_pars_fragment>

        void main() {
            // Более агрессивный alpha test для устранения артефактов
            vec4 texColor = texture2D(uMap, vUv);
            if(texColor.a < 0.9) discard; // Увеличено с 0.5 до 0.9

            // Улучшенное освещение
            float NdotL = max(0.0, dot(vNormal, uSunDir));
            float directLight = NdotL * 1.3;

            float shadow = 1.0;
            #ifdef USE_SHADOWMAP
                shadow *= getShadowMask();
            #endif

            // Увеличен ambient для уменьшения контраста
            float ambientLight = 0.1;

            float finalLight = ambientLight + (directLight * shadow);

            // Гарантируем, что цвет не будет слишком темным
            finalLight = max(finalLight, 0.15);

            vec3 finalColor = texColor.rgb * finalLight;

            // Более плавный туман
            float fogFactor = smoothstep(uFogNear, uFogFar, vDist);
            gl_FragColor = vec4(mix(finalColor, uFogColor, fogFactor), 1.0);
        }
    `
};