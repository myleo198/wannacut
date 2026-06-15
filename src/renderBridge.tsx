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

export interface ExportOptions {
  targetPath: string;
  fps: number;
  projectConfig: { width: number; height: number };
  currentProjectPath: string;
  clips: any[];
  /** Used only to read the live camera as a fallback; the export creates its own isolated scene/groups. */
  sceneRef: React.MutableRefObject<THREE.Scene | null>;
  rendererRef: React.MutableRefObject<THREE.WebGLRenderer | null>;
  cameraRef: React.MutableRefObject<any>;
  /** No longer mutated during export — kept for API compatibility. */
  groupsRef: React.MutableRefObject<Map<string, THREE.Group>>;
  getInterpolatedValueWithFades: (time: number, clip: any, prop: string) => any;
  settingsFolder?: string;
  exportKind?: 'video' | 'audio';
  exportCodec?: string;
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

  // ── FIX: Create an isolated Scene and groupsRef exclusively for this export.
  // This prevents concurrent exports from different projects from mutating each
  // other's Three.js scene graph via the shared sceneRef / groupsRef.
  const exportScene  = new THREE.Scene();
  const exportGroups = new Map<string, THREE.Group>();
  const exportSceneRef  = { current: exportScene };
  const exportGroupsRef = { current: exportGroups };

  // Background colour from projectConfig (if provided)
  if ((projectConfig as any).backgroundColor) {
    exportScene.background = new THREE.Color((projectConfig as any).backgroundColor);
  }

  try {
    // -----------------------------------------------------------------------
    // FASE 1 (0%→70%): Renderização de vídeo frame a frame via drawFrame
    // Uses its own isolated scene/groups — safe for parallel exports.
    // -----------------------------------------------------------------------
    for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
      const t = frameIdx / fps;

      offscreenRenderer.setRenderTarget(renderTarget);

      await drawFrame({
        time: t, projectConfig, currentProjectPath,
        // ── FIX: use isolated refs, NOT the shared component refs ──
        sceneRef:    exportSceneRef  as any,
        rendererRef: { current: offscreenRenderer } as any,
        cameraRef:   { current: exportCamera }       as any,
        topClips:    topClipsRef                     as any,
        groupsRef:   exportGroupsRef                 as any,
        getInterpolatedValueWithFades,   invoke,
        topAudios:   topAudiosRef                    as any,
        isPlaying:   false,
        settingsFolder,
      });

      offscreenRenderer.render(exportScene, exportCamera);

      const pixelBuffer = new Uint8Array(W * H * 4);
      offscreenRenderer.readRenderTargetPixels(renderTarget, 0, 0, W, H, pixelBuffer);

      const flipped = flipVertical(pixelBuffer, W, H);
      auxCtx.putImageData(new ImageData(new Uint8ClampedArray(flipped), W, H), 0, 0);

      // ── FIX: projectPath already uniquely identifies which project's frames
      // these are. The Rust side saves frames under <projectPath>/export_frames/
      // so concurrent exports write to different folders — no collision.
      await invoke("save_export_frame", {
        projectPath: currentProjectPath,
        frameIndex:  frameIdx,
        pngBase64:   auxCanvas.toDataURL("image/png"),
      });

      onProgress?.(Math.floor((frameIdx / totalFrames) * 70));
    }

    onProgress?.(70);

    // -----------------------------------------------------------------------
    // FASE 2 (70%→85%): Renderização de áudio via motor do Render.tsx
    //
    // Usa renderAudioOffline (exportada do Render.tsx) que replica exatamente
    // a cadeia de efeitos do syncAudio (pitch/alien/micro/volume/speed),
    // garantindo paridade total entre preview e resultado exportado.
    // Executada via OfflineAudioContext — mais rápido que tempo real,
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

    await renderAudioOffline(
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

    // ── FIX: dispose all meshes/materials/textures from the isolated export scene
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