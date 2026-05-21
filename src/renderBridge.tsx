import * as THREE from 'three';
import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import * as Tone from 'tone';
import { drawFrame as professionalDrawFrame } from "./Render/Render";



export interface RenderEngineContext {
  time: number;
  projectConfig: any;
  currentProjectPath: string;
  sceneRef: React.MutableRefObject<THREE.Scene | null>;
  rendererRef: React.MutableRefObject<THREE.WebGLRenderer | null>;
  cameraRef: React.MutableRefObject<THREE.OrthographicCamera | null>;
  topClips: React.MutableRefObject<any[]>;
  groupsRef: React.MutableRefObject<Map<string, THREE.Group>>;
  getInterpolatedValueWithFades: (time: number, clip: any, prop: string) => any;
  invoke: any;
  topAudios: React.MutableRefObject<any[]>;
  isPlaying?: boolean;
  settingsFolder?: string;
}

// ---------------------------------------------------------------------------
// Motor de preview (carregado dinamicamente do submódulo privado)
// ---------------------------------------------------------------------------

// No topo do renderBridge.tsx

// E altere a sua função getDrawFrameFunction para:
export async function getDrawFrameFunction() {
  try {
    return professionalDrawFrame;
  } catch (e) {
    console.warn("Erro ao carregar motor principal.");
    return async (ctx: any) => { /* fallback */ };
  }
}

// ---------------------------------------------------------------------------
// RENDERIZAÇÃO DE ÁUDIO OFFLINE — fiel ao syncAudio do previewRender.tsx
//
// Usa OfflineAudioContext (mais rápido que tempo real, sem MediaRecorder,
// sem problemas de codec) e replica a cadeia de efeitos do syncAudio:
//
//   syncAudio                         →  renderOfflineAudio
//   ─────────────────────────────────────────────────────────────────────────
//   Tone.PitchShift(semitoms)         →  sourceNode.detune (semitoms * 100 cents)
//   Tone.Filter(1500, "bandpass")     →  BiquadFilter bandpass 1500 Hz
//   player.volume.value = kfValue(dB) →  GainNode com curva de gain linear
//                                        amostrada a cada 10 ms
//
// NOTA: Tone.Tremolo e Tone.Distortion são criados no syncAudio mas NUNCA
// conectados ao grafo — ficam isolados após o disconnect() de cada frame.
// O efeito "alien" real é apenas pitch +6 semitons. Não há tremolo.
// ---------------------------------------------------------------------------

const SAMPLE_RATE   = 44100;
const VOLUME_STEP_S = 0.01; // 10 ms — granularidade do tick de volume

// Replica getAssetTimeAtTimelineTime do previewRender.tsx
function getAssetTimeAtTimelineTime(tTime: number, clip: any): number {
  if (!clip.keyframes?.speed || clip.keyframes.speed.length === 0) return tTime;
  const speedKfs = [...clip.keyframes.speed].sort((a: any, b: any) => a.time - b.time);
  let accumulated = 0;
  let lastT = 0;
  let lastS = speedKfs[0].value;
  for (const kf of speedKfs) {
    if (tTime > kf.time) {
      accumulated += (kf.time - lastT) * ((lastS + kf.value) / 2);
      lastT = kf.time;
      lastS = kf.value;
    } else {
      const dt   = tTime - lastT;
      const dist = (kf.time - lastT) || 0.001;
      const cur  = lastS + (dt / dist) * (kf.value - lastS);
      return accumulated + dt * ((lastS + cur) / 2);
    }
  }
  return accumulated + (tTime - lastT) * lastS;
}

