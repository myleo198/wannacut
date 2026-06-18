import * as THREE from 'three';
import { invoke } from '@tauri-apps/api/core';
import { drawFrame as professionalDrawFrame, renderAudioOffline } from "./Render/Render";



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
// EXPORTAÇÃO via motor Three.js
// ---------------------------------------------------------------------------

export type ExportCodec = 'mp4' | 'mkv' | 'mp3' | 'wav';
export type ExportKind  = 'video' | 'audio';

export interface ExportOptions {
  targetPath: string;
  fps: number;
  projectConfig: { width: number; height: number };
  currentProjectPath: string;
  clips: any[];
  /** Not read during export — kept for API compatibility; the export creates its own isolated scene. */
  sceneRef: React.MutableRefObject<THREE.Scene | null>;
  /** Not read during export — kept for API compatibility; the export creates its own offscreen renderer. */
  rendererRef: React.MutableRefObject<THREE.WebGLRenderer | null>;
  /**
   * Not read during export — kept for API compatibility. The export always builds its own
   * isolated camera sized for THIS export's W/H. The live editor camera is mutated in place
   * (aspect/position/lookAt) whenever the user switches projects or resizes the canvas
   * (see App.tsx's resize effect), so reusing it by reference let an in-progress export's
   * frames get corrupted by an unrelated project change happening in parallel — e.g.
   * exporting 16:9 while opening a 9:16 project would reconfigure the 16:9 export's camera
   * mid-render, producing shifted/cropped frames.
   */
  cameraRef: React.MutableRefObject<any>;
  /** Not mutated during export — kept for API compatibility; the export creates its own isolated groups. */
  groupsRef: React.MutableRefObject<Map<string, THREE.Group>>;
  getInterpolatedValueWithFades: (time: number, clip: any, prop: string) => any;
  settingsFolder?: string;
  /**
   * 'video' → renders frames + audio and assembles mp4/mkv via FFmpeg.
   * 'audio' → skips frame rendering entirely, exports only the audio mix as mp3/wav.
   * Defaults to 'video'.
   */
  exportKind?: ExportKind;
  /**
   * Container/codec for the output file.
   * Video: 'mp4' | 'mkv'   Audio-only: 'mp3' | 'wav'
   * Defaults to 'mp4'.
   */
  exportCodec?: ExportCodec;
  onProgress?: (percent: number) => void;
  onError?: (msg: string) => void;
}

