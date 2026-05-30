import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  X, Monitor, Film, Music, 
  Cpu, History, FolderEdit, Keyboard, 
  AlertTriangle, Layout 
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

interface ProjectSettings {
  name: string;
  width: number;
  height: number;
  fps: number;
  backgroundColor: string;
  sampleRate: number;
}

interface wannacutSettings {
  workspace: string;
  gpu: string | null;
  shortcuts: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  currentProjectSettings: ProjectSettings;
  onSaveProject: (settings: ProjectSettings) => void;
  isProjectLoaded: boolean;
  showNotify: (message: string, type: 'success' | 'error') => void;
  // Novas propriedades necessárias:
  currentProjectPath: string;
  onLoadHistoryVersion: (projectDataJson: string) => void;
}

export const SettingsModal: React.FC<Props> = ({ 
  isOpen, 
  onClose, 
  currentProjectSettings, 
  onSaveProject,
  isProjectLoaded,
  showNotify,
  currentProjectPath,
  onLoadHistoryVersion 
}) => {
  // Ajuste: Se não houver projeto, a aba inicial DEVE ser' (System)
  const [activeTab, setActiveTab] = useState(isProjectLoaded ? 'project' : 'wannacut');
  // Estado para controlar qual arquivo está aguardando confirmação de restauração
  const [pendingRestoreFile, setPendingRestoreFile] = useState<string | null>(null);
  
  const [projSettings, setProjSettings] = useState<ProjectSettings>(currentProjectSettings);
  const [wannacutSettings, setwannacutSettings] = useState<wannacutSettings>({
    workspace: '',
    gpu: null,
    shortcuts: ''
  });
  const [detectedGpus, setDetectedGpus] = useState<string[]>([]);


    // Dentro do componente SettingsModal, adicione estes estados e funções:

  const [historyFiles, setHistoryFiles] = useState<string[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(false);

  // Carrega o histórico de arquivos sempre que a aba mudar para 'history'
  useEffect(() => {
    if (isOpen && activeTab === 'history' && currentProjectPath) {
      loadHistoryFiles();
    }
  }, [activeTab, isOpen]);

  const loadHistoryFiles = async () => {
    setIsLoadingHistory(true);
    try {
      const files = await invoke('list_project_files', { projectPath: currentProjectPath }) as string[];
      // O Rust já ordena os arquivos de forma crescente. 
      // Invertemos (.reverse()) para exibir o arquivo mais recente no topo da lista.
      setHistoryFiles(files.reverse());
    } catch (err) {
      console.error("Failed to load project history:", err);
      showNotify("Error loading history logs", 'error');
    } finally {
      setIsLoadingHistory(false);
    }
  };


  // 1. Chamado ao clicar no botão "Restore Version" da lista
const handleRestoreVersion = (fileName: string) => {
  setPendingRestoreFile(fileName); // Abre o modal de confirmação em React
};

// 2. Chamado quando o usuário clica em "Confirm" no modal em React
const executeRestore = async () => {
  if (!pendingRestoreFile) return;

  try {
    const jsonContent = await invoke('read_specific_file', { 
      projectPath: currentProjectPath, 
      fileName: pendingRestoreFile 
    }) as string;

    onLoadHistoryVersion(jsonContent);
    showNotify("Project version restored successfully!", 'success');
    setPendingRestoreFile(null);
    onClose(); // Fecha o SettingsModal principal
  } catch (err) {
    console.error("Failed to read history file:", err);
    showNotify("Failed to restore this version.", 'error');
    setPendingRestoreFile(null);
  }
};

  // Função auxiliar para formatar o nome do arquivo "main1716123456789.project" para algo legível
  const formatHistoryName = (fileName: string) => {
    // Regex extrai apenas os números contidos entre 'main' e '.project'
    const timestampMatch = fileName.match(/main(\d+)\.project/);
    if (!timestampMatch) return { dateStr: fileName, isAuto: false };

    const timestamp = parseInt(timestampMatch[1], 10);
    const date = new Date(timestamp);

    return {
      dateStr: date.toLocaleDateString() + ' - ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      isAuto: true
    };
  };

  const presets = [
    { label: '4K Ultra HD', w: 3840, h: 2160 },
    { label: '1080p Full HD', w: 1920, h: 1080 },
    { label: 'TikTok / Shorts', w: 1080, h: 1920 },
    { label: 'Instagram Square', w: 1080, h: 1080 },
  ];

  // Sincroniza a aba ativa caso o estado do projeto mude com o modal aberto
  useEffect(() => {
    if (!isProjectLoaded && (activeTab === 'project' || activeTab === 'history')) {
      setActiveTab('wannacut');
    }

    if(isProjectLoaded)
      setActiveTab('project');

  }, [isProjectLoaded]);

  useEffect(() => {
    if (isOpen) {
      loadwannacutSettings();
      detectSystemGpus();
      // Atualiza o estado local com as settings atuais do projeto ao abrir
      setProjSettings(currentProjectSettings);
    }
  }, [isOpen]);



  const loadwannacutSettings = async () => {
    const configPath = localStorage.getItem("wannacut_settings_folder");
    if (!configPath) return;
    try {
      const content = await invoke('read_settings_file', { path: `${configPath}/wannacut_settings.json` }) as string;
      setwannacutSettings(JSON.parse(content));
    } catch (err) { console.error(err); }
  };

  const detectSystemGpus = async () => {
    try {
      const gpus = await invoke('get_system_gpus') as string[];
      setDetectedGpus(gpus);
    } catch (e) { setDetectedGpus([]); }
  };

  const savewannacutSettings = async (newSettings: wannacutSettings) => {
    const configPath = localStorage.getItem("wannacut_settings_folder");
    if (!configPath) return;
    await invoke('save_settings_file', { 
      path: `${configPath}/wannacut_settings.json`, 
      content: JSON.stringify(newSettings, null, 2) 
    });
  };


  const handleSelectFolder = async (type: 'settings' | 'workspace') => {
    const selectedBase = await open({ directory: true, multiple: false });
    
    if (selectedBase && typeof selectedBase === 'string') {
      const subName = type === 'settings' ? 'wannacut_settings' : 'project_wannacut';
      const oppositeName = type === 'settings' ? 'project_wannacut' : 'wannacut_settings';

      if (selectedBase.includes(oppositeName)) {
        alert(`Hierarchy Error: You cannot select a location that contains or is within "${oppositeName}".`);
        return;
      }

      const fullPath = selectedBase.endsWith(subName) 
        ? selectedBase 
        : `${selectedBase}/${subName}`;

      const oldPath = type === 'settings' 
        ? localStorage.getItem("wannacut_settings_folder") 
        : wannacutSettings.workspace;

      if (oldPath && oldPath !== fullPath) {
        const confirmTransfer = window.confirm(
          `Do you want to transfer data from:\n${oldPath}\nFor the new location:\n${fullPath}?`
        );

        if (confirmTransfer) {
          try {
            await invoke('transfer_folder_content', { oldPath, newPath: fullPath });
            //window.location.reload();
          } catch (err) {
            showNotify("File migration failed: " + err, 'error');
            return; 
          }
        }
      }

      try {
        if (type === 'settings') {
          localStorage.setItem("wannacut_settings_folder", fullPath);
          
          await invoke('init_settings_structure', { path: fullPath });

          await loadwannacutSettings();
          
        } else {
          const newS = { ...wannacutSettings, workspace: fullPath };
          
          await invoke('init_workspace_structure', { path: fullPath }); 
          
          setwannacutSettings(newS);
          
          await savewannacutSettings(newS);
        }
        
        showNotify(`${type} successfully updated to: ${fullPath}`, 'success');
        //window.location.reload();


      } catch (err) {
        console.error(`Error in configurate dir ${type}:`, err);
        showNotify("Error initializing folder structure in the system.", 'error');
      }
    }


  };


  // Definição das opções com a trava lógica
  const allMenuOptions = [
    { id: 'project', icon: <Layout size={16} />, label: 'Project', color: 'text-blue-400', dependOfProject: true },
    { id: 'history', icon: <History size={16} />, label: 'History', color: 'text-purple-400', dependOfProject: true },
    { id: 'wannacut', icon: <Cpu size={16} />, label: 'System', color: 'text-cyan-400', dependOfProject: false },
  ];

  // Filtramos as opções que podem ser exibidas
  const visibleMenuOptions = allMenuOptions.filter(opt => !opt.dependOfProject || isProjectLoaded);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
      <motion.div 
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="bg-[#0a0a0c] border border-white/10 w-full max-w-2xl h-[750px] rounded-xl overflow-hidden flex shadow-2xl"
      >
        {/* --- SIDEBAR SLIM --- */}
        <nav className="w-[60px] bg-black/40 border-r border-white/5 flex flex-col items-center py-8 gap-8">
          {visibleMenuOptions.map((opt) => (
            <button
              key={opt.id}
              onClick={() => setActiveTab(opt.id)}
              className={`group relative p-2.5 rounded-lg transition-all ${
                activeTab === opt.id ? 'bg-white/5 ' + opt.color : 'text-zinc-700 hover:text-zinc-400'
              }`}
            >
              {opt.icon}
              <span className="absolute left-14 px-2 py-1 rounded bg-zinc-800 text-[8px] uppercase font-bold tracking-widest text-white opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">
                {opt.label}
              </span>
            </button>
          ))}
          <button onClick={onClose} className="mt-auto p-2.5 text-zinc-700 hover:text-red-500 transition-colors">
            <X size={18} />
          </button>
        </nav>

        {/* --- CONTENT SLIM --- */}
        <main className="flex-1 flex flex-col min-w-0">
          <header className="px-6 py-5 border-b border-white/5">
            <h2 className="text-[9px] font-black uppercase tracking-[0.4em] text-zinc-600">
              wannacut / <span className="text-zinc-200">{activeTab}</span>
            </h2>
          </header>

          <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
            {activeTab === 'project' && isProjectLoaded && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="space-y-1.5">
                  <label className="text-zinc-500 text-[9px] font-bold uppercase tracking-widest">Project Name</label>
                  <input 
                    type="text"
                    className="w-full bg-white/5 border border-white/10 rounded px-3 py-1.5 text-xs text-white outline-none focus:border-blue-500/40 transition-all"
                    value={projSettings.name}
                    onChange={(e) => setProjSettings({...projSettings, name: e.target.value})}
                  />
                </div>

                <div className="space-y-3">
                  <label className="text-zinc-500 text-[9px] font-bold uppercase tracking-widest flex items-center gap-2">
                    <Monitor size={12} /> Format Presets
                  </label>
                  <div className="grid grid-cols-1 gap-2">
                    {presets.map((p) => (
                      <button
                        key={p.label}
                        onClick={() => setProjSettings({ ...projSettings, width: p.w, height: p.h })}
                        className={`px-3 py-2 rounded border flex justify-between items-center transition-all ${
                          projSettings.width === p.w && projSettings.height === p.h 
                          ? 'bg-blue-600/10 border-blue-500/50 text-blue-400' 
                          : 'bg-white/2 border-white/5 text-zinc-500 hover:bg-white/5'
                        }`}
                      >
                        <span className="font-bold text-[10px] uppercase tracking-tighter">{p.label}</span>
                        <span className="opacity-40 text-[9px]">{p.w}x{p.h}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <span className="text-zinc-600 text-[9px] uppercase font-bold">Width</span>
                    <input 
                      type="number" 
                      className="w-full bg-white/5 border border-white/10 rounded px-3 py-1.5 text-xs text-white outline-none"
                      value={projSettings.width}
                      onChange={(e) => setProjSettings({...projSettings, width: parseInt(e.target.value) || 0})}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <span className="text-zinc-600 text-[9px] uppercase font-bold">Height</span>
                    <input 
                      type="number" 
                      className="w-full bg-white/5 border border-white/10 rounded px-3 py-1.5 text-xs text-white outline-none"
                      value={projSettings.height}
                      onChange={(e) => setProjSettings({...projSettings, height: parseInt(e.target.value) || 0})}
                    />
                  </div>
                </div>

                <div className="space-y-4 pt-2">
                  <div className="space-y-1.5">
                    <label className="text-zinc-500 text-[9px] font-bold uppercase flex items-center gap-2 italic"><Film size={12} /> Frame Rate</label>
                    <select 
                      className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-white outline-none"
                      value={projSettings.fps}
                      onChange={(e) => setProjSettings({...projSettings, fps: parseFloat(e.target.value)})}
                    >
                      <option value={23.976} className="bg-zinc-900">23.976 fps</option>
                      <option value={24} className="bg-zinc-900">24 fps</option>
                      <option value={30} className="bg-zinc-900">30 fps</option>
                      <option value={60} className="bg-zinc-900">60 fps</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-zinc-500 text-[9px] font-bold uppercase flex items-center gap-2 italic"><Music size={12} /> Sample Rate</label>
                    <select 
                      className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-white outline-none"
                      value={projSettings.sampleRate}
                      onChange={(e) => setProjSettings({...projSettings, sampleRate: parseInt(e.target.value)})}
                    >
                      <option value={44100} className="bg-zinc-900">44100 Hz</option>
                      <option value={48000} className="bg-zinc-900">48000 Hz</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'wannacut' && (
              <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <section className="space-y-3">
                  <div className="flex items-center gap-2 text-cyan-500/70">
                    <Cpu size={14} />
                    <h3 className="text-[9px] font-black uppercase tracking-widest">Hardware</h3>
                  </div>
                  <div className="p-4 rounded border border-white/5 bg-white/2 space-y-3">
                    <select 
                      value={wannacutSettings.gpu || 'null'}
                      onChange={(e) => {
                        const val = e.target.value === 'none' ? null : e.target.value;
                        const newS = {...wannacutSettings, gpu: val};
                        setwannacutSettings(newS);
                        savewannacutSettings(newS);
                      }}
                      className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs outline-none text-white"
                    >
                      <option value="none"> None </option>
                      {detectedGpus.map(g => <option key={g} value={g}>{g}</option>)}


                      
                      
                    </select>


                    {(!wannacutSettings.gpu || wannacutSettings.gpu ==  "null" ) && (
                          <div className="flex gap-3 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 text-[10px] leading-relaxed italic">
                            <AlertTriangle size={24} className="shrink-0" />
                            <p>Warning: Without hardware acceleration, advanced tools like "Background Removal" and "Vocal Extraction" will be disabled or significantly slower.</p>
                          </div>
                      )}
                  </div>
                </section>

                <section className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-zinc-600 text-[8px] font-bold uppercase italic">Settings Folder</label>
                    <button onClick={() => handleSelectFolder('settings')} className="w-full flex justify-between bg-white/2 border border-white/5 px-3 py-2 rounded text-[10px] hover:bg-white/5 transition-all text-zinc-400">
                      <span className="truncate max-w-[180px]">{localStorage.getItem("wannacut_settings_folder") || 'Set folder...'}</span>
                      <FolderEdit size={12} />
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-zinc-600 text-[8px] font-bold uppercase italic">Workspace Root</label>
                    <button onClick={() => handleSelectFolder('workspace')} className="w-full flex justify-between bg-white/2 border border-white/5 px-3 py-2 rounded text-[10px] hover:bg-white/5 transition-all text-zinc-400">
                      <span className="truncate max-w-[180px]">{wannacutSettings.workspace || 'Set workspace...'}</span>
                      <FolderEdit size={12} />
                    </button>
                  </div>
                </section>
              </div>
            )}


            {activeTab === 'history' && isProjectLoaded && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div className="flex items-center gap-2 text-purple-500/70">
                    <History size={14} />
                    <h3 className="text-[9px] font-black uppercase tracking-widest">Backup History Logs</h3>
                  </div>
                  
                  <p className="text-zinc-500 text-[10px] italic leading-relaxed">
                    Select a historical auto-save version below to restore the timeline and configurations to that specific state.
                  </p>

                  {isLoadingHistory ? (
                    <div className="text-center py-8 text-zinc-600 text-[10px] font-bold uppercase tracking-widest">
                      Reading backup filesystem...
                    </div>
                  ) : historyFiles.length === 0 ? (
                    <div className="text-center py-8 text-zinc-600 text-[10px] font-bold uppercase tracking-widest border border-dashed border-white/5 rounded-lg bg-white/1">
                      No history files found for this project.
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-[450px] overflow-y-auto pr-1 custom-scrollbar">
                      {historyFiles.map((file) => {
                        const { dateStr } = formatHistoryName(file);
                        return (
                          <button
                            key={file}
                            onClick={() => handleRestoreVersion(file)}
                            className="w-full text-left px-4 py-3 rounded border border-white/5 bg-white/2 hover:bg-purple-600/10 hover:border-purple-500/30 group flex justify-between items-center transition-all"
                          >
                            <div className="space-y-1">
                              <span className="font-bold text-[10px] tracking-wide text-zinc-300 group-hover:text-purple-400 transition-colors">
                                {dateStr}
                              </span>
                              <div className="text-[8px] font-mono text-zinc-600 group-hover:text-zinc-500 truncate max-w-[280px]">
                                {file}
                              </div>
                            </div>
                            <span className="text-[8px] font-black uppercase tracking-widest bg-zinc-900 border border-white/10 text-zinc-500 group-hover:border-purple-500/40 group-hover:text-purple-400 px-2 py-1 rounded transition-all">
                              Restore Version
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
          </div>

          <footer className="p-6 border-t border-white/5 flex flex-col gap-2">
            {/* O botão de Apply só deve salvar o projeto se a aba de projeto estiver ativa */}
             <button 
              onClick={() => { 
                if (activeTab === 'project') onSaveProject(projSettings); 
                onClose(); 
              }}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-[9px] font-black uppercase tracking-[0.2em] rounded transition-all shadow-lg shadow-blue-900/10"
            >
              Apply Changes
            </button>
            <button 
              onClick={onClose}
              className="w-full py-2 text-[9px] font-bold uppercase tracking-widest text-zinc-600 hover:text-zinc-200 transition-all"
            >
              Dismiss
            </button>
          </footer>
        </main>
      </motion.div>

        {/* --- SUB-MODAL DE CONFIRMAÇÃO EM REACT --- */}
      <AnimatePresence>
        {pendingRestoreFile && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#0d0d11] border border-red-500/20 w-full max-w-md rounded-lg p-6 space-y-6 shadow-2xl shadow-black"
            >
              <div className="flex items-center gap-3 text-red-400">
                <AlertTriangle size={20} className="shrink-0 animate-pulse" />
                <h3 className="text-[10px] font-black uppercase tracking-[0.2em]">
                  Confirm Version Restore
                </h3>
              </div>

              <div className="space-y-2">
                <p className="text-zinc-400 text-[10px] leading-relaxed">
                  Are you sure you want to roll back the project to this state? Any unsaved changes in your current timeline session will be permanently lost.
                </p>
                <div className="bg-black/40 border border-white/5 rounded p-2 text-[9px] font-mono text-zinc-500 truncate">
                  Target: {pendingRestoreFile}
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={executeRestore}
                  className="flex-1 py-2 bg-red-950/40 hover:bg-red-900/40 border border-red-500/30 text-red-400 text-[9px] font-black uppercase tracking-widest rounded transition-all"
                >
                  Confirm Restore
                </button>
                <button
                  onClick={() => setPendingRestoreFile(null)}
                  className="flex-1 py-2 bg-zinc-900 hover:bg-zinc-800 border border-white/5 text-zinc-400 text-[9px] font-black uppercase tracking-widest rounded transition-all"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};