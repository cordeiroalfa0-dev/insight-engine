import { useEffect, useState, useCallback } from "react";
import { X, FolderOpen, HardDrive, ChevronUp, RefreshCw } from "lucide-react";

interface Entry { name: string; path: string; type: "dir" | "drive" | "exe"; }

interface Props {
  open: boolean;
  mode: "dir" | "exe";
  title: string;
  initialPath?: string;
  backend: string;
  onClose: () => void;
  onSelect: (path: string) => void;
}

export function FolderBrowser({ open, mode, title, initialPath, backend, onClose, onSelect }: Props) {
  const [path, setPath] = useState<string>(initialPath || "");
  const [parent, setParent] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string>("");

  const load = useCallback(async (p: string) => {
    setLoading(true); setErr("");
    try {
      const r = await fetch(`${backend}/api/browse?path=${encodeURIComponent(p)}&mode=${mode}`);
      const data = await r.json();
      if (!r.ok) { setErr(data.error || "Erro"); setEntries([]); return; }
      setPath(data.path); setParent(data.parent); setEntries(data.entries);
    } catch (e) {
      setErr(`Backend offline? ${(e as Error).message}`);
    } finally { setLoading(false); }
  }, [backend, mode]);

  useEffect(() => {
    if (!open) return;
    // Se initialPath for arquivo .exe, usa o diretório pai
    let start = initialPath || "";
    if (mode === "exe" && /\.exe$/i.test(start)) start = start.replace(/[\\/][^\\/]+$/, "");
    load(start);
  }, [open, initialPath, mode, load]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-[90vw] max-w-2xl max-h-[80vh] flex flex-col bg-black/95 border border-neon-cyan/30 rounded-lg shadow-2xl"
        style={{ boxShadow: "0 0 40px rgba(0,255,255,0.15)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2 border-b border-white/10">
          <div className="font-display text-[9px] text-neon-cyan">// {title}</div>
          <button onClick={onClose} className="text-white/60 hover:text-white"><X size={14} /></button>
        </div>

        <div className="flex gap-1 px-3 py-2 border-b border-white/10 items-center">
          <button
            onClick={() => parent !== null ? load(parent) : load("")}
            disabled={loading}
            className="font-display text-[7px] px-2 py-1.5 border border-white/15 text-white/70 hover:bg-white/5 rounded disabled:opacity-40"
            title="Pasta acima"
          ><ChevronUp size={11} /></button>
          <button
            onClick={() => load("")}
            className="font-display text-[7px] px-2 py-1.5 border border-white/15 text-white/70 hover:bg-white/5 rounded"
            title="Drives"
          ><HardDrive size={11} /></button>
          <button
            onClick={() => load(path)}
            className="font-display text-[7px] px-2 py-1.5 border border-white/15 text-white/70 hover:bg-white/5 rounded"
            title="Recarregar"
          ><RefreshCw size={11} /></button>
          <input
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load(path)}
            placeholder="Caminho..."
            className="flex-1 px-2 py-1.5 bg-black/40 border border-white/10 text-foreground font-body text-xs rounded focus:outline-none focus:border-neon-cyan/40"
          />
        </div>

        {err && <div className="px-4 py-2 font-display text-[7px] text-red-400">{err}</div>}
        {loading && <div className="px-4 py-2 font-display text-[7px] text-neon-yellow">⏳ Carregando...</div>}

        <div className="flex-1 overflow-auto p-2">
          {entries.length === 0 && !loading && !err && (
            <div className="font-display text-[7px] text-white/40 px-2 py-4">Pasta vazia</div>
          )}
          {entries.map((e) => (
            <button
              key={e.path}
              onDoubleClick={() => (e.type === "exe" ? onSelect(e.path) : load(e.path))}
              onClick={() => (e.type === "exe" ? onSelect(e.path) : load(e.path))}
              className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-neon-cyan/10 rounded text-left"
            >
              {e.type === "drive" ? <HardDrive size={12} className="text-neon-magenta" />
                : e.type === "exe" ? <span className="text-neon-yellow font-display text-[8px]">EXE</span>
                : <FolderOpen size={12} className="text-neon-cyan" />}
              <span className="font-body text-xs text-foreground/90 truncate">{e.name}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-white/10">
          <div className="font-body text-[10px] text-white/50 truncate flex-1">{path || "—"}</div>
          {mode === "dir" && (
            <button
              onClick={() => path && onSelect(path)}
              disabled={!path}
              className="font-display text-[8px] border border-neon-green/40 text-neon-green px-4 py-2 rounded bg-neon-green/5 hover:bg-neon-green/15 transition disabled:opacity-40"
            >✓ SELECIONAR ESTA PASTA</button>
          )}
          <button
            onClick={onClose}
            className="font-display text-[8px] border border-white/15 text-white/70 px-3 py-2 rounded hover:bg-white/5"
          >CANCELAR</button>
        </div>
      </div>
    </div>
  );
}
