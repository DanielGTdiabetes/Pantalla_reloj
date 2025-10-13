import { useEffect } from 'react';
import { ENABLE_WEBGL } from '../utils/runtimeFlags';

const NOISE_VERTEX = `
  attribute vec2 position;
  varying vec2 vUv;
  void main() {
    vUv = (position + 1.0) * 0.5;
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

const NOISE_FRAGMENT = `
  precision mediump float;
  varying vec2 vUv;
  uniform float uTime;
  float rand(vec2 co) {
    return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
  }
  void main() {
    float grain = rand(vUv * uTime) * 0.08;
    float vignette = smoothstep(0.9, 0.2, length(vUv - 0.5));
    float alpha = 0.15 + grain * 0.6;
    gl_FragColor = vec4(vec3(grain * 0.6), alpha * vignette);
  }
`;

export const SceneEffects = () => {
  useEffect(() => {
    if (!ENABLE_WEBGL) {
      return undefined;
    }

    const canvas = document.createElement('canvas');
    canvas.id = 'scene-noise';
    canvas.style.position = 'fixed';
    canvas.style.inset = '0';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '5';
    canvas.style.mixBlendMode = 'screen';
    canvas.style.opacity = '0.9';
    document.body.appendChild(canvas);

    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false });
    if (!gl) {
      canvas.remove();
      return undefined;
    }

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = Math.floor(window.innerWidth * dpr);
      const height = Math.floor(window.innerHeight * dpr);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }
    };

    const createShader = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) {
        throw new Error('No se pudo crear shader');
      }
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const info = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`Shader error: ${info ?? 'unknown'}`);
      }
      return shader;
    };

    const vertexShader = createShader(gl.VERTEX_SHADER, NOISE_VERTEX);
    const fragmentShader = createShader(gl.FRAGMENT_SHADER, NOISE_FRAGMENT);

    const program = gl.createProgram();
    if (!program) {
      throw new Error('No se pudo crear programa WebGL');
    }
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`No se pudo enlazar programa: ${info ?? 'unknown'}`);
    }
    gl.useProgram(program);

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    const vertices = new Float32Array([
      -1, -1,
      1, -1,
      -1, 1,
      -1, 1,
      1, -1,
      1, 1,
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    const positionLocation = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    const timeLocation = gl.getUniformLocation(program, 'uTime');
    let frame = 0;
    let rafId = 0;

    const render = () => {
      frame += 1;
      resize();
      gl.uniform1f(timeLocation, frame * 0.6);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      rafId = window.requestAnimationFrame(render);
    };

    resize();
    rafId = window.requestAnimationFrame(render);

    document.documentElement.classList.add('with-depth-blur');

    return () => {
      window.cancelAnimationFrame(rafId);
      document.documentElement.classList.remove('with-depth-blur');
      gl.deleteBuffer(positionBuffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      canvas.remove();
    };
  }, []);

  return null;
};

export default SceneEffects;
