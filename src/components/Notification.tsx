import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { X, ExternalLink, BellOff, Zap, ChevronLeft, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';
import { getVersion } from '@tauri-apps/api/app';
import { useTranslation } from 'react-i18next';

// Interface para que o App.tsx possa controlar o modal
export interface NotificationsRef {
  toggle: () => void;
}

// Interface para as propriedades (Props) do componente
interface NotificationsProps {
  onNewNotifications?: (hasMsgs: boolean) => void;
}

// ─── SPOTLIGHT: shown once per day for update/urgent notifications ───────────
const SPOTLIGHT_KEY = 'wannacut_spotlight_date';

// ─── VERSION FILTER: for_version = { min?: "x.x.x", max?: "x.x.x" } ──────────
// Sem min -> aceita qualquer versão para baixo (até o max).
// Sem max -> aceita qualquer versão para cima (a partir do min).
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((v) => parseInt(v, 10) || 0);
  const pb = b.split('.').map((v) => parseInt(v, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

function isVersionCompatible(currentVersion: string, for_version?: { min?: string; max?: string }): boolean {
  if (!for_version){
    console.log('there is no version')
    return true;}
  const { min, max } = for_version;
  if(for_version)
    console.log(for_version)
  if (max)
    console.log("comparando", max, compareVersions(currentVersion, max));
  if (min && compareVersions(currentVersion, min) < 0) return false;
  if (max && compareVersions(currentVersion, max) > 0) return false;
  return true;
}

// ─── PLAN FILTER: for_plan = ["free" | "pro" | "ultimate", ...] ─────────────
function isPlanCompatible(currentPlan: string, for_plan?: string[]): boolean {
  if (!for_plan || for_plan.length === 0) return true;
  return for_plan.includes(currentPlan);
}

// ─── TRANSLATION: traduz on-the-fly para o idioma salvo em "lang" ───────────
// As notificações chegam sempre em inglês (source = "en") e são traduzidas
// no cliente. Resultados ficam em cache em memória para evitar chamadas repetidas.
const translationCache: Record<string, string> = {};

async function translateText(text: string, targetLang: string): Promise<string> {
  if (!text) return text;
  const normalizedLang = targetLang.split('-')[0].toLowerCase();
  if (!normalizedLang || normalizedLang === 'en') return text;

  const cacheKey = `${normalizedLang}::${text}`;
  if (translationCache[cacheKey]) return translationCache[cacheKey];

  try {
    const res = await fetch(
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${normalizedLang}&dt=t&q=${encodeURIComponent(text)}`
    );
    const data = await res.json();
    const translated = (data?.[0] ?? [])
      .map((chunk: any) => chunk?.[0] ?? '')
      .join('');
    if (!translated) return text;
    translationCache[cacheKey] = translated;
    return translated;
  } catch (err) {
    console.error('WannaCut Translation Error:', err);
    return text; // fallback: mantém o texto original em caso de falha
  }
}

async function translateNotification(n: any, targetLang: string) {
  const [title, description, link_text] = await Promise.all([
    translateText(n.title, targetLang),
    translateText(n.description, targetLang),
    n.link_text ? translateText(n.link_text, targetLang) : Promise.resolve(n.link_text),
  ]);
  return { ...n, title, description, link_text };
}

const NotificationSpotlight = ({ notifications, onClose }: { notifications: any[]; onClose: () => void }) => {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const n = notifications[index];
  const total = notifications.length;


  return (
    <>
      {/* Full-screen backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[10000] bg-black/80 backdrop-blur-xl"
        onClick={onClose}
      />

      {/* Card centered */}
      <motion.div
        key={index}
        initial={{ opacity: 0, scale: 0.88, y: 24 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.92, y: -16 }}
        transition={{ type: 'spring', stiffness: 280, damping: 24 }}
        className="fixed inset-0 z-[10001] flex items-center justify-center pointer-events-none"
      >
        <div
          className="pointer-events-auto relative w-[520px] max-w-[90vw] bg-zinc-950 border border-white/10 rounded-3xl shadow-[0_40px_80px_rgba(0,0,0,0.7)] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Glow accent */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-1 bg-gradient-to-r from-transparent via-cyan-500 to-transparent opacity-80 rounded-full" />

          {/* Close */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-white/10 text-zinc-500 hover:text-white transition-colors z-10"
          >
            <X size={16} />
          </button>

          {/* Badge */}
          <div className="absolute top-4 left-4 flex items-center gap-1.5 bg-cyan-500/10 border border-cyan-500/20 rounded-full px-2.5 py-1">
            <Zap size={10} className="text-cyan-400" />
            <span className="text-[9px] font-black uppercase tracking-[0.2em] text-cyan-400">
              {n.type_ === 'update' ? t('notifications.update') : t('notifications.urgent')}
            </span>
          </div>

          {/* Image */}
          {n.image && (
            <div className="relative h-52 overflow-hidden">
              <img
                src={n.image}
                alt=""
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/40 to-transparent" />
            </div>
          )}

          {/* Body */}
          <div className={`px-8 pb-8 ${n.image ? 'pt-4' : 'pt-14'}`}>
            <h2 className="text-2xl font-black text-white mb-3 leading-tight">
              {n.title}
            </h2>
            <p className="text-zinc-400 text-sm leading-relaxed">
              {n.description}
            </p>

            {n.link && (
              <button
                onClick={async (e) => {
                  e.stopPropagation(); // Garante que não fecha o modal
                  try {
                    await open(n.link); // Força o sistema operacional a abrir o navegador
                  } catch (err) {
                    console.error("Failed to open link:", err);
                  }
                }}
                className="inline-flex items-center gap-2 mt-6 px-5 py-2.5 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 hover:border-cyan-500/60 rounded-xl text-[11px] font-black uppercase tracking-widest text-cyan-400 hover:text-cyan-300 transition-all cursor-pointer"
              >
                {n.link_text || t('notifications.viewDetails')} <ExternalLink size={11} />
              </button>
            )}
          </div>

          {/* Navigation footer */}
          {total > 1 && (
            <div className="flex items-center justify-between px-8 pb-6">
              {/* Dots */}
              <div className="flex gap-1.5">
                {notifications.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setIndex(i)}
                    className={`h-1.5 rounded-full transition-all ${
                      i === index ? 'w-5 bg-cyan-400' : 'w-1.5 bg-white/20 hover:bg-white/40'
                    }`}
                  />
                ))}
              </div>

              {/* Prev / Next */}
              <div className="flex gap-2">
                <button
                  disabled={index === 0}
                  onClick={() => setIndex(i => i - 1)}
                  className="p-1.5 rounded-lg border border-white/10 hover:bg-white/10 text-zinc-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  disabled={index === total - 1}
                  onClick={() => setIndex(i => i + 1)}
                  className="p-1.5 rounded-lg border border-white/10 hover:bg-white/10 text-zinc-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </>
  );
};
// ─────────────────────────────────────────────────────────────────────────────

const Notifications = forwardRef<NotificationsRef, NotificationsProps>(({ onNewNotifications }, ref) => {
  const { t } = useTranslation();
  const [notifications, setNotifications] = useState<any[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [spotlightNotifs, setSpotlightNotifs] = useState<any[]>([]);
  const [showSpotlight, setShowSpotlight] = useState(false);
  const [tryNot, setTryNot] = useState(0);
  const [plan, setPlan] = useState<'free' | 'pro' | 'ultimate'>('free');

  // Refs para acessar o valor mais recente de plano/versão dentro do
  // useEffect de notificações sem precisar recriar seu timer (dependências).
  const planRef = useRef<'free' | 'pro' | 'ultimate'>('free');
  const versionRef = useRef<string>('0.0.0');

  // Expõe o método toggle para ser chamado via Ref pelo App.tsx
  useImperativeHandle(ref, () => ({
    toggle: () => {
      setIsOpen(!isOpen);
    }
  }));

  // ─── Carrega versão do app e plano da licença (uma vez, ao montar) ───────
  useEffect(() => {
    const settingsFolder = localStorage.getItem("wannacut_settings_folder");

    getVersion()
      .then((v) => {
        versionRef.current = v;
        console.log('bebe version: ',versionRef.current);
      })
      .catch((err) => console.error("Failed to get app version:", err));

    const validate_offline = async () => {
      try {
        const result: any = await invoke("get_license_state", { settingsFolder });
        if (result && result.plan) {
          planRef.current = result.plan;
          setPlan(result.plan);
        }
      } catch (err) {
        console.error("Erro na validação de licença offline (Usuário Free):", err);
        planRef.current = 'free';
        setPlan('free');
      }
    };

    validate_offline();
  }, []);



  useEffect(() => {
    const settingsFolder = localStorage.getItem("wannacut_settings_folder");
    
    if (settingsFolder && tryNot < 5) {
        // Aguarda 60 segundos (60000ms) antes de iniciar a execução
        setTimeout(() => {

          // Chama o comando Rust enviando o caminho da pasta de settings
          invoke('check_notifications', { settingsPath: settingsFolder })
            .then(async (msgs: any) => {
              // --- FILTRO por versão (for_version) e por plano (for_plan) ---
              const compatible = (msgs as any[]).filter((n) =>
                isVersionCompatible(versionRef.current, n.for_version) &&
                isPlanCompatible(planRef.current, n.for_plan)
              );

              // --- TRADUÇÃO para o idioma salvo em localStorage("lang") ---
              const lang = localStorage.getItem('lang') || 'en';
              const translated = await Promise.all(
                compatible.map((n) => translateNotification(n, lang))
              );

              setNotifications(translated);
              // Se houver mensagens, avisamos o componente pai para mostrar o alerta (badge)
              if (translated.length > 0 && onNewNotifications) {
                onNewNotifications(true);
              }
              // --- SPOTLIGHT: show once per day for update/urgent ---
              const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
              const lastSeen = localStorage.getItem(SPOTLIGHT_KEY);
              
              if (lastSeen !== today) {
                const highlighted = translated.filter((n: any) => n.type_ === 'update' || n.type_ === 'urgent');
                if (highlighted.length > 0) {
                  setSpotlightNotifs(highlighted);
                  setShowSpotlight(true);
                  localStorage.setItem(SPOTLIGHT_KEY, today);
                }
              }
            })
            .catch(err => {
              // Emite o erro no console
              console.error("WannaCut Notification Error:", err);
              // Como o fluxo caiu no .catch(), a execução do bloco .then() é interrompida automaticamente.
              // Se você precisar lançar um erro explícito para interromper níveis superiores:
              // throw new Error(`Notification check failed: ${err}`);
            });
        }, 60000 * tryNot); // 60 segundos de delay

        setTryNot(prev => prev +1)
      }


  }, [onNewNotifications]);

  return (
    <>
      <AnimatePresence>
        {showSpotlight && spotlightNotifs.length > 0 && (
          <NotificationSpotlight
            notifications={spotlightNotifs}
            onClose={() => setShowSpotlight(false)}
          />
        )}
      </AnimatePresence>

    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop (Blur no fundo estilo Backrooms/Cyberpunk) */}
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }}
            onClick={() => setIsOpen(false)}
            className="fixed inset-0 bg-black/60 backdrop-blur-md z-[9998]"
          />

          {/* Modal Container */}
          <motion.div 
            initial={{ opacity: 0, scale: 0.9, x: 50 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.9, x: 50 }}
            className="fixed top-16 right-6 w-[400px] bg-zinc-950 border border-white/10 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] z-[9999] overflow-hidden"
          >
            {/* Header com estilo industrial */}
            <div className="p-4 border-b border-white/5 flex justify-between items-center bg-zinc-900/50">
              <div className="flex items-center gap-3">
                <div className="bg-cyan-500/10 p-1.5 rounded">
                    <Zap size={14} className="text-cyan-400" />
                </div>
                <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
                    {t('notifications.systemFeed')}
                </h2>
              </div>
              <button 
                onClick={() => setIsOpen(false)} 
                className="p-1 hover:bg-white/10 rounded-md text-zinc-500 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Lista de Notificações */}
            <div className="max-h-[60vh] overflow-y-auto p-4 space-y-4 custom-scrollbar bg-gradient-to-b from-zinc-950 to-zinc-900/20">
              {notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 opacity-20">
                  <BellOff size={40} strokeWidth={1} />
                  <p className="text-[10px] mt-4 uppercase tracking-[0.3em] font-mono">{t('notifications.noSignals')}</p>
                </div>
              ) : (
                notifications.map((n: any) => (
                    <motion.div 
                        key={n.id} 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        // Adicionei 'relative' aqui para que o ping absoluto se oriente por este card
                        className="relative group bg-white/[0.02] border border-white/5 p-4 rounded-xl hover:border-cyan-500/30 transition-all hover:bg-white/[0.04]"
                    >
                        {/* PING PARA UPDATES - Posicionado no canto superior direito */}
                        {(n.type_ === 'update' || n.type === 'urgent') && (
                        <div className="absolute top-3 right-3 flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
                        </div>
                        )}

                        {n.image && (
                        <div className="relative overflow-hidden rounded-lg mb-3 h-32">
                            <img 
                                src={n.image} 
                                alt="" 
                                className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-700 scale-105 group-hover:scale-100" 
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/80 to-transparent" />
                        </div>
                        )}
                        
                        <h3 className="text-cyan-400 font-bold text-sm mb-1 group-hover:text-cyan-300 transition-colors pr-4">
                            {n.title}
                        </h3>
                        
                        <p className="text-zinc-400 text-[11px] leading-relaxed font-medium">
                        {n.description}
                        </p>
                        
                        {n.link && (
                        <a 
                            href={n.link} 
                            target="_blank" 
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 mt-4 text-[9px] text-zinc-500 hover:text-white uppercase font-black tracking-widest transition-all hover:gap-3"
                        >
                            {n.link_text ? n.link_text : t('notifications.access')} <ExternalLink size={10} />
                        </a>
                        )}
                    </motion.div>
                    ))
                                )}
            </div>

            {/* Footer / Identificador do App */}
            <div className="p-3 bg-black/40 border-t border-white/5 flex items-center justify-between px-6">
              <span className="text-[7px] text-zinc-600 uppercase tracking-[0.5em] font-mono">
                Wannacut // v.0.2 Beta
              </span>
              
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
    </>
  );
});

export default Notifications;