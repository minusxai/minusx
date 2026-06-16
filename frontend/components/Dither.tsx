'use client';

import { useRef, useEffect, useState } from 'react';

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
  darkColor?: [number, number, number];
  lightColor?: [number, number, number];
  /** Render with a transparent background — only the dither dots paint, gaps stay see-through. */
  transparent?: boolean;
}

/* ── Shaders (GLSL ES 3.00 for WebGL2) ── */

const VERT = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

// Pass 1: wave noise → texture
const WAVE_FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_waveSpeed;
uniform float u_waveFrequency;
uniform float u_waveAmplitude;
uniform vec3 u_waveColor;

vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
vec2 fade(vec2 t){return t*t*t*(t*(t*6.0-15.0)+10.0);}

float cnoise(vec2 P){
  vec4 Pi=floor(P.xyxy)+vec4(0,0,1,1);
  vec4 Pf=fract(P.xyxy)-vec4(0,0,1,1);
  Pi=mod289(Pi);
  vec4 ix=Pi.xzxz,iy=Pi.yyww;
  vec4 fx=Pf.xzxz,fy=Pf.yyww;
  vec4 i=permute(permute(ix)+iy);
  vec4 gx=fract(i*(1.0/41.0))*2.0-1.0;
  vec4 gy=abs(gx)-0.5;
  vec4 tx=floor(gx+0.5);
  gx=gx-tx;
  vec2 g00=vec2(gx.x,gy.x),g10=vec2(gx.y,gy.y);
  vec2 g01=vec2(gx.z,gy.z),g11=vec2(gx.w,gy.w);
  vec4 norm=taylorInvSqrt(vec4(dot(g00,g00),dot(g01,g01),dot(g10,g10),dot(g11,g11)));
  g00*=norm.x;g01*=norm.y;g10*=norm.z;g11*=norm.w;
  float n00=dot(g00,vec2(fx.x,fy.x));
  float n10=dot(g10,vec2(fx.y,fy.y));
  float n01=dot(g01,vec2(fx.z,fy.z));
  float n11=dot(g11,vec2(fx.w,fy.w));
  vec2 fade_xy=fade(Pf.xy);
  vec2 n_x=mix(vec2(n00,n01),vec2(n10,n11),fade_xy.x);
  return 2.3*mix(n_x.x,n_x.y,fade_xy.y);
}

float fbm(vec2 p){
  float value=0.0,amp=1.0,freq=u_waveFrequency;
  for(int i=0;i<4;i++){value+=amp*abs(cnoise(p));p*=freq;amp*=u_waveAmplitude;}
  return value;
}

float pattern(vec2 p){
  float t=u_time*u_waveSpeed;
  vec2 q=vec2(
    fbm(p+vec2(1.7,9.2)+vec2(cos(t*0.3)*0.4,sin(t*0.2)*0.3)),
    fbm(p+vec2(8.3,2.8)+vec2(sin(t*0.25)*0.3,cos(t*0.35)*0.4))
  );
  return fbm(p+q);
}

void main(){
  vec2 uv=gl_FragCoord.xy/u_resolution-0.5;
  uv.x*=u_resolution.x/u_resolution.y;
  float f=pattern(uv);
  vec3 col=mix(vec3(1.0),u_waveColor,f);
  fragColor=vec4(col,1.0);
}
`;

// Pass 2: dither post-process
const DITHER_FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform sampler2D u_tex;
uniform vec2 u_resolution;
uniform float u_colorNum;
uniform float u_pixelSize;
uniform vec3 u_darkColor;
uniform vec3 u_lightColor;
uniform float u_transparent;

const float bayer[64] = float[64](
  0.0/64.0,48.0/64.0,12.0/64.0,60.0/64.0, 3.0/64.0,51.0/64.0,15.0/64.0,63.0/64.0,
  32.0/64.0,16.0/64.0,44.0/64.0,28.0/64.0,35.0/64.0,19.0/64.0,47.0/64.0,31.0/64.0,
  8.0/64.0,56.0/64.0, 4.0/64.0,52.0/64.0,11.0/64.0,59.0/64.0, 7.0/64.0,55.0/64.0,
  40.0/64.0,24.0/64.0,36.0/64.0,20.0/64.0,43.0/64.0,27.0/64.0,39.0/64.0,23.0/64.0,
  2.0/64.0,50.0/64.0,14.0/64.0,62.0/64.0, 1.0/64.0,49.0/64.0,13.0/64.0,61.0/64.0,
  34.0/64.0,18.0/64.0,46.0/64.0,30.0/64.0,33.0/64.0,17.0/64.0,45.0/64.0,29.0/64.0,
  10.0/64.0,58.0/64.0, 6.0/64.0,54.0/64.0, 9.0/64.0,57.0/64.0, 5.0/64.0,53.0/64.0,
  42.0/64.0,26.0/64.0,38.0/64.0,22.0/64.0,41.0/64.0,25.0/64.0,37.0/64.0,21.0/64.0
);

void main(){
  // Snap UVs to pixel grid for blocky look
  vec2 ps=u_pixelSize/u_resolution;
  vec2 snapped=ps*floor(gl_FragCoord.xy/u_pixelSize);
  vec4 color=texture(u_tex,snapped);

  // Ordered dither (8x8 Bayer)
  vec2 sc=floor(gl_FragCoord.xy/u_pixelSize);
  int bx=int(mod(sc.x,8.0));
  int by=int(mod(sc.y,8.0));
  float threshold=bayer[by*8+bx]-0.25;
  float step=1.0/(u_colorNum-1.0);
  color.rgb=clamp(color.rgb+threshold*step+0.45,0.0,1.0);
  color.rgb=floor(color.rgb*(u_colorNum-1.0)+0.5)/(u_colorNum-1.0);

  // Dot mask
  vec2 cell=fract(gl_FragCoord.xy/u_pixelSize);
  float dist=length(cell-0.5);
  float dot=1.0-smoothstep(0.3,0.38,dist);

  // Tint: map quantized luminance through dark→light
  float lum=(color.r+color.g+color.b)/3.0;
  vec3 tinted=mix(u_darkColor,u_lightColor,lum);

  if (u_transparent > 0.5) {
    // Transparent background: only the dots paint, gaps stay see-through.
    // Output is premultiplied (matches the canvas' premultipliedAlpha:true).
    fragColor = vec4(tinted * dot, dot);
  } else {
    color.rgb = mix(u_lightColor, tinted, dot);
    fragColor = color;
  }
}
`;