// Constrói a curva de ganho LINEAR amostrada a cada VOLUME_STEP_S (10ms).
// syncAudio usa: player.volume.value = kfValue  (kfValue já é dB no Tone.js)
// Aqui convertemos dB → linear para o GainNode da Web Audio API nativa.
function buildGainCurve(
  clip: any,
  getInterpolatedValueWithFades: (t: number, clip: any, prop: string) => any,
  actualDurationSec: number
): Float32Array {
  const numSamples = Math.max(2, Math.ceil(actualDurationSec / VOLUME_STEP_S) + 1);
  const curve = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const tRelative = Math.min(i * VOLUME_STEP_S, actualDurationSec);
    const tAbsolute = clip.start + tRelative;
    const db        = getInterpolatedValueWithFades(tAbsolute, clip, 'volume');
    const linear    = Math.pow(10, db / 20);
    curve[i]        = isFinite(linear) && linear >= 0 ? linear : 1.0;
  }
  return curve;
}

// Converte AudioBuffer → WAV PCM 16-bit stereo
function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const numCh      = buffer.numberOfChannels;
  const sr         = buffer.sampleRate;
  const numSamples = buffer.length;
  const bytesPer   = 2;
  const dataLen    = numSamples * numCh * bytesPer;
  const wav        = new ArrayBuffer(44 + dataLen);
  const v          = new DataView(wav);
  const s = (off: number, val: string) => { for (let i = 0; i < val.length; i++) v.setUint8(off + i, val.charCodeAt(i)); };
  s(0,  'RIFF'); v.setUint32(4,  36 + dataLen, true); s(8,  'WAVE');
  s(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, numCh, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * numCh * bytesPer, true);
  v.setUint16(32, numCh * bytesPer, true); v.setUint16(34, 16, true);
  s(36, 'data'); v.setUint32(40, dataLen, true);
  let off = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
      v.setInt16(off, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      off += 2;
    }
  }
  return wav;
}