export async function exportVideo(opts: ExportOptions): Promise<void> {
  const {
    targetPath, fps, projectConfig, currentProjectPath, clips,
    // sceneRef / rendererRef / cameraRef / groupsRef intentionally NOT destructured:
    // the export never reads the live editor's Three.js objects — it always builds
    // its own isolated scene/renderer/camera/groups below, so it can't be corrupted
    // by whatever project is open in the editor or by other exports running in parallel.
    getInterpolatedValueWithFades, settingsFolder, onProgress, onError,
    exportKind  = 'video',
    exportCodec = 'mp4',
  } = opts;

  // ── Derived flags ────────────────────────────────────────────────────────
  const isAudioOnly = exportKind === 'audio';            // mp3 / wav
  const isVideoExport = !isAudioOnly;                    // mp4 / mkv

  console.log(`[Export] kind=${exportKind} codec=${exportCodec}`);

  const W = projectConfig.width;
  const H = projectConfig.height;

  const duration = clips.reduce((max, c) => Math.max(max, c.start + c.duration), 0);
  if (duration <= 0) { onError?.("Nenhum clip na timeline."); return; }

  console.log('[Export] duração total:', duration);

  // ── Audio clips (needed for both paths) ─────────────────────────────────
  const audioClips = clips.filter(c => {
    const name = (c.name || "").toLowerCase();
    return (
      name.endsWith(".mp4") || name.endsWith(".mov") ||
      name.endsWith(".mkv") || name.endsWith(".avi") ||
      name.endsWith(".mp3") || name.endsWith(".wav") ||
      name.endsWith(".ogg")
    ) && !c.mute;
  });

  // =========================================================================
  // CAMINHO A: SOMENTE ÁUDIO (mp3 / wav)
  // Pula toda a renderização de frames — apenas mix offline → Rust converte.
  // Progresso: 0% → 80% (mix) → 100% (Rust encode)
  // =========================================================================
  if (isAudioOnly) {
    try {
      onProgress?.(0);

      // Fase A1 (0→80%): mix offline
      await renderAudioOffline(
        audioClips,
        duration,
        currentProjectPath,
        getInterpolatedValueWithFades,
        (p) => onProgress?.(Math.floor(p * 0.8)),   // 0→80%
      );

      onProgress?.(80);

      // Fase A2 (80→100%): Rust encode WAV → mp3/wav target
      await invoke("assemble_exported_audio", {
        projectPath: currentProjectPath,
        targetPath,
        codec: exportCodec,   // 'mp3' | 'wav'
        duration,
      });

      onProgress?.(100);
    } catch (err: any) {
      onError?.(String(err));
    }
    return;
  }

  // =========================================================================
  // CAMINHO B: VÍDEO + ÁUDIO (mp4 / mkv)
  // Renderiza frames, mix de áudio, depois Rust monta com FFmpeg.
  // Progresso: 0%→70% (frames) → 85% (áudio) → 100% (assemble)
  // =========================================================================
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
  const topAudiosRef = { current: [] as any[] };

  // ⚠️ NEVER reuse cameraRef.current (the live editor camera) here.
  // It's the SAME object the live editor mutates in place — App.tsx's resize effect
  // calls cameraRef.current.aspect = ... / .position.set(...) / .lookAt(...) every
  // time the user switches projects or resizes the canvas. If two exports run in
  // parallel (e.g. one 16:9, one 9:16), the older export would keep holding that same
  // camera object, and the moment the user opened the other project, this export's
  // frames would suddenly render with the wrong aspect/position — exactly the
  // "frames shifted up and cropped" bug. So we always build a fresh, isolated camera
  // sized for THIS export's own W/H, regardless of what's currently open in the editor.
  const fov  = 45;
  const exportCamera = new THREE.PerspectiveCamera(fov, W / H, 0.1, 10000);
  const zPos = (H / 2) / Math.tan((fov * Math.PI) / 360);
  exportCamera.position.set(W / 2, -H / 2, zPos);
  exportCamera.lookAt(W / 2, -H / 2, 0);

  // Isolated scene + groups — safe for parallel exports (see isolation fix)
  const exportScene     = new THREE.Scene();
  const exportGroups    = new Map<string, THREE.Group>();
  const exportSceneRef  = { current: exportScene };
  const exportGroupsRef = { current: exportGroups };

  if ((projectConfig as any).backgroundColor) {
    exportScene.background = new THREE.Color((projectConfig as any).backgroundColor);
  }

  try {
    // ── Fase B1 (0%→70%): frames ──────────────────────────────────────────
    for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
      const t = frameIdx / fps;

      offscreenRenderer.setRenderTarget(renderTarget);

      await drawFrame({
        time: t, projectConfig, currentProjectPath,
        sceneRef:    exportSceneRef  as any,
        rendererRef: { current: offscreenRenderer } as any,
        cameraRef:   { current: exportCamera }       as any,
        topClips:    topClipsRef                     as any,
        groupsRef:   exportGroupsRef                 as any,
        getInterpolatedValueWithFades, invoke,
        topAudios:   topAudiosRef                    as any,
        isPlaying:   false,
        settingsFolder,
      });

      // (Removido) offscreenRenderer.render(exportScene, exportCamera) duplicado:
      // drawFrame() já termina com rendererRef.current.render(...) internamente
      // (ver fim de drawFrame em Render.tsx). Renderizar de novo aqui era a MESMA
      // cena/câmera/renderer sendo desenhada duas vezes por frame, sem efeito
      // visível — só custava metade do tempo de GPU/CPU à toa.

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

    // ── Fase B2 (70%→85%): mix de áudio offline ───────────────────────────
    await renderAudioOffline(
      audioClips,
      duration,
      currentProjectPath,
      getInterpolatedValueWithFades,
    );

    onProgress?.(85);

    // ── Fase B3 (85%→100%): Rust monta PNGs + WAV → mp4/mkv ──────────────
    await invoke("assemble_exported_video", {
      projectPath: currentProjectPath,
      targetPath,
      fps,
      duration,
      width:  W,
      height: H,
      codec:  exportCodec,   // 'mp4' | 'mkv'
    });

    onProgress?.(100);

  } catch (err: any) {
    onError?.(String(err));
  } finally {
    offscreenRenderer.setRenderTarget(null);
    renderTarget.dispose();

    exportScene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry?.dispose();
        const mat = obj.material as THREE.MeshBasicMaterial;
        mat?.map?.dispose();
        mat?.dispose();
      }
    });
    exportGroups.clear();

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