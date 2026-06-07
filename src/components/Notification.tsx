import { useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { X, ExternalLink, BellOff, Zap, ChevronLeft, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';

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

const NotificationSpotlight = ({ notifications, onClose }: { notifications: any[]; onClose: () => void }) => {
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
              {n.type_ === 'update' ? 'Update' : 'Urgent'}
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
              <a
                href={n.link}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 mt-6 px-5 py-2.5 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 hover:border-cyan-500/60 rounded-xl text-[11px] font-black uppercase tracking-widest text-cyan-400 hover:text-cyan-300 transition-all"
              >
                {n.link_text || 'View Details'} <ExternalLink size={11} />
              </a>
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
  const [notifications, setNotifications] = useState<any[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [spotlightNotifs, setSpotlightNotifs] = useState<any[]>([]);
  const [showSpotlight, setShowSpotlight] = useState(false);

  // Expõe o método toggle para ser chamado via Ref pelo App.tsx
  useImperativeHandle(ref, () => ({
    toggle: () => {
      setIsOpen(!isOpen);
    }
  }));

  useEffect(() => {
    const settingsFolder = localStorage.getItem("wannacut_settings_folder");
    
    if (settingsFolder) {
      // Chama o comando Rust enviando o caminho da pasta de settings
      invoke('check_notifications', { settingsPath: settingsFolder })
        .then((msgs: any) => {
          setNotifications(msgs);
          // Se houver mensagens, avisamos o componente pai para mostrar o alerta (badge)
          if (msgs.length > 0 && onNewNotifications) {
            onNewNotifications(true);
          }
          // --- SPOTLIGHT: show once per day for update/urgent ---
          const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
          const lastSeen = localStorage.getItem(SPOTLIGHT_KEY);
          if (lastSeen !== today) {
            const highlighted = msgs.filter((n: any) => n.type_ === 'update' || n.type === 'urgent');
            if (highlighted.length > 0) {
              setSpotlightNotifs(highlighted);
              setShowSpotlight(true);
              localStorage.setItem(SPOTLIGHT_KEY, today);
            }
          }
        })
        .catch(err => console.error("WannaCut Notification Error:", err));
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
                    System Feed
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
                  <p className="text-[10px] mt-4 uppercase tracking-[0.3em] font-mono">No incoming signals</p>
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
                            {n.link_text ? n.link_text : 'Access'} <ExternalLink size={10} />
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