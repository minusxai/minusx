'use client';

import { useRef, useEffect } from 'react';

interface DitherProps {
  waveSpeed?: number;
  waveFrequency?: number;
  waveAmplitude?: number;
  waveColor?: [number, number, number];
  colorNum?: number;
  pixelSize?: number;
  disableAnimation?: boolean;
  enableMouseInteraction?: boolean;
  mouseRadius?: number;
  opacity?: number;
}

const VERTEX_SRC = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

// Combined wave + dither in one pass (replaces three.js ShaderMaterial + EffectComposer)
const FRAGMENT_SRC = `#version 300 es
precision highp float;

uniform vec2 resolution;
uniform float time;
uniform float waveSpeed;
uniform float waveFrequency;
uniform float waveAmplitude;
uniform vec3 waveColor;
uniform vec2 mousePos;
uniform int enableMouseInteraction;
uniform float mouseRadius;
uniform float colorNum;
uniform float pixelSize;

out vec4 fragColor;

// Perlin noise (identical to original GLSL)
vec4 mod289(vec4 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
vec2 fade(vec2 t) { return t*t*t*(t*(t*6.0-15.0)+10.0); }

float cnoise(vec2 P) {
  vec4 Pi = floor(P.xyxy) + vec4(0.0,0.0,1.0,1.0);
  vec4 Pf = fract(P.xyxy) - vec4(0.0,0.0,1.0,1.0);
  Pi = mod289(Pi);
  vec4 ix = Pi.xzxz;
  vec4 iy = Pi.yyww;
  vec4 fx = Pf.xzxz;
  vec4 fy = Pf.yyww;
  vec4 i = permute(permute(ix) + iy);
  vec4 gx = fract(i * (1.0/41.0)) * 2.0 - 1.0;
  vec4 gy = abs(gx) - 0.5;
  vec4 tx = floor(gx + 0.5);
  gx = gx - tx;
  vec2 g00 = vec2(gx.x, gy.x);
  vec2 g10 = vec2(gx.y, gy.y);
  vec2 g01 = vec2(gx.z, gy.z);
  vec2 g11 = vec2(gx.w, gy.w);
  vec4 norm = taylorInvSqrt(vec4(dot(g00,g00), dot(g01,g01), dot(g10,g10), dot(g11,g11)));
  g00 *= norm.x; g01 *= norm.y; g10 *= norm.z; g11 *= norm.w;
  float n00 = dot(g00, vec2(fx.x, fy.x));
  float n10 = dot(g10, vec2(fx.y, fy.y));
  float n01 = dot(g01, vec2(fx.z, fy.z));
  float n11 = dot(g11, vec2(fx.w, fy.w));
  vec2 fade_xy = fade(Pf.xy);
  vec2 n_x = mix(vec2(n00, n01), vec2(n10, n11), fade_xy.x);
  return 2.3 * mix(n_x.x, n_x.y, fade_xy.y);
}

const int OCTAVES = 4;
float fbm(vec2 p) {
  float value = 0.0;
  float amp = 1.0;
  float freq = waveFrequency;
  for (int i = 0; i < OCTAVES; i++) {
    value += amp * abs(cnoise(p));
    p *= freq;
    amp *= waveAmplitude;
  }
  return value;
}

float pattern(vec2 p) {
  vec2 p2 = p - time * waveSpeed;
  return fbm(p + fbm(p2));
}

float bayer8(ivec2 c) {
  const float m[64] = float[64](
     0.0,48.0,12.0,60.0, 3.0,51.0,15.0,63.0,
    32.0,16.0,44.0,28.0,35.0,19.0,47.0,31.0,
     8.0,56.0, 4.0,52.0,11.0,59.0, 7.0,55.0,
    40.0,24.0,36.0,20.0,43.0,27.0,39.0,23.0,
     2.0,50.0,14.0,62.0, 1.0,49.0,13.0,61.0,
    34.0,18.0,46.0,30.0,33.0,17.0,45.0,29.0,
    10.0,58.0, 6.0,54.0, 9.0,57.0, 5.0,53.0,
    42.0,26.0,38.0,22.0,41.0,25.0,37.0,21.0
  );
  int x = int(mod(float(c.x), 8.0));
  int y = int(mod(float(c.y), 8.0));
  return m[y * 8 + x] / 64.0;
}

void main() {
  // Snap to pixel blocks (pixelation effect from original dither pass)
  vec2 blockCoord = floor(gl_FragCoord.xy / pixelSize);
  vec2 snappedCoord = (blockCoord + 0.5) * pixelSize;

  vec2 uv = snappedCoord / resolution - 0.5;
  uv.x *= resolution.x / resolution.y;

  float f = pattern(uv);

  if (enableMouseInteraction == 1) {
    vec2 mouseNDC = (mousePos / resolution - 0.5) * vec2(1.0, -1.0);
    mouseNDC.x *= resolution.x / resolution.y;
    float dist = length(uv - mouseNDC);
    float effect = 1.0 - smoothstep(0.0, mouseRadius, dist);
    f -= 0.5 * effect;
  }

  vec3 col = mix(vec3(0.0), waveColor, f);

  // Bayer dithering (identical math to original RetroEffect)
  float threshold = bayer8(ivec2(blockCoord)) - 0.25;
  float step_ = 1.0 / (colorNum - 1.0);
  col += threshold * step_;
  col = clamp(col + 0.1, 0.0, 1.0);
  col = floor(col * (colorNum - 1.0) + 0.5) / (colorNum - 1.0);

  fragColor = vec4(col, 0.8);
}`;

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('[Dither] shader error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function Dither({
  waveSpeed = 0.05,
  waveFrequency = 3,
  waveAmplitude = 0.3,
  waveColor = [0.5, 0.5, 0.5],
  colorNum = 4,
  pixelSize = 2,
  disableAnimation = false,
  enableMouseInteraction = true,
  mouseRadius = 1,
  opacity = 1,
}: DitherProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep a live ref to props so the render loop always reads current values
  const propsRef = useRef({ waveSpeed, waveFrequency, waveAmplitude, waveColor, colorNum, pixelSize, disableAnimation, enableMouseInteraction, mouseRadius });
  useEffect(() => {
    propsRef.current = { waveSpeed, waveFrequency, waveAmplitude, waveColor, colorNum, pixelSize, disableAnimation, enableMouseInteraction, mouseRadius };
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const gl = canvas.getContext('webgl2');
    if (!gl) return;

    const vert = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SRC);
    const frag = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC);
    if (!vert || !frag) return;

    const program = gl.createProgram()!;
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('[Dither] link error:', gl.getProgramInfoLog(program));
      return;
    }

    // Full-screen quad
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);

    gl.useProgram(program);
    const aPos = gl.getAttribLocation(program, 'aPosition');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const u = (name: string) => gl.getUniformLocation(program, name);
    const uniforms = {
      resolution: u('resolution'), time: u('time'),
      waveSpeed: u('waveSpeed'), waveFrequency: u('waveFrequency'), waveAmplitude: u('waveAmplitude'),
      waveColor: u('waveColor'), mousePos: u('mousePos'),
      enableMouseInteraction: u('enableMouseInteraction'), mouseRadius: u('mouseRadius'),
      colorNum: u('colorNum'), pixelSize: u('pixelSize'),
    };

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const mouse = { x: 0, y: 0 };
    const startTime = performance.now();
    let frameId = 0;
    let lastFrame = 0;
    const TARGET_FPS = 30;
    const FRAME_MS = 1000 / TARGET_FPS;

    const resize = () => {
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(container);

    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
    };
    window.addEventListener('mousemove', onMouseMove);

    const render = (now: number) => {
      if (now - lastFrame < FRAME_MS) {
        frameId = requestAnimationFrame(render);
        return;
      }
      lastFrame = now;
      const p = propsRef.current;
      const W = canvas.width;
      const H = canvas.height;
      if (W > 0 && H > 0) {
        const t = p.disableAnimation ? 0 : (performance.now() - startTime) / 1000;
        gl.uniform2f(uniforms.resolution, W, H);
        gl.uniform1f(uniforms.time, t);
        gl.uniform1f(uniforms.waveSpeed, p.waveSpeed);
        gl.uniform1f(uniforms.waveFrequency, p.waveFrequency);
        gl.uniform1f(uniforms.waveAmplitude, p.waveAmplitude);
        gl.uniform3f(uniforms.waveColor, p.waveColor[0], p.waveColor[1], p.waveColor[2]);
        gl.uniform2f(uniforms.mousePos, mouse.x, mouse.y);
        gl.uniform1i(uniforms.enableMouseInteraction, p.enableMouseInteraction ? 1 : 0);
        gl.uniform1f(uniforms.mouseRadius, p.mouseRadius);
        gl.uniform1f(uniforms.colorNum, p.colorNum);
        gl.uniform1f(uniforms.pixelSize, p.pixelSize);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      frameId = requestAnimationFrame(render);
    };
    frameId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(frameId);
      ro.disconnect();
      window.removeEventListener('mousemove', onMouseMove);
      gl.deleteProgram(program);
      gl.deleteShader(vert);
      gl.deleteShader(frag);
      gl.deleteBuffer(buf);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={containerRef} style={{ opacity, width: '100%', height: '100%' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
}
