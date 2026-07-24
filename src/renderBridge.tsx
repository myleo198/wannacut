import * as THREE from 'three';
import { invoke } from '@tauri-apps/api/core';
import { drawFrame as professionalDrawFrame, renderAudioOffline } from "./Render/Render";
import { buildExportPlan, ExportSegment } from "./Render/exportPlanner";

/**
 * Roda `worker` sobre `items` com no máximo `limit` execuções concorrentes.
 * Usado pra disparar os cortes "simples" em paralelo em vez de esperar um
 * ffmpeg terminar pra começar o próximo — são processos independentes, então
 * serializar era desperdiçar núcleos de CPU ociosos.
 */
async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const runners = Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}



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
  /**
   * true quando drawFrame é chamado pelo pipeline de export (renderBridge.tsx).
   * Durante o export, clips "triviais" nunca chegam aqui — já foram cortados
   * direto do arquivo fonte pelo exportPlanner. A flag existe pra impedir que
   * o atalho de preview (vídeo tocando nativamente via <video>/VideoTexture,
   * ver Render.tsx) seja usado por engano dentro de um render offscreen.
   */
  isExport?: boolean;
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
  /**
   * Transições da timeline a serem renderizadas durante o export.
   * Repassadas ao drawFrame frame a frame.
   */
  timelineTransitions?: any[];
  onProgress?: (percent: number) => void;
  onError?: (msg: string) => void;
  gpuName?: string | null; 
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
    timelineTransitions = [],
    gpuName
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
        gpuName: gpuName ?? null,
      });

      onProgress?.(100);
    } catch (err: any) {
      onError?.(String(err));
    }
    return;
  }

  // =========================================================================
  // CAMINHO B: VÍDEO + ÁUDIO (mp4 / mkv) — EXPORT HÍBRIDO
  //
  // Em vez de sempre renderizar frame a frame no Three.js, a timeline é
  // primeiro dividida em segmentos (ver exportPlanner.ts):
  //   - "simple": um único clip sem keyframes/efeitos/transição/reverse
  //     ativo no trecho → cortado DIRETO do arquivo fonte via ffmpeg
  //     (rápido: sem decodificar em canvas, sem IPC por frame, sem Three.js).
  //   - "complex": qualquer coisa que precise de composição (efeitos,
  //     transições, camadas sobrepostas, texto, máscara, reverse, speed
  //     ramp) → cai no pipeline de sempre, frame a frame.
  //
  // No final, todos os segmentos (cortes + trechos renderizados) são
  // concatenados em ordem e o áudio (mixado à parte, como sempre) é
  // acoplado por cima.
  //
  // Progresso: 0%→60% (cortes + frames complexos) → 80% (mix de áudio)
  //            → 100% (concat + mux final)
  // =========================================================================
  const drawFrame = await getDrawFrameFunction();

  const plan = buildExportPlan(clips, timelineTransitions, W, H, duration);
  const simpleCount  = plan.filter(s => s.kind === 'simple').length;
  const complexCount = plan.filter(s => s.kind === 'complex').length;
  console.log(
    `[Export] plano híbrido: ${simpleCount} corte(s) direto(s), ${complexCount} trecho(s) renderizado(s):`,
    plan.map(s => s.kind === 'simple'
      ? `corte[${s.clip.name}] ${s.tStart.toFixed(2)}-${s.tEnd.toFixed(2)}`
      : `render ${s.tStart.toFixed(2)}-${s.tEnd.toFixed(2)}`),
  );
  if (complexCount > 0) {
    console.warn(
      `[Export] ATENÇÃO: ${complexCount} trecho(s) caiu(caíram) no render frame-a-frame. ` +
      `Se você esperava que TUDO fosse corte direto, o classificador (isTrivialClip) ` +
      `está rejeitando algum clip — veja os motivos possíveis no comentário acima do isTrivialClip.`,
    );
  }

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

  // Peso heurístico de progresso: um corte direto (ffmpeg -ss/-t) é MUITO
  // mais rápido que renderizar frames, mas ainda gasta um tempo não-zero
  // (spawn do processo, seek, encode). Usamos "peso de N frames" só pra dar
  // uma barra de progresso monotônica e razoável — não precisa ser exata.
  const SIMPLE_SEGMENT_WEIGHT_FRAMES = 4;
  const totalComplexFrames = plan
    .filter((s): s is Extract<ExportSegment, { kind: 'complex' }> => s.kind === 'complex')
    .reduce((sum, s) => sum + Math.max(1, Math.round((s.tEnd - s.tStart) * fps)), 0);
  const totalSimpleSegments = plan.filter(s => s.kind === 'simple').length;
  const totalWorkUnits = Math.max(
    1,
    totalComplexFrames + totalSimpleSegments * SIMPLE_SEGMENT_WEIGHT_FRAMES,
  );
  let workUnitsDone = 0;
  const bumpProgress = () => onProgress?.(Math.min(60, Math.floor((workUnitsDone / totalWorkUnits) * 60)));

  const segmentFiles: string[] = plan.map((_, idx) => `seg_${String(idx).padStart(6, '0')}.mp4`);

  // Concorrência dos cortes simples: um a menos que o número de núcleos
  // disponíveis (deixa um núcleo livre pra UI/render), com um teto razoável
  // pra não estourar limite de processos/handles de arquivo abertos.
  const cutConcurrency = Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
  console.log(`[Export] ${simpleCount} corte(s) simples, ${complexCount} segmento(s) complexo(s), concorrência=${cutConcurrency}`);

  try {
    // Dispara TODOS os cortes simples em paralelo (limitado por
    // cutConcurrency) — são chamadas ffmpeg independentes entre si, e também
    // independentes do loop de segmentos complexos abaixo (que usa GPU via
    // Three.js, não CPU/ffmpeg), então os dois rodam ao mesmo tempo.
    const simpleEntries = plan
      .map((seg, idx) => ({ seg, idx }))
      .filter((e): e is { seg: Extract<ExportSegment, { kind: 'simple' }>; idx: number } => e.seg.kind === 'simple');

    const cutsPromise = runWithConcurrency(simpleEntries, cutConcurrency, async ({ seg, idx }) => {
      const assetStart = (seg.tStart - seg.clip.start) + (seg.clip.beginmoment || 0);
      const segDuration = seg.tEnd - seg.tStart;

      const cutStartedAt = performance.now();
      await invoke("cut_clip_segment", {
        projectPath: currentProjectPath,
        clipName:    seg.clip.name,
        assetStart:  Math.max(0, assetStart),
        duration:    Math.max(0, segDuration),
        width:  W, height: H, fps,
        segIndex: idx,
      });
      console.log(
        `[Export] segmento ${idx}: corte de "${seg.clip.name}" ` +
        `(${segDuration.toFixed(2)}s) levou ${((performance.now() - cutStartedAt) / 1000).toFixed(2)}s`,
      );

      workUnitsDone += SIMPLE_SEGMENT_WEIGHT_FRAMES;
      bumpProgress();
    });

    // ── Fase B1 (0%→60%): segmentos complexos, sequenciais (frame a frame) ─
    // Rodam em paralelo com cutsPromise acima — não competem por recurso
    // (um é CPU/ffmpeg, o outro é GPU/Three.js + IPC de PNG).
    for (let segIdx = 0; segIdx < plan.length; segIdx++) {
      const seg = plan[segIdx];
      if (seg.kind !== 'complex') continue;

      const segFrameDir = `export_frames/seg_${String(segIdx).padStart(6, '0')}`;
      const segFrameCount = Math.max(1, Math.round((seg.tEnd - seg.tStart) * fps));

      for (let f = 0; f < segFrameCount; f++) {
        const t = seg.tStart + f / fps;

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
          timelineTransitions,
          isExport:    true,
        });

        // (Removido) offscreenRenderer.render(exportScene, exportCamera) duplicado:
        // drawFrame() já termina com rendererRef.current.render(...) internamente
        // (ver fim de drawFrame em Render.tsx).

        const pixelBuffer = new Uint8Array(W * H * 4);
        offscreenRenderer.readRenderTargetPixels(renderTarget, 0, 0, W, H, pixelBuffer);

        const flipped = flipVertical(pixelBuffer, W, H);
        auxCtx.putImageData(new ImageData(new Uint8ClampedArray(flipped), W, H), 0, 0);

        await invoke("save_export_frame", {
          projectPath: currentProjectPath,
          frameIndex:  f,
          pngBase64:   auxCanvas.toDataURL("image/png"),
          segmentDir:  segFrameDir,
        });

        workUnitsDone++;
        bumpProgress();
      }

      const assembleStartedAt = performance.now();
      await invoke("assemble_frames_segment", {
        projectPath: currentProjectPath,
        segIndex: segIdx, fps, width: W, height: H,
      });
      console.log(
        `[Export] segmento ${segIdx}: ${segFrameCount} frames renderizados, ` +
        `assemble levou ${((performance.now() - assembleStartedAt) / 1000).toFixed(2)}s`,
      );
    }

    // Garante que todos os cortes paralelos terminaram antes de seguir pro concat.
    const cutsStartedWaitAt = performance.now();
    await cutsPromise;
    console.log(`[Export] espera final pelos cortes simples: ${((performance.now() - cutsStartedWaitAt) / 1000).toFixed(2)}s`);

    onProgress?.(60);

    // ── Fase B2 (60%→80%): mix de áudio offline ───────────────────────────
    const audioStartedAt = performance.now();
    await renderAudioOffline(
      audioClips,
      duration,
      currentProjectPath,
      getInterpolatedValueWithFades,
      (p) => onProgress?.(60 + Math.floor(p * 0.2)),
    );
    console.log(`[Export] mix de áudio levou ${((performance.now() - audioStartedAt) / 1000).toFixed(2)}s`);

    onProgress?.(80);

    // ── Fase B3 (80%→100%): Rust concatena os segmentos + acopla o áudio ──
    const concatStartedAt = performance.now();
    await invoke("concat_export_segments", {
      projectPath: currentProjectPath,
      targetPath,
      segmentFiles,
      duration,
      codec: exportCodec, // 'mp4' | 'mkv'
    });
    console.log(`[Export] concat + mux final levou ${((performance.now() - concatStartedAt) / 1000).toFixed(2)}s`);

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