import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Clip } from '../App';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';

import { 
  Plus, 
  Search, 
  X, 
  Music, 
  Play, 
  Image as ImageIcon, 
  Film, 
  Type, 
  Sparkles, 
  Layers,
  DiamondPlus,
  Download,
  Check,
  Copy,
  Clock,
  Loader2,
  User,
  MoreVertical,
  Key,
  ExternalLink,
  ChevronRight
} from 'lucide-react';

// ── Freesound types ──────────────────────────────────────────
interface FreesoundPreviews {
  'preview-hq-mp3'?: string;
  'preview-lq-mp3'?: string;
}

interface FreesoundSound {
  id: number;
  name: string;
  username: string;
  duration: number;
  license: string;
  previews: FreesoundPreviews;
  download: string;
}

type LicenseFilter = 'cc0' | 'ccby' | 'ccnc';

function getLicenseKind(licenseUrl: string): LicenseFilter | null {
  const l = licenseUrl.toLowerCase();
  if (l.includes('zero') || l.includes('cc0'))               return 'cc0';
  if (l.includes('noncommercial') || l.includes('nc'))       return 'ccnc';
  if (l.includes('attribution') || l.includes('by'))         return 'ccby';
  return null;
}

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}




interface ItensAsideProps {
  sidebarWidth: number;
  typeofclip: string | null;
  isResizingSidebar: React.MutableRefObject<boolean>;
  handleImportFile: () => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  filteredAssets: any[];
  selectedAssets: any[];
  toggleAssetSelection: (asset: any, isMulti: boolean) => void;
  setSourceAsset: (asset: any) => void;
  setInPoint: (val: number) => void;
  setOutPoint: (val: number) => void;
  setCurrentTime2: (val: number) => void;
  handleDragStartEffect: (e: React.DragEvent, effectId: string, category: 'video' | 'audio') => void;
  handleDragStartTransition: (e: React.DragEvent, transitionId: string) => void;
  handleDragStart: (e: any, ...args: any[]) => void;
  handleRenameAsset: (oldName: string, newName: string) => void;
  formatTime: (seconds: number) => string;
  availableFonts: string [];
  loadSystemFonts: () => void;
  handleDragStartText: (
  e: React.DragEvent, 
  fontName: string, 
  fontPath: string
  ) => void;
  isRendering: boolean;
  currentProjectPath: string | null;
  loadAssets: () => void;
  settingsFolder: string | null;
}


const CloudFontPreviewStyles = ({ fonts }: { fonts: any[] }) => {
  return (
    <style>
      {fonts.map(font => {
        const fontName = font.file.split('.')[0];
        const url = `https://wannacut.app/assets/fonts/${font.file}`;
        return `
          @font-face {
            font-family: '${fontName}_preview';
            src: url('${url}');
            font-display: swap;
          }
        `;
      }).join('\n')}
    </style>
  );
};





const VIDEO_EFFECTS = [
  { id: 'camera_shake', label: 'Camera Shake' },
  { id: 'chromatic_aberration', label: 'Chromatic Aberration' },
  { id: 'film_grain', label: 'Film Grain' },
  { id: 'film_grain_dust', label: 'Film Grain and Dust' },
  { id: 'blur', label: 'Blur' },
  { id: 'glitch_flash', label: 'Glitch Flash' },
  { id: 'glitch_rgb', label: 'Glitch RGB' }


];

const AUDIO_EFFECTS = [
  { id: 'microphone', label: 'Microfone' },
  { id: 'alien', label: 'Alien' },
  { id: 'pitch', label: 'Pitch' },
];

const TRANSITIONS_LIST = [
  { id: 'smooth_push', label: 'Smooth Push' },
  { id: 'rgb_split_glitch', label: 'RGB Split Glitch' },
  { id: 'cube_flip', label: 'Cube Flip' },
  { id: 'dissolve', label: 'Dissolve' },
  { id: 'fade_out_in', label: 'Fade-out in' },
];




