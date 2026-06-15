/*
 * Copyright (C) 2026  Gabriel Martins Nunes
 * Licensed under the GNU General Public License v3.
 */

import { motion, AnimatePresence } from 'framer-motion';
import { X, Film, Music, ChevronRight } from 'lucide-react';

export type ExportFormat =
  | { kind: 'video'; codec: 'mp4' | 'mpeg4' }
  | { kind: 'audio'; codec: 'mp3' | 'wav' };

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (format: ExportFormat) => void;
}

const VIDEO_OPTIONS: { label: string; ext: 'mp4' | 'mpeg4'; desc: string }[] = [
  { label: 'MP4 / H.264', ext: 'mp4',   desc: 'Universal — best compatibility' },
  { label: 'MPEG-4',      ext: 'mpeg4', desc: 'Legacy container, broad support' },
];

const AUDIO_OPTIONS: { label: string; ext: 'mp3' | 'wav'; desc: string }[] = [
  { label: 'MP3',  ext: 'mp3', desc: 'Compressed — smaller file size' },
  { label: 'WAV',  ext: 'wav', desc: 'Lossless — studio quality' },
];

export function ExportModal({ isOpen, onClose, onConfirm }: ExportModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[700] flex items-center justify-center bg-black/80 backdrop-blur-md">
          <motion.div
            initial={{ scale: 0.92, opacity: 0, y: 12 }}
            animate={{ scale: 1,    opacity: 1, y: 0  }}
            exit={{   scale: 0.92, opacity: 0, y: 12  }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="bg-[#111] border border-zinc-800 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
              <h2 className="text-xs font-black uppercase tracking-widest text-white">
                Export As
              </h2>
              <button
                onClick={onClose}
                className="p-1 rounded-full hover:bg-zinc-800 text-zinc-500 hover:text-white transition-colors"
              >
                <X size={14} />
              </button>
            </div>

            <div className="p-5 space-y-5">
              {/* VIDEO SECTION */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Film size={13} className="text-cyan-400" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
                    Video
                  </span>
                </div>
                <div className="space-y-2">
                  {VIDEO_OPTIONS.map(({ label, ext, desc }) => (
                    <button
                      key={ext}
                      onClick={() => onConfirm({ kind: 'video', codec: ext })}
                      className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-zinc-900 hover:bg-cyan-500/10 border border-zinc-800 hover:border-cyan-500/40 transition-all group"
                    >
                      <div className="text-left">
                        <p className="text-xs font-black text-white group-hover:text-cyan-300 transition-colors">
                          {label}
                        </p>
                        <p className="text-[9px] text-zinc-500 mt-0.5">{desc}</p>
                      </div>
                      <ChevronRight size={13} className="text-zinc-600 group-hover:text-cyan-400 transition-colors" />
                    </button>
                  ))}
                </div>
              </div>

              {/* AUDIO SECTION */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Music size={13} className="text-fuchsia-400" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
                    Audio Only
                  </span>
                </div>
                <div className="space-y-2">
                  {AUDIO_OPTIONS.map(({ label, ext, desc }) => (
                    <button
                      key={ext}
                      onClick={() => onConfirm({ kind: 'audio', codec: ext })}
                      className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-zinc-900 hover:bg-fuchsia-500/10 border border-zinc-800 hover:border-fuchsia-500/40 transition-all group"
                    >
                      <div className="text-left">
                        <p className="text-xs font-black text-white group-hover:text-fuchsia-300 transition-colors">
                          {label}
                        </p>
                        <p className="text-[9px] text-zinc-500 mt-0.5">{desc}</p>
                      </div>
                      <ChevronRight size={13} className="text-zinc-600 group-hover:text-fuchsia-400 transition-colors" />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