// Converte ArrayBuffer → base64 sem estourar a call stack
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary  = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export async function renderOfflineAudio(
  audioClips: any[],
  totalDuration: number,
  currentProjectPath: string,
  getInterpolatedValueWithFades: (time: number, clip: any, prop: string) => any
): Promise<void> {
  if (audioClips.length === 0) {
    console.log('[AudioExport] Sem clips de áudio, pulando.');
    return;
  }

  console.log(
    `[AudioExport] ${audioClips.length} clips | ` +
    `duração ${totalDuration.toFixed(2)}s | ` +
    `tick de volume: ${VOLUME_STEP_S * 1000}ms`
  );

  const totalSamples = Math.ceil(totalDuration * SAMPLE_RATE);
  const offlineCtx   = new OfflineAudioContext(2, totalSamples, SAMPLE_RATE);

  for (const clip of audioClips) {
    try {
      // -----------------------------------------------------------------
      // 1. Resolve caminho — mesma lógica do syncAudio
      // -----------------------------------------------------------------
      const isVideo       = /\.(mp4|mov|avi|mkv)$/i.test(clip.name);
      const audioFileName = clip.name.replace(/\.[^.]+$/, '.mp3');
      const rawPath       = isVideo
        ? `${currentProjectPath}/extracted_audios/${audioFileName}`
        : `${currentProjectPath}/videos/${clip.name}`;
      const assetUrl = convertFileSrc(rawPath);

      // -----------------------------------------------------------------
      // 2. Fetch + decode
      // -----------------------------------------------------------------
      let audioBuffer: AudioBuffer;
      try {
        const res = await fetch(assetUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        audioBuffer = await offlineCtx.decodeAudioData(await res.arrayBuffer());
      } catch (e) {
        console.warn(`[AudioExport] Falha ao carregar "${clip.name}":`, e);
        continue;
      }

      // -----------------------------------------------------------------
      // 3. Posicionamento na timeline
      // -----------------------------------------------------------------
      const beginMoment   = clip.beginmoment ?? 0;
      const timelineStart = clip.start;
      const available     = audioBuffer.duration - beginMoment;
      if (available <= 0) {
        console.warn(
          `[AudioExport] "${clip.name}" beginmoment ${beginMoment}s ` +
          `excede asset ${audioBuffer.duration}s`
        );
        continue;
      }
      const actualDuration = Math.min(clip.duration, available);

      // -----------------------------------------------------------------
      // 4. Source node
      // -----------------------------------------------------------------
      const sourceNode = offlineCtx.createBufferSource();
      sourceNode.buffer = audioBuffer;

      // -----------------------------------------------------------------
      // 5. Cadeia de efeitos — replica exatamente o syncAudio
      //
      //    syncAudio (Tone.js)               Web Audio API (OfflineAudioContext)
      //    ────────────────────────────────────────────────────────────────────
      //    Tone.PitchShift(semitoms)      →  sourceNode.detune = semitoms * 100
      //    Tone.Filter(1500, "bandpass")  →  BiquadFilter bandpass 1500 Hz
      //
      //    Ordem de conexão idêntica ao syncAudio:
      //      source → [pitchShift?] → [filter?] → gainNode → dest
      // -----------------------------------------------------------------
      const pitchEffect = clip.effects?.find((e: any) => e.name === 'pitch');
      const micEffect   = clip.effects?.find((e: any) => e.name === 'microphone' && e.active);
      const alienEffect = clip.effects?.find((e: any) => e.name === 'alien'      && e.active);

      // Pitch via detune (100 cents = 1 semitom, igual ao Tone.PitchShift)
      if (pitchEffect && Math.abs(pitchEffect.intensity) > 0.1) {
        const semitons = alienEffect ? pitchEffect.intensity + 6 : pitchEffect.intensity;
        sourceNode.detune.value = semitons * 100;
      } else if (alienEffect) {
        sourceNode.detune.value = 6 * 100; // +6 semitons, idêntico ao syncAudio
      }

      let lastNode: AudioNode = sourceNode;

      // Microphone → bandpass 1500Hz (= Tone.Filter(1500, "bandpass"))
      if (micEffect) {
        const bp           = offlineCtx.createBiquadFilter();
        bp.type            = 'bandpass';
        bp.frequency.value = 1500;
        bp.Q.value         = 0.8;
        lastNode.connect(bp);
        lastNode = bp;
      }

      // NOTA: Tone.Tremolo e Tone.Distortion são instanciados no syncAudio mas
      // nunca conectados à cadeia de sinal — após o disconnect() de cada frame
      // eles ficam isolados. O efeito "alien" no preview é exclusivamente
      // pitch +6 semitons (já aplicado via sourceNode.detune acima).
      // O LFO/tremolo que existia aqui foi removido porque causava o picotado
      // e a dessincronização de fase que não existe no preview.

      // -----------------------------------------------------------------
      // 6. GainNode com curva de volume amostrada a cada 10ms
      //
      //    syncAudio faz:  player.volume.value = kfValue  (kfValue em dB)
      //    Aqui fazemos o mesmo, mas de forma contínua via setValueCurveAtTime,
      //    com a granularidade de VOLUME_STEP_S = 10ms que você pediu.
      //    A conversão dB→linear é obrigatória porque GainNode.gain é linear.
      // -----------------------------------------------------------------
      const gainNode      = offlineCtx.createGain();
      gainNode.gain.value = 1.0;

      const gainCurve = buildGainCurve(clip, getInterpolatedValueWithFades, actualDuration);
      gainNode.gain.setValueCurveAtTime(gainCurve, timelineStart, actualDuration);

      lastNode.connect(gainNode);
      gainNode.connect(offlineCtx.destination);

      // -----------------------------------------------------------------
      // 7. Agenda reprodução
      //    start(when, offset, duration)
      //      when     = instante na timeline onde o clip começa
      //      offset   = ponto dentro do asset a partir do qual tocar (beginMoment)
      //      duration = quanto tempo reproduzir
      // -----------------------------------------------------------------
      sourceNode.start(timelineStart, beginMoment, actualDuration);

      console.log(
        `[AudioExport] "${clip.name}" | ` +
        `timeline [${timelineStart.toFixed(3)}→${(timelineStart + actualDuration).toFixed(3)}]s | ` +
        `asset offset ${beginMoment.toFixed(3)}s | ` +
        `gain[0]=${gainCurve[0].toFixed(3)} gain[-1]=${gainCurve[gainCurve.length - 1].toFixed(3)}`
      );

    } catch (err) {
      console.error(`[AudioExport] Erro no clip "${clip.name}":`, err);
    }
  }

  // -----------------------------------------------------------------------
  // 8. Renderiza o mix completo offline (mais rápido que tempo real)
  // -----------------------------------------------------------------------
  const renderedBuffer = await offlineCtx.startRendering();
  console.log(`[AudioExport] Mix pronto: ${renderedBuffer.duration.toFixed(2)}s`);

  // -----------------------------------------------------------------------
  // 9. WAV → base64 → Rust (save_export_audio, sem mudança no Rust)
  // -----------------------------------------------------------------------
  const wavBuffer = audioBufferToWav(renderedBuffer);
  const wavBase64 = arrayBufferToBase64(wavBuffer);

  await invoke('save_export_audio', {
    projectPath: currentProjectPath,
    wavBase64,
  });

  console.log('[AudioExport] WAV enviado pro Rust.');
}

// ---------------------------------------------------------------------------
// EXPORTAÇÃO via motor Three.js
// ---------------------------------------------------------------------------

export interface ExportOptions {
  targetPath: string;
  fps: number;
  projectConfig: { width: number; height: number };
  currentProjectPath: string;
  clips: any[];
  sceneRef: React.MutableRefObject<THREE.Scene | null>;
  rendererRef: React.MutableRefObject<THREE.WebGLRenderer | null>;
  cameraRef: React.MutableRefObject<any>;
  groupsRef: React.MutableRefObject<Map<string, THREE.Group>>;
  getInterpolatedValueWithFades: (time: number, clip: any, prop: string) => any;
  settingsFolder?: string;
  onProgress?: (percent: number) => void;
  onError?: (msg: string) => void;
}

export async function exportVideo(opts: ExportOptions): Promise<void> {
  const {
    targetPath, fps, projectConfig, currentProjectPath, clips,
    sceneRef, rendererRef, cameraRef, groupsRef,
    getInterpolatedValueWithFades, settingsFolder, onProgress, onError,
  } = opts;

  const W = projectConfig.width;
  const H = projectConfig.height;

  const duration = clips.reduce((max, c) => Math.max(max, c.start + c.duration), 0);
  if (duration <= 0) { onError?.("Nenhum clip na timeline."); return; }

  console.log('[Export] duração total:', duration);

  const totalFrames = Math.ceil(duration * fps);
  const drawFrame   = await getDrawFrameFunction();

  const offscreenRenderer = new THREE.WebGLRenderer({
    antialias: false, alpha: false,
    powerPreference: "high-performance", preserveDrawingBuffer: true,
  });
  offscreenRenderer.setSize(W, H, false);
  offscreenRenderer.outputColorSpace = THREE.SRGBColorSpace;

  const renderTarget = new THREE.WebGLRenderTarget(W, H, {
    format: THREE.RGBAFormat, type: THREE.UnsignedByteType,
    colorSpace: THREE.SRGBColorSpace,
  });

  const auxCanvas = document.createElement("canvas");
  auxCanvas.width = W; auxCanvas.height = H;
  const auxCtx = auxCanvas.getContext("2d")!;

  const topClipsRef  = { current: clips };
  // topAudios vazio + isPlaying=false → syncAudio não inicializa nenhum player
  // durante a fase de vídeo, evitando interferência com o OfflineAudioContext.
  const topAudiosRef = { current: [] };

  const exportCamera = cameraRef.current ?? (() => {
    const fov  = 45;
    const cam  = new THREE.PerspectiveCamera(fov, W / H, 0.1, 10000);
    const zPos = (H / 2) / Math.tan((fov * Math.PI) / 360);
    cam.position.set(W / 2, -H / 2, zPos);
    cam.lookAt(W / 2, -H / 2, 0);
    return cam;
  })();

  try {
    // -----------------------------------------------------------------------
    // FASE 1 (0%→70%): Renderização de vídeo frame a frame via drawFrame
    // Idêntico ao preview — drawFrame cuida do vídeo, áudio ignorado (isPlaying=false)
    // -----------------------------------------------------------------------
    for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
      const t = frameIdx / fps;

      offscreenRenderer.setRenderTarget(renderTarget);

      await drawFrame({
        time: t, projectConfig, currentProjectPath, sceneRef,
        rendererRef: { current: offscreenRenderer } as any,
        cameraRef:   { current: exportCamera }       as any,
        topClips:    topClipsRef                     as any,
        groupsRef,   getInterpolatedValueWithFades,   invoke,
        topAudios:   topAudiosRef                    as any,
        isPlaying:   false,
        settingsFolder,
      });

      offscreenRenderer.render(sceneRef.current!, exportCamera);

      const pixelBuffer = new Uint8Array(W * H * 4);
      offscreenRenderer.readRenderTargetPixels(renderTarget, 0, 0, W, H, pixelBuffer);

      const flipped = flipVertical(pixelBuffer, W, H);
      auxCtx.putImageData(new ImageData(new Uint8ClampedArray(flipped), W, H), 0, 0);

      await invoke("save_export_frame", {
        projectPath: currentProjectPath,
        frameIndex:  frameIdx,
        pngBase64:   auxCanvas.toDataURL("image/png"),
      });

      onProgress?.(Math.floor((frameIdx / totalFrames) * 70));
    }

    onProgress?.(70);

    // -----------------------------------------------------------------------
    // FASE 2 (70%→85%): Renderização de áudio via renderOfflineAudio
    //
    // Mesma cadeia de efeitos do syncAudio (pitch/alien/micro/volume),
    // executada via OfflineAudioContext — mais rápido que tempo real,
    // volume atualizado a cada 10ms.
    // -----------------------------------------------------------------------
    const audioClips = clips.filter(c => {
      const name = (c.name || "").toLowerCase();
      return (
        name.endsWith(".mp4") || name.endsWith(".mov") ||
        name.endsWith(".mkv") || name.endsWith(".avi") ||
        name.endsWith(".mp3") || name.endsWith(".wav") ||
        name.endsWith(".ogg")
      ) && !c.mute;
    });

    await renderOfflineAudio(
      audioClips,
      duration,
      currentProjectPath,
      getInterpolatedValueWithFades
    );

    onProgress?.(85);

    // -----------------------------------------------------------------------
    // FASE 3 (85%→100%): Montagem final no Rust (sem alteração)
    // Rust combina PNGs + WAV com FFmpeg.
    // -----------------------------------------------------------------------
    await invoke("assemble_exported_video", {
      projectPath: currentProjectPath,
      targetPath,
      fps,
      duration,
      width:  W,
      height: H,
    });

    onProgress?.(100);

  } catch (err: any) {
    onError?.(String(err));
  } finally {
    offscreenRenderer.setRenderTarget(null);
    renderTarget.dispose();
    offscreenRenderer.dispose();
    auxCanvas.remove();
  }
}

// ---------------------------------------------------------------------------
// Utilitário: inverte o buffer de pixels verticalmente (WebGL Y-flip)
// ---------------------------------------------------------------------------
function flipVertical(buffer: Uint8Array, width: number, height: number): Uint8Array {
  const rowSize = width * 4;
  const result  = new Uint8Array(buffer.length);
  for (let y = 0; y < height; y++) {
    const srcRow = (height - 1 - y) * rowSize;
    const dstRow = y * rowSize;
    result.set(buffer.subarray(srcRow, srcRow + rowSize), dstRow);
  }
  return result;
}