export const ItensAside = ({
  sidebarWidth,
  typeofclip,
  isResizingSidebar,
  handleImportFile,
  searchQuery,
  setSearchQuery,
  filteredAssets,
  selectedAssets,
  toggleAssetSelection,
  setSourceAsset,
  setInPoint,
  setOutPoint,
  setCurrentTime2,
  handleDragStart,
  handleRenameAsset,
  formatTime,
  availableFonts,
  loadSystemFonts,
  handleDragStartText,
  handleDragStartEffect,
  handleDragStartTransition,
  isRendering,
  currentProjectPath,
  loadAssets,
  settingsFolder,
}: ItensAsideProps) => {
  const [activeTab, setActiveTab] = useState('Media');

  

  const menuOptions = [
    { id: 'Media', icon: <Film size={20} />, label: 'Media', color: 'fuchsia' },
    { id: 'Sound', icon: <Music size={20} />, label: 'Sounds Library', color: 'rose' },
    { id: 'Text', icon: <Type size={20} />, label: 'Text', color: 'cyan' },
    { id: 'Effects', icon: <Sparkles size={20} />, label: 'Effects', color: 'purple' },
    { id: 'Transitions', icon: <Layers size={20} />, label: 'Transitions', color: 'blue' },
  ];


  const colorMap: Record<string, string> = {
    fuchsia: "bg-fuchsia-600/20 text-fuchsia-400",
    cyan: "bg-cyan-600/20 text-cyan-400",
    purple: "bg-purple-600/20 text-purple-400",
    blue: "bg-blue-600/20 text-blue-400",
    rose: "bg-rose-600/20 text-rose-400"
  };


  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
  const [cloudFonts, setCloudFonts] = useState<any[]>([]);

  // ── Sound Library state ──────────────────────────────────
  const [soundQuery, setSoundQuery]           = useState('');
  const [soundResults, setSoundResults]       = useState<FreesoundSound[]>([]);
  const [soundLoading, setSoundLoading]       = useState(false);
  const [soundLicense, setSoundLicense]       = useState<LicenseFilter>('cc0');
  const [soundDownloading, setSoundDownloading] = useState<Record<number, boolean>>({});
  const [soundDownloaded, setSoundDownloaded]   = useState<Record<number, boolean>>({});
  const [soundProgress, setSoundProgress]       = useState<Record<number, number>>({});
  const [copiedCredit, setCopiedCredit]       = useState<number | null>(null);
  const soundDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Freesound API Key state ───────────────────────────────────
  const [freesoundApiKey, setFreesoundApiKey]   = useState<string | null>(null);
  const [apiKeyLoading, setApiKeyLoading]       = useState(false);
  const [showKeyMenu, setShowKeyMenu]           = useState(false);
  const [showKeyModal, setShowKeyModal]         = useState(false);
  const [keyModalInput, setKeyModalInput]       = useState('');
  const [keySaving, setKeySaving]               = useState(false);
  const keyMenuRef = useRef<HTMLDivElement>(null);


  // ── Estados para o Player de Preview de Áudio ──────────────────
  const [playingId, setPlayingId] = useState<number | null>(null);
  const [playbackProgress, setPlaybackProgress] = useState<Record<number, number>>({});
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Limpa o áudio se o componente desmontar ou mudar de aba
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, [activeTab]);

  // ── Carrega a API key do Freesound ao abrir a aba Sound ───────
  useEffect(() => {
    if (activeTab !== 'Sound') return;
    if (!settingsFolder) { setFreesoundApiKey(null); return; }
    setApiKeyLoading(true);
    invoke<string | null>('read_freesound_api_key', { settingsFolder })
      .then(key => setFreesoundApiKey(key ?? null))
      .catch(() => setFreesoundApiKey(null))
      .finally(() => setApiKeyLoading(false));
  }, [activeTab, settingsFolder]);

  // ── Fecha o menu 3 pontinhos ao clicar fora ───────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (keyMenuRef.current && !keyMenuRef.current.contains(e.target as Node)) {
        setShowKeyMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleTogglePreview = (sound: FreesoundSound) => {
    const previewUrl = sound.previews['preview-hq-mp3'] || sound.previews['preview-lq-mp3'];
    if (!previewUrl) return;

    // Se clicou no som que já está tocando, dá Pause
    if (playingId === sound.id) {
      if (audioRef.current) {
        audioRef.current.pause();
        setPlayingId(null);
      }
      return;
    }

    // Se já existia outro som tocando, limpa ele antes
    if (audioRef.current) {
      audioRef.current.pause();
    }

    // Inicializa o novo áudio
    const audio = new Audio(previewUrl);
    audioRef.current = audio;
    setPlayingId(sound.id);

    // Atualiza a barra de progresso conforme a música toca
    audio.ontimeupdate = () => {
      if (audio.duration) {
        const pct = (audio.currentTime / audio.duration) * 100;
        setPlaybackProgress(prev => ({ ...prev, [sound.id]: pct }));
      }
    };

    // Quando o som terminar sozinho
    audio.onended = () => {
      setPlayingId(null);
      setPlaybackProgress(prev => ({ ...prev, [sound.id]: 0 }));
    };

    audio.play().catch(err => console.error("Erro ao reproduzir preview:", err));
  };

  const handleSeekProgress = (e: React.MouseEvent<HTMLDivElement>, sound: FreesoundSound) => {
    // Só permite o seek se for o som atualmente carregado/reproduzindo
    if (playingId !== sound.id || !audioRef.current) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const width = rect.width;
    const percentage = clickX / width;

    if (audioRef.current.duration) {
      audioRef.current.currentTime = audioRef.current.duration * percentage;
    }
  };

  const handleSaveApiKey = async () => {
    if (!settingsFolder || !keyModalInput.trim()) return;
    setKeySaving(true);
    try {
      await invoke('save_freesound_api_key', {
        settingsFolder,
        apiKey: keyModalInput.trim(),
      });
      setFreesoundApiKey(keyModalInput.trim());
      setShowKeyModal(false);
      setKeyModalInput('');
    } catch (err) {
      console.error('Erro ao salvar API key:', err);
    } finally {
      setKeySaving(false);
    }
  };

  const searchSounds = useCallback(async (q: string, lic: LicenseFilter) => {
    if (!q.trim()) { setSoundResults([]); return; }
    if (!freesoundApiKey) return;
    setSoundLoading(true);
    try {
      const results = await invoke<FreesoundSound[]>('search_freesound', {
        query: q.trim(),
        licenseFilter: lic,
        apiKey: freesoundApiKey,
      });
      setSoundResults(results);
    } catch (err) {
      console.error('Freesound search error', err);
      setSoundResults([]);
    } finally {
      setSoundLoading(false);
    }
  }, [freesoundApiKey]);

  // Debounce: dispara busca 600ms após o usuário parar de digitar
  useEffect(() => {
    if (activeTab !== 'Sound') return;
    if (soundDebounceRef.current) clearTimeout(soundDebounceRef.current);
    soundDebounceRef.current = setTimeout(() => {
      searchSounds(soundQuery, soundLicense);
    }, 600);
    return () => { if (soundDebounceRef.current) clearTimeout(soundDebounceRef.current); };
  }, [soundQuery, soundLicense, activeTab, searchSounds]);

  const handleDownloadSound = async (sound: FreesoundSound) => {
    

    if (!currentProjectPath) return;


    


    const previewUrl = sound.previews['preview-hq-mp3'] || sound.previews['preview-lq-mp3'];
    if (!previewUrl) return;

    setSoundDownloading(prev => ({ ...prev, [sound.id]: true }));
    setSoundProgress(prev => ({ ...prev, [sound.id]: 5 }));

    // Anima progresso até 85% enquanto aguarda o invoke
    const interval = setInterval(() => {
      setSoundProgress(prev => {
        const cur = prev[sound.id] ?? 5;
        if (cur >= 85) { clearInterval(interval); return prev; }
        return { ...prev, [sound.id]: cur + Math.random() * 8 };
      });
    }, 200);

    try {
      await invoke('download_freesound', {
        soundId: sound.id,
        soundName: sound.name,
        previewUrl,
        projectPath: currentProjectPath,
      });
      clearInterval(interval);
      setSoundProgress(prev => ({ ...prev, [sound.id]: 100 }));
      setSoundDownloaded(prev => ({ ...prev, [sound.id]: true }));
      loadAssets();
    } catch (err) {
      clearInterval(interval);
      console.error('Freesound download error', err);
      setSoundProgress(prev => ({ ...prev, [sound.id]: 0 }));
    } finally {
      setSoundDownloading(prev => ({ ...prev, [sound.id]: false }));
    }
  };

  const handleCopyCredit = (sound: FreesoundSound) => {
    const credit = `"${sound.name}" by ${sound.username} — Freesound.org (${sound.license})`;
    navigator.clipboard.writeText(credit).then(() => {
      setCopiedCredit(sound.id);
      setTimeout(() => setCopiedCredit(null), 2000);
    });
  };

  // Buscar as fontes do seu site quando a aba de texto abrir
  useEffect(() => {
    if (activeTab === 'Text') {

      console.log('fazendo o fetch ...')


      invoke('fetch_cloud_fonts')
      .then((data: any) => {
        setCloudFonts(data.fonts);
        console.log("Cloud fonts loaded via Rust:", data.fonts);
        console.log("Avaliable fonts", availableFonts)
      })
      .catch(err => console.error("Error fetching via Rust:", err));

        
    }
  }, [activeTab]);

  const handleDownloadFont = async (fontFile: string) => {
    const settingsFolder = localStorage.getItem("wannacut_settings_folder");
    const destination = `${settingsFolder}/fonts/${fontFile}`;
    const url = `https://wannacut.app/assets/fonts/${fontFile}`;

    // Lógica de download (Exemplo simplificado via Tauri)
    setDownloadProgress(prev => ({ ...prev, [fontFile]: 10 })); // Inicia barra
    
    try {
      // Aqui você chamaria um comando Rust 'download_file' que criamos antes
      // ou usaria a API de HTTP do Tauri
      await invoke('download_font_file', { url, path: destination });
      
      setDownloadProgress(prev => ({ ...prev, [fontFile]: 100 }));
      loadSystemFonts(); // Recarrega a lista do Rust para validar que o arquivo existe
    } catch (error) {
      console.error("Download failed", error);
      setDownloadProgress(prev => ({ ...prev, [fontFile]: 0 }));
    }
  };


  return (
    <aside
      style={{ width: `${sidebarWidth}px` }}
      className={`relative flex h-full border-r border-white/5 bg-[#09090b] overflow-hidden select-none
      ${isRendering ? 'opacity-40 pointer-events-none select-none' : ''}`}
    >
      {/* --- SIDEBAR NAV (ICON MENU) --- */}
      <nav className="w-[60px] flex flex-col items-center py-4 gap-4 border-r border-white/5 bg-black/20">
        {menuOptions.map((item) => (
          <div
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={`group relative flex items-center justify-center w-10 h-10 rounded-xl cursor-pointer transition-all ${
              activeTab === item.id 
                ? colorMap[item.color]
                : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-200'
            }`}
          >
            {item.icon}
            
            {/* Hover Label (Tooltip Style) */}
            <div className="absolute left-14 px-3 py-1.5 rounded-md bg-zinc-800 text-white text-[10px] font-bold tracking-widest uppercase opacity-0 pointer-events-none group-hover:opacity-100 group-hover:left-12 transition-all z-50 shadow-xl whitespace-nowrap">
              {item.label}
              {/* Tooltip Arrow */}
              <div className="absolute left-[-4px] top-1/2 -translate-y-1/2 w-2 h-2 bg-zinc-800 rotate-45" />
            </div>

            {/* Active Indicator */}
            {activeTab === item.id && (
              <motion.div 
                layoutId="activeNav"
                className="absolute left-[-15px] w-1 h-6 bg-cyan-500 rounded-r-full"
              />
            )}
          </div>
        ))}
      </nav>

      {/* --- CONTENT AREA --- */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {activeTab === 'Media' && (
          <>
            {/* Header: Import & Search */}
<aside
  className="relative border-r border-zinc-800 bg-[#0c0c0c] flex flex-col hidden lg:flex h-full"
 
>
  {/* Header da Library */}
  <div className="p-4 border-b border-zinc-900 flex-shrink-0">
    <h2 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">
      Media Library
    </h2>
  </div>

  {/* Container com Scroll */}
  <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
    
    {/* Botão de Importação - Sempre no topo */}
    <div
      onClick={handleImportFile}
      className="aspect-video w-full border border-dashed border-zinc-800 rounded-xl flex flex-col items-center justify-center group cursor-pointer hover:bg-zinc-900/50 mb-6 transition-colors flex-shrink-0"
    >
      <Plus size={20} className="text-zinc-700 group-hover:text-cyan-400 transition-colors" />
      <h2 className="text-[9px] font-black text-zinc-500 uppercase mt-2">Import Media</h2>
    </div>

    {/* Search Bar */}
    <div className="relative mb-6 group flex-shrink-0">
      <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
        <Search
          size={16}
          className={`transition-colors duration-300 ${
            searchQuery ? 'text-cyan-500' : 'text-zinc-500 group-focus-within:text-cyan-400'
          }`}
        />
      </div>

      <input
        type="text"
        placeholder="Search assets..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="h-9 w-full bg-[#161616]/50 backdrop-blur-xl border border-white/5 rounded-2xl py-3 pl-12 pr-12 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-600/30 focus:bg-[#1a1a1a] transition-all duration-300"
      />

      <AnimatePresence>
        {searchQuery && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            onClick={() => setSearchQuery("")}
            className="absolute inset-y-0 right-4 flex items-center text-zinc-500 hover:text-white transition-colors"
          >
            <X size={14} />
          </motion.button>
        )}
      </AnimatePresence>
    </div>

    {/* GRID DE ASSETS DINÂMICO */}
    <div 
      className="grid gap-3"
      style={{ 
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
        alignItems: 'start'
      }}
    >
      {filteredAssets.length > 0 ? (
        filteredAssets.map((asset, index) => (
          <motion.div
            key={asset.path}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            onClick={(e) => {
              toggleAssetSelection(asset, e.shiftKey || e.ctrlKey);
              setSourceAsset(asset);
              setInPoint(0);
              setOutPoint(0);
              setCurrentTime2(0);
            }}
            className={`group relative aspect-video bg-[#1a1a1a] rounded-lg overflow-hidden border transition-all cursor-pointer
            ${selectedAssets.includes(asset) ? 'bg-cyan-500/10 border-cyan-500' : 'bg-[#151515] border-zinc-800 hover:border-zinc-600'}`}
            draggable="true"
            onDragStart={(e) => handleDragStart(e, null, null, null, asset.name, false, null)}
          >
            {/* Thumbnail Logic */}
            {asset.type === 'audio' ? (
              <div className="absolute inset-0 flex items-center justify-center bg-[#121212]">
                <Music size={32} className="text-zinc-700 transition-colors duration-300 group-hover:text-cyan-500" />
              </div>
            ) : asset.thumbnailUrl ? (
              <img
                src={`${asset.thumbnailUrl}?t=${encodeURIComponent(asset.thumbnailUrl)}`}
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                alt={asset.name}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
                onLoad={(e) => {
                  (e.target as HTMLImageElement).style.display = '';
                }}
              />
            ) : (
              // Thumbnail still generating — pulse placeholder
              <div className="absolute inset-0 flex items-center justify-center bg-[#121212]">
                <div className="w-6 h-6 rounded-full border-2 border-zinc-700 border-t-cyan-500 animate-spin" />
              </div>
            )}

            {/* Overlay Gradiente */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-black/20 opacity-100" />

            {/* Time Badge */}
            {asset.type !== 'image' && asset.duration && (
              <div className="absolute bottom-2 right-2 bg-black/80 backdrop-blur-md px-1.5 py-0.5 rounded text-[9px] font-mono text-white/80 border border-white/5">
                {formatTime(asset.duration)}
              </div>
            )}

            {/* Type Icon Badge */}
            <div className="absolute top-2 left-2 p-1.5 bg-black/60 backdrop-blur-md rounded-md opacity-0 group-hover:opacity-100 transition-opacity border border-white/5">
              {asset.type === 'video' && <Play size={10} className="text-cyan-400 fill-cyan-400" />}
              {asset.type === 'audio' && <Music size={10} className="text-cyan-400" />}
              {asset.type === 'image' && <ImageIcon size={10} className="text-cyan-400" />}
            </div>

            {/* Asset Name with Inline Edit */}
            <div className="absolute bottom-2 left-2 right-10 opacity-0 group-hover:opacity-100 transition-opacity">
              <p
                className="text-[10px] text-zinc-200 truncate font-medium outline-none"
                contentEditable
                suppressContentEditableWarning={true}
                onDoubleClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLElement).blur(); }
                  if (e.key === 'Escape') { e.currentTarget.innerText = asset.name; e.currentTarget.blur(); }
                }}
                onBlur={(e) => {
                  const newName = e.currentTarget.innerText.trim();
                  if (newName && newName !== asset.name) handleRenameAsset(asset.name, newName);
                }}
              >
                {asset.name}
              </p>
            </div>
          </motion.div>
        ))
      ) : (
        <div className="col-span-full py-20 text-center">
          <Search size={32} className="mx-auto text-zinc-800 mb-4" />
          <p className="text-zinc-600 text-xs italic font-mono uppercase tracking-tighter">No assets found_</p>
        </div>
      )}
    </div>
  </div>

  {/* RIGHT RESIZER HANDLE - Posicionado na borda direita do aside */}
  <div
    onMouseDown={() => {
      isResizingSidebar.current = true;
      document.body.style.cursor = 'col-resize';
    }}
    className="absolute top-0 right-0 w-1 h-full cursor-col-resize z-[60] hover:bg-cyan-500/50 transition-colors group"
  >
    <div className="absolute top-1/2 right-0 w-[2px] h-8 bg-zinc-800 group-hover:bg-cyan-500 rounded-full -translate-y-1/2 transition-colors" />
  </div>
</aside>
          </>
        )}
        

        {activeTab === 'Sound' && (
          <>
            <aside className="relative border-r border-zinc-800 bg-[#0c0c0c] flex flex-col h-full w-full">
              {/* Header */}
              <div className="p-4 border-b border-zinc-900 flex-shrink-0 flex items-center justify-between">
                <h2 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">
                  Sound Library
                </h2>

                {/* 3-dot menu */}
                <div className="relative" ref={keyMenuRef}>
                  <button
                    onClick={() => setShowKeyMenu(v => !v)}
                    className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-600 hover:text-zinc-300 hover:bg-white/5 transition-all"
                    title="Opções"
                  >
                    <MoreVertical size={14} />
                  </button>

                  <AnimatePresence>
                    {showKeyMenu && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: -4 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: -4 }}
                        transition={{ duration: 0.1 }}
                        className="absolute right-0 top-9 z-50 w-52 bg-zinc-900 border border-white/10 rounded-xl shadow-2xl overflow-hidden"
                      >
                        <button
                          onClick={() => {
                            setKeyModalInput(freesoundApiKey ?? '');
                            setShowKeyModal(true);
                            setShowKeyMenu(false);
                          }}
                          className="w-full flex items-center gap-3 px-4 py-3 text-left text-[11px] text-zinc-300 hover:bg-white/5 transition-colors"
                        >
                          <Key size={13} className="text-rose-400 flex-shrink-0" />
                          <span>{freesoundApiKey ? 'Trocar API Key' : 'Inserir API Key'}</span>
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              {/* Modal para inserir/trocar chave */}
              <AnimatePresence>
                {showKeyModal && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6"
                    onClick={(e) => { if (e.target === e.currentTarget) setShowKeyModal(false); }}
                  >
                    <motion.div
                      initial={{ scale: 0.95, y: 8 }}
                      animate={{ scale: 1, y: 0 }}
                      exit={{ scale: 0.95, y: 8 }}
                      className="w-full bg-zinc-900 border border-white/10 rounded-2xl p-5 shadow-2xl flex flex-col gap-4"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-xl bg-rose-600/20 flex items-center justify-center">
                          <Key size={15} className="text-rose-400" />
                        </div>
                        <div>
                          <p className="text-[11px] font-black text-zinc-200 uppercase tracking-widest">API Key Freesound</p>
                          <p className="text-[9px] text-zinc-600 uppercase tracking-wider">Sua chave pessoal e gratuita</p>
                        </div>
                      </div>

                      <input
                        type="text"
                        value={keyModalInput}
                        onChange={e => setKeyModalInput(e.target.value)}
                        placeholder="Cole sua API Key aqui..."
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-[11px] text-zinc-200 placeholder:text-zinc-700 focus:outline-none focus:border-rose-500/40 transition-all font-mono"
                        onKeyDown={e => { if (e.key === 'Enter') handleSaveApiKey(); }}
                        autoFocus
                      />

                      <div className="flex gap-2">
                        <button
                          onClick={() => setShowKeyModal(false)}
                          className="flex-1 h-9 rounded-xl border border-white/10 text-[10px] font-bold text-zinc-500 hover:text-zinc-300 hover:bg-white/5 transition-all uppercase tracking-widest"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleSaveApiKey}
                          disabled={keySaving || !keyModalInput.trim()}
                          className="flex-1 h-9 rounded-xl bg-rose-600/20 border border-rose-500/30 text-[10px] font-black text-rose-300 hover:bg-rose-600/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all uppercase tracking-widest flex items-center justify-center gap-2"
                        >
                          {keySaving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                          Save
                        </button>
                      </div>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Loading da chave */}
              {apiKeyLoading && (
                <div className="flex-1 flex items-center justify-center">
                  <Loader2 size={20} className="text-rose-500 animate-spin" />
                </div>
              )}

              {/* Tela: sem API key configurada */}
              {!apiKeyLoading && !freesoundApiKey && (
                <div className="flex-1 overflow-y-auto p-5 custom-scrollbar flex flex-col gap-5">
                  <div className="flex flex-col items-center gap-3 pt-6 pb-2 text-center">
                    <div className="w-14 h-14 rounded-2xl bg-rose-600/10 border border-rose-500/20 flex items-center justify-center">
                      <Key size={22} className="text-rose-400" />
                    </div>
                    <div>
                     <p className="text-[12px] font-black text-zinc-200 uppercase tracking-widest mb-1">Freesound API Key</p>
                      <p className="text-[9px] text-zinc-500 uppercase tracking-widest leading-relaxed">
                        You need a free key<br/>to search for sounds
                      </p>
                    </div>
                  </div>

                  {/* Guia rápido */}
                  <div className="flex flex-col gap-2">
                    {[
                       { step: '1', text: 'Create a free account at freesound.org' },
                      { step: '2', text: 'Go to: freesound.org/apiv2/apply' },
                      { step: '3', text: 'Fill out the form (for personal use)' },
                      { step: '4', text: 'Copy the "Client secret / API Key" field' },
                      { step: '5', text: 'Paste it here using the button below' },
                    ].map(({ step, text }) => (
                      <div key={step} className="flex items-start gap-3 bg-white/[0.02] border border-white/5 rounded-xl px-3 py-2.5">
                        <span className="flex-shrink-0 w-5 h-5 rounded-full bg-rose-600/20 text-rose-400 text-[9px] font-black flex items-center justify-center mt-0.5">{step}</span>
                        <p className="text-[10px] text-zinc-400 leading-relaxed">{text}</p>
                      </div>
                    ))}
                  </div>

                  <a
                    href="https://freesound.org/apiv2/apply"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 h-9 rounded-xl bg-white/[0.03] border border-white/10 text-[10px] font-bold text-zinc-400 hover:text-zinc-200 hover:border-white/20 transition-all uppercase tracking-widest"
                  >
                    <ExternalLink size={11} />
                    Open freesound.org
                  </a>

                  <button
                    onClick={() => { setKeyModalInput(''); setShowKeyModal(true); }}
                    className="flex items-center justify-center gap-2 h-10 rounded-xl bg-rose-600/20 border border-rose-500/30 text-[10px] font-black text-rose-300 hover:bg-rose-600/30 transition-all uppercase tracking-widest"
                  >
                    <Key size={12} />
                    Enter my API Key
                  </button>
                </div>
              )}

              {/* Conteúdo normal quando há chave */}
              {!apiKeyLoading && freesoundApiKey && (
              <div className="flex-1 overflow-y-auto p-4 custom-scrollbar flex flex-col gap-4">

                {/* Search Bar */}
                <div className="relative group flex-shrink-0">
                  <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                    {soundLoading
                      ? <Loader2 size={14} className="text-rose-400 animate-spin" />
                      : <Search size={14} className={`transition-colors ${soundQuery ? 'text-rose-400' : 'text-zinc-500 group-focus-within:text-rose-400'}`} />
                    }
                  </div>
                  <input
                    type="text"
                    placeholder="Search sounds..."
                    value={soundQuery}
                    onChange={e => setSoundQuery(e.target.value)}
                    className="h-9 w-full bg-[#161616]/50 backdrop-blur-xl border border-white/5 rounded-2xl py-3 pl-10 pr-10 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-rose-600/30 focus:bg-[#1a1a1a] transition-all duration-300"
                  />
                  <AnimatePresence>
                    {soundQuery && (
                      <motion.button
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        onClick={() => { setSoundQuery(''); setSoundResults([]); }}
                        className="absolute inset-y-0 right-3 flex items-center text-zinc-500 hover:text-white transition-colors"
                      >
                        <X size={13} />
                      </motion.button>
                    )}
                  </AnimatePresence>
                </div>

                {/* License filter buttons */}
                <div className="flex gap-2 flex-shrink-0">
                  {(
                    [
                      { id: 'cc0',  label: 'CC0',  tip: 'No rights reserved — use freely, no credit needed.' },
                      { id: 'ccby', label: 'CC BY', tip: 'Free to use — credit the author.' },
                      { id: 'ccnc', label: 'CC NC', tip: 'Non-commercial use only — credit required.' },
                    ] as { id: LicenseFilter; label: string; tip: string }[]
                  ).map(({ id, label, tip }) => (
                    <div key={id} className="relative group/tip flex-1">
                      <button
                        onClick={() => setSoundLicense(id)}
                        className={`w-full h-7 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all duration-200
                          ${soundLicense === id
                            ? 'bg-rose-600/20 border-rose-500/60 text-rose-300'
                            : 'bg-white/[0.03] border-white/10 text-zinc-500 hover:border-white/20 hover:text-zinc-300'
                          }`}
                      >
                        {label}
                      </button>
                      {/* Tooltip */}
                      <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 rounded-md bg-zinc-800 text-[9px] text-zinc-200 whitespace-nowrap opacity-0 group-hover/tip:opacity-100 transition-opacity z-50 shadow-xl border border-white/5">
                        {tip}
                        <div className="absolute top-full left-1/2 -translate-x-1/2 w-2 h-2 bg-zinc-800 rotate-45 -mt-1" />
                      </div>
                    </div>
                  ))}
                </div>

                {/* Results list */}
                <div className="flex flex-col gap-2">
                  {!soundQuery.trim() && !soundLoading && (
                    <div className="py-16 flex flex-col items-center gap-3 text-center">
                      <Music size={28} className="text-zinc-800" />
                      <p className="text-[10px] text-zinc-600 uppercase tracking-widest font-bold">
                        Search for royalty-free sounds
                      </p>
                      <p className="text-[9px] text-zinc-700 uppercase tracking-widest">
                        Powered by Freesound.org
                      </p>
                    </div>
                  )}

                  {soundLoading && (
                    <div className="py-16 flex flex-col items-center gap-3">
                      <Loader2 size={22} className="text-rose-500 animate-spin" />
                      <p className="text-[10px] text-zinc-600 uppercase tracking-widest">Searching...</p>
                    </div>
                  )}

                  {!soundLoading && soundQuery.trim() && soundResults.length === 0 && (
                    <div className="py-16 flex flex-col items-center gap-3">
                      <Search size={22} className="text-zinc-800" />
                      <p className="text-[10px] text-zinc-600 uppercase tracking-widest">No results found</p>
                    </div>
                  )}

                  {!soundLoading && soundResults.map(sound => {
                    const licKind = getLicenseKind(sound.license);
                    const isCCBY  = licKind === 'ccby';
                    const isDown  = soundDownloading[sound.id];
                    const isDone  = soundDownloaded[sound.id];
                    const isCopied = copiedCredit === sound.id;
                    
                    // Estados do Player de Preview
                    const isPlaying = playingId === sound.id;
                    const isCurrentPlayingProgress = playbackProgress[sound.id] ?? 0;
                    const isDownloadingProgress = soundProgress[sound.id] ?? 0;

                    return (
                      <motion.div
                        key={sound.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="group relative flex items-center gap-3 bg-white/[0.02] border border-white/5 rounded-xl px-3 py-2.5 hover:border-rose-500/20 hover:bg-white/[0.04] transition-all overflow-hidden"
                      >
                        {/* ÍCONE DE MÚSICA / PLAY / PAUSE INTERATIVO */}
                        <button
                          onClick={() => handleTogglePreview(sound)}
                          className={`flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-all duration-200 cursor-pointer
                            ${isPlaying 
                              ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30 shadow-[0_0_10px_rgba(244,63,94,0.15)]' 
                              : 'bg-rose-600/10 text-rose-400 hover:bg-rose-500/20 group-hover:text-rose-300'
                            }`}
                        >
                          {isPlaying ? (
                            // Ícone animado simples ou Pause se estiver tocando
                            <div className="flex items-center gap-[2px] h-3">
                              <span className="w-[2px] h-3 bg-rose-400 animate-[pulse_0.5s_infinite_alternate]" />
                              <span className="w-[2px] h-2 bg-rose-400 animate-[pulse_0.5s_infinite_alternate_0.15s]" />
                              <span className="w-[2px] h-3 bg-rose-400 animate-[pulse_0.5s_infinite_alternate_0.3s]" />
                            </div>
                          ) : (
                            <Play size={10} className="fill-rose-400 text-rose-400 ml-[1px]" />
                          )}
                        </button>

                        {/* Name + meta */}
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] text-zinc-200 font-semibold truncate leading-tight">
                            {sound.name}
                          </p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <Clock size={8} className="text-zinc-700" />
                            <span className="text-[9px] text-zinc-600">{formatDuration(sound.duration)}</span>
                            {licKind && (
                              <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full tracking-widest
                                ${licKind === 'cc0'  ? 'bg-emerald-600/15 text-emerald-500'  : ''}
                                ${licKind === 'ccby' ? 'bg-amber-600/15  text-amber-400'    : ''}
                                ${licKind === 'ccnc' ? 'bg-blue-600/15   text-blue-400'     : ''}
                              `}>
                                {licKind === 'cc0' ? 'CC0' : licKind === 'ccby' ? 'CC BY' : 'CC NC'}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Action buttons */}
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {/* Copy credit — only for CCBY */}
                          {isCCBY && (
                            <div className="relative group/copy">
                              <button
                                onClick={() => handleCopyCredit(sound)}
                                className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all
                                  ${isCopied
                                    ? 'bg-amber-500/20 text-amber-400'
                                    : 'bg-white/5 text-zinc-500 hover:bg-amber-600/15 hover:text-amber-400'
                                  }`}
                              >
                                {isCopied ? <Check size={11} /> : <Copy size={11} />}
                              </button>
                              <div className="pointer-events-none absolute bottom-full right-0 mb-2 px-2 py-1 rounded-md bg-zinc-800 text-[9px] text-zinc-200 whitespace-nowrap opacity-0 group-hover/copy:opacity-100 transition-opacity z-50 shadow-xl border border-white/5">
                                Copy Author Credit
                                <div className="absolute top-full right-2 w-2 h-2 bg-zinc-800 rotate-45 -mt-1" />
                              </div>
                            </div>
                          )}

                          {/* Download */}
                          <button
                            onClick={() => !isDown && !isDone && handleDownloadSound(sound)}
                            disabled={isDown || isDone}
                            className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all
                              ${isDone
                                ? 'bg-emerald-600/15 text-emerald-400'
                                : isDown
                                ? 'bg-rose-600/10 text-rose-400 cursor-not-allowed'
                                : 'bg-white/5 text-zinc-500 hover:bg-rose-600/15 hover:text-rose-400'
                              }`}
                          >
                            {isDone
                              ? <Check size={11} />
                              : isDown
                              ? <Loader2 size={11} className="animate-spin" />
                              : <Download size={11} />
                            }
                          </button>
                        </div>

                        {/* BARRA DE PROGRESSO DUPLA FUNÇÃO (DOWNLOAD OU SEEK DA PREVIEW) */}
                        <div 
                          onClick={(e) => handleSeekProgress(e, sound)}
                          className={`absolute bottom-0 left-0 w-full h-[3px] bg-zinc-950 transition-all duration-150
                            ${isPlaying ? 'cursor-ew-resize h-[5px] hover:h-[6px]' : ''}`}
                        >
                          {/* Condição 1: Renderiza o Progresso do Playback se estiver tocando */}
                          {isPlaying ? (
                            <div
                              style={{ width: `${isCurrentPlayingProgress}%` }}
                              className="h-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)] transition-all duration-75"
                            />
                          ) : (
                            // Condição 2: Caso contrário, mantém o comportamento original da barra de download
                            isDownloadingProgress > 0 && (
                              <motion.div
                                animate={{ width: `${isDownloadingProgress}%` }}
                                transition={{ ease: 'easeOut', duration: 0.25 }}
                                className={`h-full rounded-full ${
                                  soundDownloaded[sound.id]
                                    ? 'bg-emerald-500 shadow-[0_0_6px_rgba(52,211,153,0.6)]'
                                    : 'bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.5)]'
                                }`}
                              />
                            )
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
              )} {/* fim do bloco {!apiKeyLoading && freesoundApiKey && ( */}

              {/* Resize handle */}
              <div
                onMouseDown={() => {
                  isResizingSidebar.current = true;
                  document.body.style.cursor = 'col-resize';
                }}
                className="absolute top-0 right-0 w-1 h-full cursor-col-resize z-[60] hover:bg-rose-500/50 transition-colors group"
              >
                <div className="absolute top-1/2 right-0 w-[2px] h-8 bg-zinc-800 group-hover:bg-rose-500 rounded-full -translate-y-1/2 transition-colors" />
              </div>
            </aside>
          </>
        )}
                



        {/* Seção de Texto/Fontes no ItensAside.tsx */}
        {(activeTab === 'Text') && (
          <div className="grid grid-cols-1 gap-2">
              {/* --- FONTES LOCAIS --- */}
              {availableFonts.map((fontPath) => {
                const fontFile = fontPath.split(/[\\/]/).pop() || "";
                const fontName = fontFile.split('.')[0];
                return (
                  <motion.div
                    key={fontPath}
                    draggable
                    onDragStart={(e) => handleDragStartText(e,fontName, fontPath)}
                    className="group relative flex flex-col bg-white/[0.02] border border-white/5 p-3 rounded-lg hover:border-cyan-500/30 hover:bg-white/5 cursor-grab active:cursor-grabbing transition-all overflow-hidden h-[85px]"
                  >
                    <div className="flex-1 flex items-center min-h-0">
                      <p 
                        style={{ fontFamily: fontName, fontSize: 'clamp(12px, 4vw, 20px)' }} 
                        className="text-white truncate w-full leading-none"
                      >
                        {fontName.replace(/_/g, ' ')}
                      </p>
                    </div>
                    
                    <div className="flex justify-between items-center pt-2 border-t border-white/5 mt-auto">
                      <span className="text-[7px] text-zinc-600 uppercase font-black tracking-tighter">
                         {fontPath.split('.').pop()?.toUpperCase()}
                      </span>
                      <Type size={10} className="text-zinc-700 group-hover:text-cyan-500 transition-colors" />
                    </div>
                  </motion.div>
                );
              })}

              {/* --- FONTES CLOUD --- */}
              {cloudFonts
                .filter(cf => !availableFonts.some(af => af.includes(cf.file)))
                .map((font) => {
                  const fontName = font.file.split('.')[0];
                  const progress = downloadProgress[font.file] || 0;

                  return (
                    <div key={font.id} className="group relative flex flex-col bg-zinc-950/40 border border-dashed border-white/10 p-3 rounded-lg hover:border-cyan-500/30 transition-all h-[85px] overflow-hidden">
                      <CloudFontPreviewStyles fonts={[font]} />
                      
                      <div className="flex-1 flex items-center min-h-0">
                        <p 
                          style={{ 
                            fontFamily: `'${fontName}_preview', sans-serif`,
                            fontSize: 'clamp(12px, 4vw, 20px)' 
                          }} 
                          className="text-zinc-500 group-hover:text-zinc-200 transition-colors truncate w-full leading-none"
                        >
                          {fontName.replace(/_/g, ' ')}
                        </p>
                      </div>

                      <div className="flex justify-between items-center pt-2 border-t border-white/5 mt-auto">
                        <div className="flex items-center gap-1">
                          {font.plan !== 'free' && <DiamondPlus size={8} className="text-cyan-400 fill-cyan-400/20" />}
                          <span className="text-[7px] text-zinc-700 uppercase font-bold tracking-tighter">{font.plan} </span>
                        </div>
                        
                        {
                          font.plan == 'free' &&
                            <button 
                            onClick={() => handleDownloadFont(font.file)}
                            className="hover:text-cyan-400 transition-all text-zinc-600"
                          >
                            <Download size={12} />
                          </button>
                        }
                      </div>

                      {/* Barra de Progresso no Fundo */}
                      {progress > 0 && (
                        <div className="absolute bottom-0 left-0 w-full h-[2px] bg-zinc-900">
                          <motion.div 
                            animate={{ width: `${progress}%` }}
                            className="h-full bg-cyan-500 shadow-[0_0_8px_rgba(34,211,238,0.5)]"
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
                      </div>
        )}
        
        
        {
        
        
        (activeTab ==='Text' && availableFonts.length == 0 && cloudFonts.length == 0) &&
        (

          <div className="flex-1 flex flex-col items-center justify-center p-10 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center text-zinc-700">
               {menuOptions.find(o => o.id === activeTab)?.icon}
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-tighter">{activeTab} No Fonts </h3>
              <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-medium"> Download and put in subfolder fonts in freecut_settings (check  the configurations) </p>
            </div>
          </div>

        )
        
        }
        
        {activeTab === 'Effects' && (
            <div className="flex-1 flex flex-col p-4 space-y-6 overflow-y-auto custom-scrollbar">
              
              
              {/* Video Effects */}

              { (typeofclip == 'video' || typeofclip == 'image') && (
              <div>
                <h3 className="text-[10px] font-black uppercase tracking-widest text-purple-500 mb-4">
                  Video Effects
                </h3>
                <div className="grid grid-cols-1 gap-2">
                  {VIDEO_EFFECTS.map((eff) => (
                    <motion.div
                      key={eff.id}
                      draggable
                      onDragStart={(e) => handleDragStartEffect(e, eff.id, 'video')}
                      className="group relative bg-purple-600/5 border border-purple-500/10 p-3 rounded-lg hover:border-purple-500/40 hover:bg-purple-600/10 cursor-grab active:cursor-grabbing transition-all"
                    >
                      <div className="flex items-center gap-3">
                        <Sparkles size={16} className="text-purple-400" />
                        <p className="text-xs text-zinc-200 font-medium">{eff.label}</p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>)
              
            
            }

              {/* Audio Effects */}
              { (typeofclip == 'video' || typeofclip == 'audio') && ( <div>
                <h3 className="text-[10px] font-black uppercase tracking-widest text-fuchsia-500 mb-4">
                  Audio Effects
                </h3>
                <div className="grid grid-cols-1 gap-2">
                  {AUDIO_EFFECTS.map((eff) => (
                    <motion.div
                      key={eff.id}
                      draggable
                      onDragStart={(e) => handleDragStartEffect(e, eff.id, 'audio')}
                      className="group relative bg-fuchsia-600/5 border border-fuchsia-500/10 p-3 rounded-lg hover:border-fuchsia-500/40 hover:bg-fuchsia-600/10 cursor-grab active:cursor-grabbing transition-all"
                    >
                      <div className="flex items-center gap-3">
                        <Music size={16} className="text-fuchsia-400" />
                        <p className="text-xs text-zinc-200 font-medium">{eff.label}</p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div> 
            )}
            </div>
          )}

          {activeTab === 'Transitions' && (
            <div className="flex-1 flex flex-col p-4 space-y-4 overflow-y-auto custom-scrollbar">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-blue-500 mb-2">
                Transitions Library
              </h3>
              <div className="grid grid-cols-1 gap-2">
                {TRANSITIONS_LIST.map((trans) => (
                  <motion.div
                    key={trans.id}
                    draggable
                    onDragStart={(e) => handleDragStartTransition(e, trans.id)}
                    className="group relative bg-blue-600/5 border border-blue-500/10 p-4 rounded-xl hover:border-blue-500/40 hover:bg-blue-600/10 cursor-grab active:cursor-grabbing transition-all border-dashed"
                  >
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Layers size={20} className="text-blue-400 group-hover:scale-110 transition-transform" />
                      <p className="text-[10px] text-zinc-300 font-bold uppercase tracking-tighter">
                        {trans.label}
                      </p>
                    </div>
                    
                    {/* Visual Indicator of Overlap */}
                    <div className="absolute bottom-1 left-1/2 -translate-x-1/2 w-8 h-1 bg-blue-500/20 rounded-full overflow-hidden">
                      <div className="w-1/2 h-full bg-blue-500 mx-auto" />
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          )}
        
        
        
        
      </div>
    </aside>
  );
};