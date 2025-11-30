import * as THREE from 'three';

export class Sky {
    constructor(scene) {
        const geometry = new THREE.SphereGeometry(500, 32, 15);

        this.material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uSunPosition: { value: new THREE.Vector3() },
                uMoonPosition: { value: new THREE.Vector3() }
            },
            vertexShader: `
                varying vec3 vLocalPosition;
                varying vec3 vSunDirection;
                varying vec3 vMoonDirection;

                uniform vec3 uSunPosition;
                uniform vec3 uMoonPosition;

                void main() {
                    vLocalPosition = position;
                    vSunDirection = normalize(uSunPosition);
                    vMoonDirection = normalize(uMoonPosition);

                    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                    gl_Position = projectionMatrix * viewMatrix * worldPosition;
                }
            `,
            fragmentShader: `
                uniform float uTime;
                varying vec3 vLocalPosition;
                varying vec3 vSunDirection;
                varying vec3 vMoonDirection;

                float hash(float n) { return fract(sin(n) * 43758.5453123); }

                void main() {
                    vec3 direction = normalize(vLocalPosition);
                    float sunHeight = vSunDirection.y;

                    // ЦВЕТА
                    vec3 dayColorTop = vec3(0.1, 0.4, 0.8);
                    vec3 dayColorBot = vec3(0.5, 0.7, 0.9);
                    vec3 nightColorTop = vec3(0.0, 0.0, 0.02);
                    vec3 nightColorBot = vec3(0.01, 0.01, 0.05);
                    vec3 sunsetColor = vec3(0.9, 0.3, 0.1);

                    float dayMix = smoothstep(-0.1, 0.1, sunHeight);
                    vec3 skyTop = mix(nightColorTop, dayColorTop, dayMix);
                    vec3 skyBot = mix(nightColorBot, dayColorBot, dayMix);

                    float horizonMix = 1.0 - max(0.0, direction.y);
                    skyBot = mix(skyBot, sunsetColor, (1.0 - abs(sunHeight * 5.0)) * horizonMix * dayMix);

                    vec3 finalColor = mix(skyBot, skyTop, max(0.0, direction.y));

                    // --- ЗВЕЗДЫ ---
                    if (dayMix < 0.8) {
                        vec3 starGrid = floor(direction * 250.0); // Размер пикселя звезды
                        float starRnd = hash(starGrid.x * 12.0 + starGrid.y * 54.0 + starGrid.z * 113.0);

                        if (starRnd > 0.995) {
                            // ИСПРАВЛЕНИЕ: Мерцание теперь мягкое (от 0.6 до 1.0)
                            // Они больше не гаснут полностью
                            float twinkle = 0.6 + 0.4 * sin(uTime * 1.0 + starRnd * 100.0);

                            finalColor += vec3(1.0) * twinkle * (1.0 - dayMix);
                        }
                    }

                    // --- СОЛНЦЕ ---
                    float sunDot = dot(direction, vSunDirection);
                    float sunDisk = smoothstep(0.999, 0.9992, sunDot);
                    float sunGlow = smoothstep(0.99, 1.0, sunDot) * 0.4;

                    finalColor += vec3(1.0, 0.9, 0.6) * sunDisk;
                    finalColor += vec3(1.0, 0.6, 0.3) * sunGlow * dayMix;

                    // --- ЛУНА ---
                    float moonDot = dot(direction, vMoonDirection);
                    float moonDisk = smoothstep(0.998, 0.9985, moonDot);
                    if (moonDot > 0.99) {
                        finalColor += vec3(0.9) * moonDisk;
                    }

                    gl_FragColor = vec4(finalColor, 1.0);
                }
            `,
            side: THREE.BackSide
        });

        this.mesh = new THREE.Mesh(geometry, this.material);
        scene.add(this.mesh);
    }

    update(playerPos, time) {
        this.mesh.position.copy(playerPos);
        this.material.uniforms.uTime.value = time;
    }

    updateSunMoon(sunPos, moonPos) {
        this.material.uniforms.uSunPosition.value.copy(sunPos);
        this.material.uniforms.uMoonPosition.value.copy(moonPos);
    }
}