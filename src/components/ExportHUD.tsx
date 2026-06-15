/*
 * Copyright (C) 2026  Gabriel Martins Nunes
 * Licensed under the GNU General Public License v3.
 */

import { motion, AnimatePresence } from 'framer-motion';
import { X, Film, Music } from 'lucide-react';

interface ExportHUDProps {
  isVisible: boolean;
  percent: number;
  kind: 'video' | 'audio' | null;
  onCancel: () => void;
  projectName?: string;
}




export function ExportHUD({ isVisible, percent, kind, onCancel, projectName }: ExportHUDProps) {
  const isAudio = kind === 'audio';
  const accentColor = isAudio ? 'fuchsia' : 'cyan';

   

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: -12, scale: 0.95 }}
          animate={{ opacity: 1, y: 0,   scale: 1    }}
          exit={{   opacity: 0, y: -12, scale: 0.95  }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="relative md:[position:unset] z-[800] w-64 bg-[#0d0d0d] border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden"
        >
          {/* Top accent line */}
          <div
            className={`h-[2px] w-full ${isAudio ? 'bg-fuchsia-500' : 'bg-cyan-500'}`}
            style={{ boxShadow: isAudio ? '0 0 12px rgba(217,70,239,0.6)' : '0 0 12px rgba(34,211,238,0.6)' }}
          />

          <div className="p-4 space-y-3">
            {/* Header row */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                {isAudio
                  ? <Music size={13} className="text-fuchsia-400 shrink-0" />
                  : <Film  size={13} className="text-cyan-400 shrink-0"    />
                }
                <div className="flex flex-col min-w-0">
                  <span className="text-[10px] font-black uppercase tracking-widest text-white">
                    {isAudio ? 'Exporting Audio' : 'Exporting Video'}
                  </span>
                  {projectName && (
                    <span className="text-[9px] text-zinc-500 font-medium truncate max-w-[120px]" title={projectName}>
                      {projectName}
                    </span>
                  )}
                </div>
              </div>
              <span className={`text-[10px] font-mono font-bold ${isAudio ? 'text-fuchsia-400' : 'text-cyan-400'}`}>
                {percent}%
              </span>
            </div>

            {/* Progress bar */}
            <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
              <motion.div
                className={`h-full rounded-full ${isAudio ? 'bg-fuchsia-500' : 'bg-cyan-500'}`}
                initial={{ width: '0%' }}
                animate={{ width: `${percent}%` }}
                transition={{ ease: 'easeOut', duration: 0.3 }}
              />
            </div>

            {/* Cancel */}
            <button
              onClick={onCancel}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-zinc-800 hover:border-red-500/40 hover:bg-red-500/10 text-zinc-500 hover:text-red-400 transition-all group"
            >
              <X size={11} />
              <span className="text-[9px] font-black uppercase tracking-widest">Cancel</span>
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}