/* ── WebGL helpers ── */

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  return s;
}

function createProgram(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, compileShader(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compileShader(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  return p;
}

/**
 * Check if a program is ready to use. With KHR_parallel_shader_compile,
 * this returns false while the GPU is still compiling in the background.
 * Without the extension, this always returns true (blocking compile already finished).
 */
function isProgramReady(gl: WebGL2RenderingContext, program: WebGLProgram, ext: { COMPLETION_STATUS_KHR: number } | null): boolean {
  if (ext) {
    return gl.getProgramParameter(program, ext.COMPLETION_STATUS_KHR) as boolean;
  }
  // No parallel compile extension — check link status (compilation already completed synchronously)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(program));
  }
  return true;
}

export function Dither({
  waveSpeed = 0.05,
  waveFrequency = 3,
  waveAmplitude = 0.3,
  waveColor = [0.5, 0.5, 0.5],
  colorNum = 4,
  pixelSize = 2,
  disableAnimation = false,
  opacity = 1,
  darkColor = [0, 0, 0],
  lightColor = [1, 1, 1],
  transparent = false,
}: DitherProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const visibleRef = useRef(!disableAnimation);
  const [reducedMotion, setReducedMotion] = useState(false);

  const propsRef = useRef({
    waveSpeed, waveFrequency, waveAmplitude, waveColor,
    colorNum, pixelSize, darkColor, lightColor,
  });
  propsRef.current = {
    waveSpeed, waveFrequency, waveAmplitude, waveColor,
    colorNum, pixelSize, darkColor, lightColor,
  };

  visibleRef.current = !disableAnimation;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    if (reducedMotion) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    let cancelled = false;
    let cleanupFn: (() => void) | undefined;
    let idleId: number | undefined;

    // Defer heavy WebGL init until the browser is idle so it never blocks LCP.
    // Falls back to a 2-frame rAF on browsers without requestIdleCallback (Safari).
    const ric = (window as any).requestIdleCallback as
      | ((cb: () => void, opts?: { timeout: number }) => number)
      | undefined;
    const schedule = (cb: () => void) => {
      if (ric) {
        idleId = ric(cb, { timeout: 1500 });
        return;
      }
      requestAnimationFrame(() => {
        idleId = requestAnimationFrame(cb);
      });
    };
    const cancelSchedule = () => {
      if (idleId === undefined) return;
      const cic = (window as any).cancelIdleCallback as ((id: number) => void) | undefined;
      if (cic) cic(idleId);
      else cancelAnimationFrame(idleId);
    };

    schedule(() => {
      if (cancelled) return;

    const gl = canvas.getContext('webgl2', { alpha: transparent, antialias: false, preserveDrawingBuffer: false });
    if (!gl) return;

    // Full-screen quad
    const quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    // Programs — kick off compilation (may run async with KHR_parallel_shader_compile)
    const parallelExt = gl.getExtension('KHR_parallel_shader_compile');
    const waveProg = createProgram(gl, VERT, WAVE_FRAG);
    const ditherProg = createProgram(gl, VERT, DITHER_FRAG);
    let shadersReady = false;

    // Uniform locations are only valid after linking completes,
    // so we resolve them lazily on first draw after shaders are ready.
    let wU: {
      a_pos: number;
      resolution: WebGLUniformLocation | null;
      time: WebGLUniformLocation | null;
      waveSpeed: WebGLUniformLocation | null;
      waveFrequency: WebGLUniformLocation | null;
      waveAmplitude: WebGLUniformLocation | null;
      waveColor: WebGLUniformLocation | null;
    } | null = null;

    let dU: {
      a_pos: number;
      tex: WebGLUniformLocation | null;
      resolution: WebGLUniformLocation | null;
      colorNum: WebGLUniformLocation | null;
      pixelSize: WebGLUniformLocation | null;
      darkColor: WebGLUniformLocation | null;
      lightColor: WebGLUniformLocation | null;
      transparent: WebGLUniformLocation | null;
    } | null = null;

    const resolveUniforms = () => {
      wU = {
        a_pos: gl.getAttribLocation(waveProg, 'a_pos'),
        resolution: gl.getUniformLocation(waveProg, 'u_resolution'),
        time: gl.getUniformLocation(waveProg, 'u_time'),
        waveSpeed: gl.getUniformLocation(waveProg, 'u_waveSpeed'),
        waveFrequency: gl.getUniformLocation(waveProg, 'u_waveFrequency'),
        waveAmplitude: gl.getUniformLocation(waveProg, 'u_waveAmplitude'),
        waveColor: gl.getUniformLocation(waveProg, 'u_waveColor'),
      };
      dU = {
        a_pos: gl.getAttribLocation(ditherProg, 'a_pos'),
        tex: gl.getUniformLocation(ditherProg, 'u_tex'),
        resolution: gl.getUniformLocation(ditherProg, 'u_resolution'),
        colorNum: gl.getUniformLocation(ditherProg, 'u_colorNum'),
        pixelSize: gl.getUniformLocation(ditherProg, 'u_pixelSize'),
        darkColor: gl.getUniformLocation(ditherProg, 'u_darkColor'),
        lightColor: gl.getUniformLocation(ditherProg, 'u_lightColor'),
        transparent: gl.getUniformLocation(ditherProg, 'u_transparent'),
      };
    };

    // FBO for wave pass
    const fbTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, fbTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fbTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    let w = 0, h = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1); // cap at 1x for perf
      w = Math.floor(parent.clientWidth * dpr);
      h = Math.floor(parent.clientHeight * dpr);
      canvas.width = w;
      canvas.height = h;
      gl.bindTexture(gl.TEXTURE_2D, fbTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    };
    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(parent);

    const t0 = performance.now() / 1000;
    let lastFrame = 0;

    const draw = (now: number) => {
      // Throttle to ~20fps
      if (now - lastFrame < 50) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }
      lastFrame = now;

      // Wait for shaders to finish compiling (non-blocking with KHR_parallel_shader_compile)
      if (!shadersReady) {
        if (isProgramReady(gl, waveProg, parallelExt) && isProgramReady(gl, ditherProg, parallelExt)) {
          shadersReady = true;
          resolveUniforms();
        } else {
          // Shaders still compiling on GPU — skip this frame, try next
          rafRef.current = requestAnimationFrame(draw);
          return;
        }
      }

      const p = propsRef.current;
      const time = visibleRef.current ? (now / 1000 - t0) : 0;

      gl.viewport(0, 0, w, h);

      // Pass 1: Wave noise → FBO
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.useProgram(waveProg);
      gl.enableVertexAttribArray(wU!.a_pos);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.vertexAttribPointer(wU!.a_pos, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(wU!.resolution, w, h);
      gl.uniform1f(wU!.time, time);
      gl.uniform1f(wU!.waveSpeed, p.waveSpeed);
      gl.uniform1f(wU!.waveFrequency, p.waveFrequency);
      gl.uniform1f(wU!.waveAmplitude, p.waveAmplitude);
      gl.uniform3f(wU!.waveColor, p.waveColor[0], p.waveColor[1], p.waveColor[2]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // Pass 2: Dither → screen
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.useProgram(ditherProg);
      gl.enableVertexAttribArray(dU!.a_pos);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.vertexAttribPointer(dU!.a_pos, 2, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, fbTex);
      gl.uniform1i(dU!.tex, 0);
      gl.uniform2f(dU!.resolution, w, h);
      gl.uniform1f(dU!.colorNum, p.colorNum);
      gl.uniform1f(dU!.pixelSize, p.pixelSize);
      gl.uniform3f(dU!.darkColor, p.darkColor[0], p.darkColor[1], p.darkColor[2]);
      gl.uniform3f(dU!.lightColor, p.lightColor[0], p.lightColor[1], p.lightColor[2]);
      gl.uniform1f(dU!.transparent, transparent ? 1 : 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);

    cleanupFn = () => {
      ro.disconnect();
      cancelAnimationFrame(rafRef.current);
      gl.deleteProgram(waveProg);
      gl.deleteProgram(ditherProg);
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(fbTex);
      gl.deleteBuffer(quad);
    };
    }); // end deferred init

    return () => {
      cancelled = true;
      cancelSchedule();
      cleanupFn?.();
    };
  }, [reducedMotion, transparent]);

  if (reducedMotion) {
    return (
      <div
        style={{
          opacity,
          width: '100%',
          height: '100%',
          background: transparent ? 'transparent' : '#e6e3df',
          backgroundImage: 'radial-gradient(circle, #a09b95 0.5px, transparent 0.5px)',
          backgroundSize: '5px 5px',
        }}
      />
    );
  }

  return (
    <div style={{ opacity, width: '100%', height: '100%' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
