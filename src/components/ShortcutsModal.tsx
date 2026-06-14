/*
 * Copyright (C) 2026  Gabriel Martins Nunes
 * GNU General Public License v3 — see <https://www.gnu.org/licenses/>
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, RotateCcw, Check, Keyboard } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ShortcutEntry {
  id: string;
  label: string;
  keys: string[]; // e.g. ['Alt', 'S']  or  ['Ctrl', 'Z']
  category: 'timeline' | 'player' | 'edit' | 'other';
}

// ─── Default shortcuts (mirror of what exists in App.tsx) ─────────────────────

export const DEFAULT_SHORTCUTS: ShortcutEntry[] = [
  // Timeline
  { id: 'split',          label: 'Split',                    keys: ['Alt', 'S'],      category: 'timeline' },
  { id: 'select_left',    label: 'Select leftward (split)',  keys: ['Ctrl', 'Q'],     category: 'timeline' },
  { id: 'select_right',   label: 'Select rightward (split)', keys: ['Ctrl', 'W'],     category: 'timeline' },
  { id: 'snap_toggle',    label: 'Toggle Magnetic Snap',     keys: ['Ctrl', 'T'],     category: 'timeline' },
  { id: 'zoom_in',        label: 'Zoom in',                  keys: ['Ctrl', '='],     category: 'timeline' },
  { id: 'zoom_out',       label: 'Zoom out',                 keys: ['Ctrl', '-'],     category: 'timeline' },
  { id: 'next_cut',       label: 'Next cut point',           keys: ['Ctrl', '.'],     category: 'timeline' },
  { id: 'prev_cut',       label: 'Last cut point',           keys: ['Ctrl', ','],     category: 'timeline' },
  { id: 'frame_forward',  label: 'Step forward 0.01s',       keys: ['Alt', '.'],      category: 'timeline' },
  { id: 'frame_back',     label: 'Step back 0.01s',          keys: ['Alt', ','],      category: 'timeline' },
  // Edit
  { id: 'delete',         label: 'Delete selection',         keys: ['Delete'],        category: 'edit' },
  { id: 'undo',           label: 'Undo',                     keys: ['Ctrl', 'Z'],     category: 'edit' },
  { id: 'redo',           label: 'Redo',                     keys: ['Ctrl', 'Y'],     category: 'edit' },
  { id: 'copy',           label: 'Copy',                     keys: ['Ctrl', 'C'],     category: 'edit' },
  { id: 'paste',          label: 'Paste',                    keys: ['Ctrl', 'V'],     category: 'edit' },
  { id: 'export',         label: 'Export video',             keys: ['Ctrl', 'Enter'], category: 'edit' },
  // Player
  { id: 'play_pause',     label: 'Play / Pause',             keys: ['Space'],         category: 'player' },
  { id: 'in_point',       label: 'Set In Point',             keys: ['I'],             category: 'player' },
  { id: 'out_point',      label: 'Set Out Point',            keys: ['O'],             category: 'player' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<ShortcutEntry['category'], string> = {
  timeline: 'Timeline',
  edit:     'Edit',
  player:   'Player',
  other:    'Other',
};

const CATEGORY_ORDER: ShortcutEntry['category'][] = ['timeline', 'edit', 'player', 'other'];

const KeyBadge = ({ k }: { k: string }) => (
  <span className="inline-flex items-center justify-center min-w-[28px] h-[22px] px-1.5 rounded bg-zinc-800 border border-zinc-700 text-[10px] font-black font-mono text-zinc-300 uppercase tracking-widest">
    {k}
  </span>
);

const eventToKeys = (e: KeyboardEvent): string[] => {
  const mods: string[] = [];
  if (e.ctrlKey || e.metaKey) mods.push('Ctrl');
  if (e.altKey)   mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');

  const key = e.key;
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return mods;

  const keyLabel =
    key === ' '           ? 'Space'     :
    key === 'ArrowUp'     ? '↑'         :
    key === 'ArrowDown'   ? '↓'         :
    key === 'ArrowLeft'   ? '←'         :
    key === 'ArrowRight'  ? '→'         :
    key === 'Enter'       ? 'Enter'     :
    key === 'Backspace'   ? 'Backspace' :
    key === 'Delete'      ? 'Delete'    :
    key === 'Escape'      ? 'Escape'    :
    key.length === 1      ? key.toUpperCase() : key;

  return [...mods, keyLabel];
};

// ─── File I/O ─────────────────────────────────────────────────────────────────

const FILENAME          = 'shortcuts.json';
const FILENAME_ORIGINAL = 'shortcuts_original.json';

async function loadShortcuts(settingsFolder: string): Promise<ShortcutEntry[]> {
  try {
    const raw = await invoke<string>('read_settings_file', {
      path: `${settingsFolder}/${FILENAME}`,
    });
    return JSON.parse(raw) as ShortcutEntry[];
  } catch {
    return DEFAULT_SHORTCUTS;
  }
}

async function saveShortcuts(settingsFolder: string, entries: ShortcutEntry[]) {
  await invoke('save_settings_file', {
    path: `${settingsFolder}/${FILENAME}`,
    content: JSON.stringify(entries, null, 2),
  });
}

async function ensureOriginalExists(settingsFolder: string) {
  try {
    await invoke<string>('read_settings_file', {
      path: `${settingsFolder}/${FILENAME_ORIGINAL}`,
    });
  } catch {
    await invoke('save_settings_file', {
      path: `${settingsFolder}/${FILENAME_ORIGINAL}`,
      content: JSON.stringify(DEFAULT_SHORTCUTS, null, 2),
    });
  }
}

// ─── Modal Component ──────────────────────────────────────────────────────────

interface Props {
  isOpen: boolean;
  onClose: () => void;
  settingsFolder: string | null;
  onShortcutsChange: (shortcuts: ShortcutEntry[]) => void;
}

export function ShortcutsModal({ isOpen, onClose, settingsFolder, onShortcutsChange }: Props) {
  const [activeCategory, setActiveCategory] = useState<ShortcutEntry['category']>('timeline');
  const [entries, setEntries]               = useState<ShortcutEntry[]>(DEFAULT_SHORTCUTS);
  const [editingId, setEditingId]           = useState<string | null>(null);
  const [pendingKeys, setPendingKeys]       = useState<string[]>([]);
  const [dirty, setDirty]                   = useState(false);
  const [saving, setSaving]                 = useState(false);

  useEffect(() => {
    if (!isOpen || !settingsFolder) return;
    (async () => {
      await ensureOriginalExists(settingsFolder);
      const loaded = await loadShortcuts(settingsFolder);
      setEntries(loaded);
      setDirty(false);
    })();
  }, [isOpen, settingsFolder]);

  useEffect(() => {
    if (!editingId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const keys = eventToKeys(e);
      if (keys.length > 0) setPendingKeys(keys);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [editingId]);

  const startEdit  = (id: string, current: string[]) => { setEditingId(id); setPendingKeys(current); };
  const cancelEdit = () => { setEditingId(null); setPendingKeys([]); };

  const confirmEdit = () => {
    if (!editingId || pendingKeys.length === 0) { cancelEdit(); return; }
    setEntries(prev => prev.map(e => e.id === editingId ? { ...e, keys: pendingKeys } : e));
    setDirty(true);
    setEditingId(null);
    setPendingKeys([]);
  };

  const handleSave = async () => {
    if (!settingsFolder) return;
    setSaving(true);
    await saveShortcuts(settingsFolder, entries);
    onShortcutsChange(entries);
    setDirty(false);
    setSaving(false);
  };

  const handleReset = async () => {
    if (!settingsFolder) return;
    setEntries(DEFAULT_SHORTCUTS);
    await saveShortcuts(settingsFolder, DEFAULT_SHORTCUTS);
    onShortcutsChange(DEFAULT_SHORTCUTS);
    setDirty(false);
  };

  const visible = entries.filter(e => e.category === activeCategory);

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-[500] flex items-center justify-center bg-black/80 backdrop-blur-md"
          onClick={e => { if (e.target === e.currentTarget) { cancelEdit(); onClose(); } }}
        >
          <motion.div
            initial={{ scale: 0.94, opacity: 0, y: 10 }}
            animate={{ scale: 1,    opacity: 1, y: 0  }}
            exit={{   scale: 0.94, opacity: 0, y: 10  }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="relative bg-[#111111] border border-zinc-800 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/60">
              <div className="flex items-center gap-3">
                <Keyboard size={16} className="text-cyan-500" />
                <h2 className="text-sm font-black text-white uppercase tracking-widest">Shortcuts</h2>
              </div>
              <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-white transition-colors">
                <X size={16} />
              </button>
            </div>

            {/* Category tabs */}
            <div className="flex gap-1 px-6 pt-4 pb-2">
              {CATEGORY_ORDER.map(cat => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${
                    activeCategory === cat
                      ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
                      : 'text-zinc-500 hover:text-zinc-300 border border-transparent'
                  }`}
                >
                  {CATEGORY_LABELS[cat]}
                </button>
              ))}
            </div>

            {/* List */}
            <div className="px-6 py-2 space-y-0.5 max-h-[400px] overflow-y-auto">
              {visible.length === 0 && (
                <p className="text-center text-zinc-600 text-xs py-10">No shortcuts in this category.</p>
              )}
              {visible.map(entry => {
                const isEditing = editingId === entry.id;
                return (
                  <div
                    key={entry.id}
                    className={`flex items-center justify-between px-4 py-3 rounded-xl transition-all ${
                      isEditing
                        ? 'bg-cyan-500/10 border border-cyan-500/30'
                        : 'hover:bg-zinc-900/60 border border-transparent'
                    }`}
                  >
                    <span className={`text-xs font-bold ${isEditing ? 'text-cyan-300' : 'text-zinc-300'}`}>
                      {entry.label}
                    </span>

                    <div className="flex items-center gap-2">
                      {isEditing ? (
                        <>
                          <div className="flex items-center gap-1 min-w-[130px] justify-end">
                            {pendingKeys.length > 0
                              ? pendingKeys.map((k, i) => <KeyBadge key={i} k={k} />)
                              : <span className="text-[10px] text-zinc-500 italic">press a key…</span>
                            }
                          </div>
                          <button onClick={confirmEdit} className="p-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white transition-colors" title="Confirm">
                            <Check size={12} />
                          </button>
                          <button onClick={cancelEdit} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-white transition-colors" title="Cancel">
                            <X size={12} />
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => startEdit(entry.id, entry.keys)}
                          className="flex items-center gap-1 hover:opacity-70 transition-opacity"
                          title="Click to remap"
                        >
                          {entry.keys.map((k, i) => <KeyBadge key={i} k={k} />)}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-800/60">
              <button
                onClick={handleReset}
                className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-red-400 transition-colors"
              >
                <RotateCcw size={12} /> Reset to defaults
              </button>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => { cancelEdit(); onClose(); }}
                  className="px-5 py-2 text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={!dirty || saving}
                  className={`px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                    dirty && !saving
                      ? 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg shadow-cyan-900/30'
                      : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                  }`}
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
