import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { Star, FolderOpen, Settings2, AlertTriangle, CheckCircle, Maximize2, Minimize2, X } from "lucide-react";
import Fuse from "fuse.js";
import { useSpring, animated as animatedRaw } from "@react-spring/web";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const animated: any = animatedRaw;

import { LazyLoadImage } from "react-lazy-load-image-component";
import "react-lazy-load-image-component/src/effects/opacity.css";
import { Howl } from "howler";
import localforage from "localforage";
import { useDebounce } from "use-debounce";
import { useVirtualizer } from "@tanstack/react-virtual";
import { FolderBrowser } from "@/components/FolderBrowser";

// ─── Howler sons arcade (import ES, sem CDN) ──────────────────────────────────
let soundsReady = false;
let sndMove: Howl, sndSelect: Howl, sndFav: Howl, sndLaunch: Howl, sndError: Howl;

function loadSounds() {
  if (soundsReady) return;
  soundsReady = true;
  const beep = (freq: number, dur: number, vol = 0.18) => ({
    src: [`data:audio/wav;base64,${generateBeep(freq, dur)}`], volume: vol,
  });
  sndMove   = new Howl({ ...beep(440, 0.04, 0.10) });
  sndSelect = new Howl({ ...beep(880, 0.12, 0.22) });
  sndFav    = new Howl({ ...beep(1320, 0.18, 0.20) });
  sndLaunch = new Howl({ ...beep(660, 0.35, 0.28) });
  sndError  = new Howl({ ...beep(220, 0.25, 0.18) });
}

function generateBeep(freq: number, duration: number): string {
  const sampleRate = 8000;
  const samples = Math.floor(sampleRate * duration);
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const writeStr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  writeStr(0, "RIFF"); view.setUint32(4, 36 + samples * 2, true);
  writeStr(8, "WAVE"); writeStr(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  writeStr(36, "data"); view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    const decay = Math.exp(-t * 8);
    const val = Math.sin(2 * Math.PI * freq * t) * decay * 0x7fff;
    view.setInt16(44 + i * 2, val, true);
  }
  const bytes = new Uint8Array(buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function playSound(snd: Howl | undefined) { try { snd?.play(); } catch { /* noop */ } }

// ─── Paletas ──────────────────────────────────────────────────────────────────
const PALETTES = [
  { bg: "from-cyan-950 to-black",    glow: "#00e5ff" },
  { bg: "from-purple-950 to-black",  glow: "#e040fb" },
  { bg: "from-yellow-950 to-black",  glow: "#ffe033" },
  { bg: "from-pink-950 to-black",    glow: "#ff4fa3" },
  { bg: "from-orange-950 to-black",  glow: "#ff8c00" },
  { bg: "from-blue-950 to-black",    glow: "#3b82f6" },
  { bg: "from-red-950 to-black",     glow: "#ff3860" },
];

// ─── Cache de artes via localforage (IndexedDB) ───────────────────────────────
const artCache = localforage.createInstance({ name: "mga-art-cache", storeName: "snaps" });
const memCache = new Map<string, string>(); // rom → objectURL

async function getCachedArt(rom: string, url: string): Promise<string | null> {
  if (memCache.has(rom)) return memCache.get(rom)!;
  try {
    const blob = await artCache.getItem<Blob>(rom);
    if (blob) {
      const obj = URL.createObjectURL(blob);
      memCache.set(rom, obj);
      return obj;
    }
  } catch { /* noop */ }
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const blob = await r.blob();
    if (blob.size < 200) return null; // archive.org devolve 404 html pequeno
    await artCache.setItem(rom, blob);
    const obj = URL.createObjectURL(blob);
    memCache.set(rom, obj);
    return obj;
  } catch { return null; }
}

// ─── RomArtCard com cache local + fallback CSS ────────────────────────────────
function RomArtCard({ rom, isFavorite, compact = false, title }: { rom: string; isFavorite: boolean; compact?: boolean; title?: string }) {
  const clean = rom.replace(/\.(zip|7z|chd)$/i, "");
  const label = (title || clean).toUpperCase();
  const initials = label.replace(/[^A-Z0-9]/g, "").slice(0, 3) || clean.slice(0, 3).toUpperCase();
  const palette = PALETTES[clean.charCodeAt(0) % PALETTES.length];
  const [imgStatus, setImgStatus] = useState<"loading" | "ok" | "error">("loading");
  const [imgUrl, setImgUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setImgStatus("loading");
    setImgUrl(null);
    const sources = [
      // Pede ao backend (snap local do MAME → cache → download automático)
      `http://localhost:7777/api/image?kind=snap&auto=1&rom=${encodeURIComponent(clean)}`,
      `http://localhost:7777/api/image?kind=title&auto=1&rom=${encodeURIComponent(clean)}`,
      `https://thumbnails.libretro.com/MAME/Named_Snaps/${encodeURIComponent(clean)}.png`,
      `https://thumbnails.libretro.com/MAME/Named_Titles/${encodeURIComponent(clean)}.png`,
      `https://archive.org/download/mame-merged/snap/${encodeURIComponent(clean)}.png`,
    ];
    (async () => {
      for (const url of sources) {
        const u = await getCachedArt(rom + ":" + url, url);
        if (cancelled) return;
        if (u) { setImgUrl(u); setImgStatus("ok"); return; }
      }
      if (!cancelled) setImgStatus("error");
    })();
    return () => { cancelled = true; };
  }, [rom, clean]);

  const dots = useMemo(() => Array.from({ length: 20 }, (_, i) => ({
    x: ((clean.charCodeAt(i % clean.length) * 37 + i * 53) % 90) + 5,
    y: ((clean.charCodeAt(i % clean.length) * 71 + i * 29) % 80) + 10,
    size: (i % 3) + 1,
    opacity: 0.08 + (i % 5) * 0.04,
  })), [clean]);

  return (
    <div className="w-full h-full relative overflow-hidden">
      {imgUrl && (
        <LazyLoadImage
          src={imgUrl}
          alt={clean}
          effect="opacity"
          threshold={200}
          wrapperClassName="absolute inset-0 w-full h-full"
          className="w-full h-full object-cover"
        />
      )}
      {imgStatus !== "ok" && (
        <div className={`w-full h-full bg-gradient-to-br ${palette.bg} absolute inset-0 flex flex-col items-center justify-center`}>
          <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
            {dots.map((d, i) => (
              <rect key={i} x={`${d.x}%`} y={`${d.y}%`} width={d.size * 3} height={d.size * 3} fill={palette.glow} opacity={d.opacity} />
            ))}
            <line x1="0" y1="33%" x2="100%" y2="33%" stroke={palette.glow} strokeWidth="0.5" opacity="0.07" />
            <line x1="0" y1="66%" x2="100%" y2="66%" stroke={palette.glow} strokeWidth="0.5" opacity="0.07" />
            <line x1="33%" y1="0" x2="33%" y2="100%" stroke={palette.glow} strokeWidth="0.5" opacity="0.07" />
            <line x1="66%" y1="0" x2="66%" y2="100%" stroke={palette.glow} strokeWidth="0.5" opacity="0.07" />
          </svg>
          <div className="relative z-10 font-display text-[22px] leading-none tracking-widest mb-1"
            style={{ color: palette.glow, textShadow: `0 0 12px ${palette.glow}, 0 0 28px ${palette.glow}55` }}>
            {imgStatus === "loading" ? "···" : initials}
          </div>
          {!compact && (
            <div className="relative z-10 font-display text-[5px] tracking-wider max-w-[90%] text-center truncate"
              style={{ color: palette.glow, opacity: 0.6 }}>
              {imgStatus === "loading" ? "BUSCANDO..." : label}
            </div>
          )}
        </div>
      )}
      {!compact && (
        <div className="absolute bottom-1 right-1.5 z-10 font-display text-[4px] tracking-widest px-1 py-0.5 rounded"
          style={{ color: palette.glow, border: `1px solid ${palette.glow}44`, background: "#00000088" }}>
          {isFavorite ? "★ FAVORITO" : "INSERT COIN"}
        </div>
      )}
      {compact && isFavorite && (
        <div className="absolute top-0.5 right-0.5 z-10 font-display text-[8px]" style={{ color: "#ffe033", textShadow: "0 0 4px #ffe033" }}>★</div>
      )}
    </div>
  );
}

// ─── Constantes ───────────────────────────────────────────────────────────────
const FAV_KEY  = "mame.favorites";
const HIST_KEY = "mame.history";
const CFG_KEY  = "mame.config";
const MODE_KEY = "mame.sidebarMode";
const BACKEND  = "http://localhost:7777";

type SidebarMode = "expanded" | "normal" | "compact" | "hidden";
const SIDEBAR_WIDTH: Record<SidebarMode, number> = { expanded: 0, normal: 240, compact: 120, hidden: 0 };

interface HistoryItem { rom: string; timestamp: number; }

export default function HomePage() { return <Home />; }

function Home() {
  const [mameExePath, setMameExePath]   = useState<string>("");
  const [romsPath, setRomsPath]         = useState<string>("");
  const [romsList, setRomsList]         = useState<string[]>([]);
  const [gameNames, setGameNames]       = useState<Record<string, string>>({});
  const [favorites, setFavorites]       = useState<string[]>([]);
  const [history, setHistory]           = useState<HistoryItem[]>([]);
  const [searchQuery, setSearchQuery]   = useState<string>("");
  const [debouncedQuery] = useDebounce(searchQuery, 150);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [isLaunching, setIsLaunching]   = useState(false);
  const [showHistory, setShowHistory]   = useState(false);
  const [showConfig, setShowConfig]     = useState(false);
  const [showMameInfo, setShowMameInfo] = useState(false);
  const [launchingRom, setLaunchingRom] = useState<string>("");
  const [mameStatus, setMameStatus]     = useState<"checking" | "found" | "not_found">("checking");
  const [backendStatus, setBackendStatus] = useState<"checking" | "ok" | "offline">("checking");
  const [configMamePath, setConfigMamePath] = useState("C:\\Users\\cordeiro\\Downloads\\Mameplus_0.168.2\\Mameplus_0.168.2\\mame.exe");
  const [configRomsPath, setConfigRomsPath] = useState("C:\\Users\\cordeiro\\Downloads\\Mameplus_0.168.2\\Mameplus_0.168.2\\roms");
  const [configMsg, setConfigMsg]       = useState("");
  const [launchMsg, setLaunchMsg]       = useState("");
  const [sidebarMode, setSidebarModeState] = useState<SidebarMode>("normal");
  const [browser, setBrowser] = useState<null | "mame" | "roms">(null);
  const [installerOpen, setInstallerOpen] = useState(false);
  const [installDest, setInstallDest] = useState<string>("C:\\MAME");
  const [installBrowserOpen, setInstallBrowserOpen] = useState(false);
  const [installProgress, setInstallProgress] = useState<{
    active: boolean; phase: string; message: string; percent: number;
    error?: string; mamePath?: string; romsDir?: string;
  }>({ active: false, phase: "idle", message: "", percent: 0 });
  const [showMameWindow, setShowMameWindow] = useState<boolean>(() => {
    try { return localStorage.getItem("mame.showWindow") === "1"; } catch { return false; }
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef  = useRef<HTMLDivElement>(null);
  const gridScrollRef = useRef<HTMLDivElement>(null);

  // Setter persistente
  const setSidebarMode = useCallback((m: SidebarMode) => {
    setSidebarModeState(m);
    try { localStorage.setItem(MODE_KEY, m); } catch { /* noop */ }
  }, []);

  // ── Howler: carrega sons ao montar (sem CDN) ──
  useEffect(() => { loadSounds(); }, []);

  // ── Restaurar modo da sidebar ──
  useEffect(() => {
    try {
      const m = localStorage.getItem(MODE_KEY) as SidebarMode | null;
      if (m && ["expanded", "normal", "compact", "hidden"].includes(m)) setSidebarModeState(m);
    } catch { /* noop */ }
  }, []);

  // ── react-spring: animação do sidebar (width + opacity + transform) ──
  const sidebarSpring = useSpring({
    opacity: sidebarMode === "hidden" || sidebarMode === "expanded" ? 0 : 1,
    width: sidebarMode === "compact" ? 120 : 240,
    transform: sidebarMode === "hidden" ? "translateX(260px)" : "translateX(0px)",
    config: { tension: 280, friction: 26 },
  });

  const expandedSpring = useSpring({
    opacity: sidebarMode === "expanded" ? 1 : 0,
    scale: sidebarMode === "expanded" ? 1 : 0.97,
    config: { tension: 260, friction: 24 },
  });

  // ── Fuse.js: busca fuzzy ──
  const fuse = useRef<Fuse<string>>(new Fuse<string>([], { threshold: 0.4, distance: 100 }));
  useEffect(() => {
    // Busca tanto pelo nome do arquivo quanto pelo título completo
    type RomEntry = { rom: string; title: string };
    const entries: RomEntry[] = romsList.map((r) => ({
      rom: r,
      title: gameNames[r.replace(/\.(zip|7z|chd)$/i, "")] || r,
    }));
    const f = new Fuse<RomEntry>(entries, { keys: ["rom", "title"], threshold: 0.4, distance: 100 });
    // Adapter para manter API antiga (.search → {item: string})
    fuse.current = {
      search: (q: string) => f.search(q).map((r) => ({ item: r.item.rom })),
    } as unknown as Fuse<string>;
  }, [romsList, gameNames]);

  // Nome amigável: usa -listfull do MAME quando disponível
  const displayName = useCallback((rom: string) => {
    const clean = rom.replace(/\.(zip|7z|chd)$/i, "");
    return gameNames[clean] || clean;
  }, [gameNames]);

  const getFilteredRoms = useCallback(() => {
    const q = debouncedQuery.trim();
    let filtered: string[];
    if (!q) filtered = romsList;
    else if (q.length <= 2) {
      const lq = q.toLowerCase();
      filtered = romsList.filter((r) => r.toLowerCase().includes(lq) || displayName(r).toLowerCase().includes(lq));
    }
    else filtered = fuse.current.search(q).map((r) => r.item);
    const favs = filtered.filter((r) => favorites.includes(r));
    const rest = filtered.filter((r) => !favorites.includes(r));
    return [...favs, ...rest];
  }, [romsList, debouncedQuery, favorites, displayName]);

  const checkBackend = useCallback(async () => {
    try {
      const r = await fetch(`${BACKEND}/api/health`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) { setBackendStatus("ok"); return true; }
    } catch { /* noop */ }
    setBackendStatus("offline");
    return false;
  }, []);

  const checkMame = useCallback(async (mamePath: string) => {
    if (!mamePath) { setMameStatus("not_found"); return; }
    try {
      const r = await fetch(`${BACKEND}/api/check-mame?path=${encodeURIComponent(mamePath)}`);
      const data = await r.json();
      setMameStatus(data.exists ? "found" : "not_found");
    } catch { setMameStatus("not_found"); }
  }, []);

  const scanRoms = useCallback(async (romsDir: string) => {
    if (!romsDir) return;
    try {
      const r = await fetch(`${BACKEND}/api/roms?path=${encodeURIComponent(romsDir)}`);
      const data = await r.json();
      if (data.roms) {
        setRomsList(data.roms);
        setConfigMsg(`✓ ${data.total} ROMs encontradas`);
      } else {
        setConfigMsg(`✗ ${data.error}`);
      }
    } catch { setConfigMsg("✗ Erro ao conectar no backend"); }
  }, []);

  // Carrega/atualiza a base de nomes oficiais (mame -listfull)
  const loadNames = useCallback(async (mamePath?: string, refresh = false) => {
    try {
      const qs = new URLSearchParams();
      if (mamePath) qs.set("mamePath", mamePath);
      if (refresh) qs.set("refresh", "1");
      const r = await fetch(`${BACKEND}/api/names?${qs.toString()}`);
      const data = await r.json();
      if (data?.names) setGameNames(data.names);
    } catch { /* noop */ }
  }, []);

  const saveCfg = useCallback((mamePath: string, romsDir: string) => {
    try { localStorage.setItem(CFG_KEY, JSON.stringify({ mamePath, romsDir })); } catch { /* noop */ }
    fetch(`${BACKEND}/api/config`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mamePath, romsDir }),
    }).catch(() => { /* noop */ });
  }, []);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const skipIntro = params.get("launcher") === "1" || sessionStorage.getItem("mga.introSeen") === "1";
      if (!skipIntro) { window.location.replace("/intro.html"); return; }
      sessionStorage.setItem("mga.introSeen", "1");
    } catch { /* noop */ }
    try {
      const f = localStorage.getItem(FAV_KEY); if (f) setFavorites(JSON.parse(f));
      const h = localStorage.getItem(HIST_KEY); if (h) setHistory(JSON.parse(h));
      const cfg = localStorage.getItem(CFG_KEY);
      if (cfg) {
        const { mamePath, romsDir } = JSON.parse(cfg);
        if (mamePath) { setMameExePath(mamePath); setConfigMamePath(mamePath); }
        if (romsDir)  { setRomsPath(romsDir);    setConfigRomsPath(romsDir); }
      }
    } catch { /* noop */ }
    const DEFAULT_MAME = "C:\\Users\\cordeiro\\Downloads\\Mameplus_0.168.2\\Mameplus_0.168.2\\mame.exe";
    const DEFAULT_ROMS = "C:\\Users\\cordeiro\\Downloads\\Mameplus_0.168.2\\Mameplus_0.168.2\\roms";
    checkBackend().then(async (ok) => {
      if (!ok) { setMameStatus("not_found"); return; }
      let mamePath = "", romsDir = "";
      try {
        const cfg = localStorage.getItem(CFG_KEY);
        if (cfg) { const c = JSON.parse(cfg); mamePath = c.mamePath || ""; romsDir = c.romsDir || ""; }
      } catch { /* noop */ }
      if (!mamePath || !romsDir) {
        try {
          const r = await fetch(`${BACKEND}/api/config`);
          const srv = await r.json();
          if (srv.mamePath && !mamePath) mamePath = srv.mamePath;
          if (srv.romsDir  && !romsDir)  romsDir  = srv.romsDir;
        } catch { /* noop */ }
      }
      if (!mamePath) mamePath = DEFAULT_MAME;
      if (!romsDir)  romsDir  = DEFAULT_ROMS;
      setMameExePath(mamePath); setConfigMamePath(mamePath);
      setRomsPath(romsDir);     setConfigRomsPath(romsDir);
      saveCfg(mamePath, romsDir);
      checkMame(mamePath);
      scanRoms(romsDir);
      loadNames(mamePath);
    });
    inputRef.current?.focus();
    const healthInterval = setInterval(() => { checkBackend(); }, 5000);
    return () => clearInterval(healthInterval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!romsPath || backendStatus !== "ok") return;
    const interval = setInterval(() => { scanRoms(romsPath); }, 30000);
    return () => clearInterval(interval);
  }, [romsPath, backendStatus, scanRoms]);

  const filteredRoms = useMemo(() => getFilteredRoms(), [getFilteredRoms]);

  const toggleFavorite = useCallback((rom: string) => {
    setFavorites((prev) => {
      const next = prev.includes(rom) ? prev.filter((r) => r !== rom) : [...prev, rom];
      try { localStorage.setItem(FAV_KEY, JSON.stringify(next)); } catch { /* noop */ }
      return next;
    });
  }, []);

  const handleLaunchGame = useCallback(async (romName: string) => {
    if (!mameExePath) {
      playSound(sndError);
      setLaunchMsg("✗ Configure o caminho do MAME em ⚙ CONFIG (ESC)");
      setTimeout(() => setLaunchMsg(""), 3000); return;
    }
    if (backendStatus !== "ok") {
      playSound(sndError);
      setLaunchMsg("✗ Backend offline! Abra um terminal e rode: node mame-server.js");
      setTimeout(() => setLaunchMsg(""), 5000); return;
    }
    playSound(sndLaunch);
    setIsLaunching(true);
    setLaunchingRom(romName);
    setLaunchMsg(`⏳ Iniciando ${romName}...`);
    await new Promise((resolve) => setTimeout(resolve, 4000));
    try {
      const r = await fetch(`${BACKEND}/api/launch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mamePath: mameExePath, romName, showMame: showMameWindow, romPath: romsPath ? `${romsPath}\\${romName}` : undefined }),
      });
      const data = await r.json();
      if (data.ok) {
        playSound(sndSelect);
        setLaunchMsg(`✓ ${romName} iniciado!`);
        setHistory((prev) => {
          const next = [{ rom: romName, timestamp: Date.now() }, ...prev.filter((h) => h.rom !== romName)].slice(0, 20);
          try { localStorage.setItem(HIST_KEY, JSON.stringify(next)); } catch { /* noop */ }
          return next;
        });
      } else { playSound(sndError); setLaunchMsg(`✗ ${data.error}`); }
    } catch { playSound(sndError); setLaunchMsg("✗ Falha ao chamar o backend."); }
    finally { setTimeout(() => { setIsLaunching(false); setLaunchingRom(""); setTimeout(() => setLaunchMsg(""), 3000); }, 4000); }
  }, [mameExePath, backendStatus, romsPath, showMameWindow]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (showConfig) return;
      const isInInput = document.activeElement?.tagName === "INPUT";
      // Atalhos de modo da janela (qualquer lugar, exceto inputs)
      if (!isInInput) {
        if (e.key === "[") { e.preventDefault(); setSidebarMode(sidebarMode === "compact" ? "normal" : "compact"); return; }
        if (e.key === "]") { e.preventDefault(); setSidebarMode("expanded"); return; }
        if (e.key === "\\") { e.preventDefault(); setSidebarMode(sidebarMode === "hidden" ? "normal" : "hidden"); return; }
      }
      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((p) => { const n = p > 0 ? p - 1 : filteredRoms.length - 1; playSound(sndMove); return n; });
          break;
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((p) => { const n = p < filteredRoms.length - 1 ? p + 1 : 0; playSound(sndMove); return n; });
          break;
        case "Enter":
          e.preventDefault();
          if (filteredRoms.length > 0) handleLaunchGame(filteredRoms[selectedIndex]);
          break;
        case "*": case "s": case "S":
          if (isInInput) break;
          e.preventDefault();
          if (filteredRoms[selectedIndex]) { toggleFavorite(filteredRoms[selectedIndex]); playSound(sndFav); }
          break;
        case "Escape":
          e.preventDefault();
          setShowConfig((v) => !v);
          break;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedIndex, filteredRoms, showConfig, handleLaunchGame, toggleFavorite, sidebarMode, setSidebarMode]);

  useEffect(() => {
    if (listRef.current) {
      const el = listRef.current.children[selectedIndex] as HTMLElement | undefined;
      el?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  const handleApplyMamePath = async () => {
    if (!configMamePath.trim()) { setConfigMsg("✗ Informe o caminho do mame.exe"); return; }
    setConfigMsg("⏳ Verificando...");
    const alive = await checkBackend();
    if (!alive) { setConfigMsg("✗ Backend offline! Rode: node mame-server.js"); return; }
    const r = await fetch(`${BACKEND}/api/check-mame?path=${encodeURIComponent(configMamePath.trim())}`);
    const data = await r.json();
    if (data.exists) {
      setMameExePath(configMamePath.trim());
      setMameStatus("found");
      if (data.currentRompath) {
        setConfigRomsPath(data.currentRompath);
        setRomsPath(data.currentRompath);
        saveCfg(configMamePath.trim(), data.currentRompath);
        setConfigMsg(`✓ MAME encontrado! rompath do mame.ini: ${data.currentRompath}`);
        await scanRoms(data.currentRompath);
      } else {
        saveCfg(configMamePath.trim(), romsPath);
        setConfigMsg("✓ MAME encontrado! Agora configure a pasta de ROMs.");
      }
    } else {
      setMameStatus("not_found");
      setConfigMsg(`✗ Arquivo não encontrado: ${data.path}`);
    }
  };

  const handleScanRoms = async () => {
    if (!configRomsPath.trim()) { setConfigMsg("✗ Informe a pasta de ROMs"); return; }
    if (!mameExePath) { setConfigMsg("✗ Configure o MAME primeiro antes de escanear"); return; }
    setConfigMsg("⏳ Escaneando e salvando no mame.ini...");
    const alive = await checkBackend();
    if (!alive) { setConfigMsg("✗ Backend offline! Rode: node mame-server.js"); return; }
    try {
      const iniRes = await fetch(`${BACKEND}/api/set-rompath`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mamePath: mameExePath, romsPath: configRomsPath.trim() }),
      });
      const iniData = await iniRes.json();
      if (!iniData.ok) { setConfigMsg(`✗ Erro ao salvar mame.ini: ${iniData.error}`); return; }
    } catch { setConfigMsg("✗ Falha ao salvar no mame.ini"); return; }
    setRomsPath(configRomsPath.trim());
    saveCfg(mameExePath, configRomsPath.trim());
    await scanRoms(configRomsPath.trim());
  };

  // Inicia download/instalação do MAME oficial e fica fazendo polling do progresso
  const startInstallMame = useCallback(async () => {
    if (!installDest.trim()) return;
    setInstallProgress({ active: true, phase: "starting", message: "Iniciando...", percent: 0 });
    try {
      const r = await fetch(`${BACKEND}/api/install-mame`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destDir: installDest.trim() }),
      });
      if (!r.ok && r.status !== 202) {
        const d = await r.json().catch(() => ({}));
        setInstallProgress({ active: false, phase: "error", message: "", percent: 0, error: d.error || "Falha ao iniciar instalação" });
        return;
      }
    } catch {
      setInstallProgress({ active: false, phase: "error", message: "", percent: 0, error: "Backend offline" });
      return;
    }
    // polling
    const poll = async () => {
      try {
        const r = await fetch(`${BACKEND}/api/install-mame/status`);
        const p = await r.json();
        setInstallProgress({
          active: !!p.active,
          phase: p.phase || "idle",
          message: p.message || "",
          percent: p.percent || 0,
          error: p.error,
          mamePath: p.mamePath,
          romsDir: p.romsDir,
        });
        if (p.phase === "done") {
          if (p.mamePath) { setMameExePath(p.mamePath); setConfigMamePath(p.mamePath); setMameStatus("found"); }
          if (p.romsDir)  { setRomsPath(p.romsDir);   setConfigRomsPath(p.romsDir); }
          if (p.mamePath && p.romsDir) saveCfg(p.mamePath, p.romsDir);
          if (p.romsDir) scanRoms(p.romsDir);
          if (p.mamePath) loadNames(p.mamePath, true);
          return;
        }
        if (p.phase === "error") return;
        setTimeout(poll, 800);
      } catch {
        setTimeout(poll, 1500);
      }
    };
    setTimeout(poll, 600);
  }, [installDest, saveCfg, scanRoms, loadNames]);

  const historyRoms     = history.slice(0, 5).map((h) => h.rom);
  const selectedRom     = filteredRoms[selectedIndex];
  const isFavorite      = selectedRom && favorites.includes(selectedRom);
  const mameStatusLabel = mameStatus === "checking" ? "⏳ VERIFICANDO" : mameStatus === "found" ? "✓ OK" : "✗ NÃO ENCONTRADO";
  const mameStatusColor = mameStatus === "found" ? "text-neon-green" : mameStatus === "not_found" ? "text-red-400" : "text-neon-yellow";
  const glass           = "bg-black/40 backdrop-blur-md border border-neon-cyan/20";
  const glassDark       = "bg-black/55 backdrop-blur-xl border border-neon-cyan/15";

  // ── Virtualizer para a grade do modo expandido ──
  const COLS = Math.max(2, Math.floor(((typeof window !== "undefined" ? window.innerWidth : 1200) - 48) / 160));
  const rowCount = Math.ceil(filteredRoms.length / COLS);
  const gridVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => gridScrollRef.current,
    estimateSize: () => 160,
    overscan: 4,
  });

  // ── Botões de controle reutilizáveis ──
  const SidebarControls = ({ size = "sm" }: { size?: "sm" | "md" }) => {
    const cls = size === "md"
      ? "font-display text-[8px] border px-2 py-1 rounded transition"
      : "font-display text-[8px] border px-1.5 py-0.5 rounded transition";
    return (
      <div className="flex gap-1">
        <button onClick={() => setSidebarMode("expanded")} title="Expandir (])"
          className={`${cls} border-white/15 text-foreground/45 hover:text-neon-cyan hover:border-neon-cyan/40`}>
          <Maximize2 size={10} />
        </button>
        <button onClick={() => setSidebarMode(sidebarMode === "compact" ? "normal" : "compact")} title="Encurtar / Restaurar ([)"
          className={`${cls} ${sidebarMode === "compact" ? "border-neon-magenta/50 text-neon-magenta" : "border-white/15 text-foreground/45 hover:text-neon-magenta hover:border-neon-magenta/40"}`}>
          <Minimize2 size={10} />
        </button>
        <button onClick={() => setSidebarMode("hidden")} title="Ocultar (\\)"
          className={`${cls} border-white/15 text-foreground/45 hover:text-red-400 hover:border-red-400/40`}>
          <X size={10} />
        </button>
      </div>
    );
  };

  return (
    <main className="min-h-screen overflow-hidden relative">

      {/* TELA DE LOADING ao lançar jogo */}
      {isLaunching && (
        <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center overflow-hidden"
          style={{ backgroundImage: "url('/assets/10.png')", backgroundSize: "cover", backgroundPosition: "center", backgroundColor: "#000" }}>
          <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/40 to-black/80" />
          <div className="absolute inset-0 scanlines pointer-events-none opacity-40" />
          <div className="relative z-10 flex flex-col items-center px-6 text-center" style={{ marginTop: "62vh" }}>
            <div className="font-display text-neon-cyan text-[11px] tracking-[0.5em] mb-3 animate-pulse" style={{ textShadow: "0 0 20px cyan" }}>
              PREPARE-SE!
            </div>
            <div className="font-display text-white text-[28px] md:text-[36px] tracking-widest uppercase leading-tight break-all max-w-[80vw]"
              style={{ textShadow: "0 0 20px #fff, 0 0 40px #00e5ff, 0 0 60px #00e5ff" }}>
              {displayName(launchingRom)}
            </div>
            <div className="flex gap-2 mt-4">
              {[0,1,2,3,4,5,6,7].map(i => (
                <div key={i} className="w-2 h-2 rounded-full bg-neon-cyan animate-bounce"
                  style={{ animationDelay: `${i * 0.12}s`, boxShadow: "0 0 8px cyan" }} />
              ))}
            </div>
            <div className="font-display text-neon-green text-[8px] mt-3 tracking-widest animate-pulse">
              INSERINDO FICHA... CARREGANDO JOGO...
            </div>
          </div>
        </div>
      )}

      <div className="fixed inset-0 bg-no-repeat" style={{ backgroundImage: "url('/assets/background.png')", backgroundSize: "contain", backgroundPosition: "left center", backgroundAttachment: "fixed", backgroundColor: "#000" }} />
      <div className="fixed inset-0 scanlines pointer-events-none z-0" />
      <div className="scanline-sweep fixed" />
      <div className="marquee-bar h-[2px] w-full fixed top-0 left-0 z-50" />

      {/* NAV */}
      <nav className={`fixed top-[2px] left-3 right-3 z-40 rounded-md px-4 py-2.5 ${glass}`} style={{ boxShadow: "0 4px 32px rgba(0,229,255,0.06)" }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-8 w-8 place-items-center rounded font-display text-[9px] text-neon-magenta border border-neon-magenta/40 bg-neon-magenta/10">MG</div>
            <div>
              <div className="font-display text-[10px] text-neon-cyan">MASTER GAMES ARCADE</div>
              <div className="font-body text-xs text-foreground/40 -mt-0.5">
                Iniciador MAME
                {showMameInfo && backendStatus === "ok"      && <span className="text-neon-green ml-2">● backend ok</span>}
                {showMameInfo && backendStatus === "offline" && <span className="text-red-400 ml-2">● backend offline</span>}
              </div>
            </div>
          </div>
          <div className="flex gap-2 items-center">
            <SidebarControls size="md" />
            <button onClick={() => setShowHistory(!showHistory)} className="font-display text-[8px] border border-neon-green/35 text-neon-green px-2.5 py-1 rounded bg-neon-green/5 hover:bg-neon-green/15 transition">⏱ RECENTE</button>
            <button onClick={() => setShowMameInfo(v => !v)} className={`font-display text-[8px] border px-2.5 py-1 rounded transition ${showMameInfo ? "border-neon-yellow/50 text-neon-yellow bg-neon-yellow/10" : "border-white/15 text-foreground/40 bg-white/[0.02] hover:text-neon-yellow"}`}>👁 MAME</button>
            <button onClick={() => { setShowConfig(!showConfig); setConfigMsg(""); }} className="font-display text-[8px] border border-neon-magenta/35 text-neon-magenta px-2.5 py-1 rounded bg-neon-magenta/5 hover:bg-neon-magenta/15 transition">
              <Settings2 size={9} className="inline mr-1" />CONFIG
            </button>
          </div>
        </div>
      </nav>

      {/* CONFIG PANEL */}
      {showConfig && (
        <div className={`fixed top-[46px] left-3 right-3 z-[39] rounded-b-md px-5 py-4 ${glassDark}`} style={{ boxShadow: "0 8px 40px rgba(224,64,251,0.08)" }}>
          <div className="font-display text-[8px] text-neon-magenta mb-2">// CONFIGURAÇÃO DE CAMINHOS</div>
          {backendStatus === "offline" && (
            <div className="mb-3 px-3 py-2 bg-red-900/30 border border-red-500/30 rounded font-display text-[7px] text-red-300">
              ⚠ Backend offline! Abra um terminal na pasta do projeto e execute:<br />
              <span className="text-neon-yellow font-bold">node mame-server.js</span>
            </div>
          )}
          <div className="space-y-3 max-w-2xl">
            <div className="space-y-1">
              <label className="font-display text-[7px] text-neon-cyan block">CAMINHO DO MAME (.exe)</label>
              <div className="flex gap-2">
                <input type="text" placeholder="ex: C:\mame\mame.exe" value={configMamePath} onChange={(e) => setConfigMamePath(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleApplyMamePath()} className="flex-1 px-3 py-1.5 bg-black/40 border border-white/10 text-foreground font-body text-sm rounded focus:outline-none focus:border-neon-cyan/40" />
                <button onClick={() => setBrowser("mame")} title="Procurar mame.exe" className="font-display text-[7px] border border-neon-magenta/40 text-neon-magenta px-3 py-1.5 rounded bg-neon-magenta/5 hover:bg-neon-magenta/15 transition"><FolderOpen size={9} className="inline mr-1" />PROCURAR</button>
                <button onClick={handleApplyMamePath} className="font-display text-[7px] border border-neon-cyan/35 text-neon-cyan px-3 py-1.5 rounded bg-neon-cyan/5 hover:bg-neon-cyan/15 transition">VERIFICAR</button>
              </div>
              {mameExePath && <div className="font-body text-[10px] text-neon-green flex items-center gap-1"><CheckCircle size={9} /> {mameExePath}</div>}
            </div>
            <div className="space-y-1">
              <label className="font-display text-[7px] text-neon-cyan block">PASTA DE ROMs</label>
              <div className="flex gap-2">
                <input type="text" placeholder="ex: C:\ROMs" value={configRomsPath} onChange={(e) => setConfigRomsPath(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleScanRoms()} className="flex-1 px-3 py-1.5 bg-black/40 border border-white/10 text-foreground font-body text-sm rounded focus:outline-none focus:border-neon-cyan/40" />
                <button onClick={() => setBrowser("roms")} title="Procurar pasta de ROMs" className="font-display text-[7px] border border-neon-magenta/40 text-neon-magenta px-3 py-1.5 rounded bg-neon-magenta/5 hover:bg-neon-magenta/15 transition"><FolderOpen size={9} className="inline mr-1" />PROCURAR</button>
                <button onClick={handleScanRoms} className="font-display text-[7px] border border-neon-cyan/35 text-neon-cyan px-3 py-1.5 rounded bg-neon-cyan/5 hover:bg-neon-cyan/15 transition">ESCANEAR</button>
              </div>
            </div>
            {configMsg && <div className={`font-display text-[7px] ${configMsg.startsWith("✓") ? "text-neon-green" : configMsg.startsWith("⏳") ? "text-neon-yellow" : "text-red-400"}`}>{configMsg}</div>}

            <div className="mt-3 pt-3 border-t border-white/[0.06] space-y-2">
              <div className="font-display text-[7px] text-neon-magenta">// COMPORTAMENTO DO MAME</div>

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showMameWindow}
                  onChange={(e) => {
                    setShowMameWindow(e.target.checked);
                    try { localStorage.setItem("mame.showWindow", e.target.checked ? "1" : "0"); } catch { /* noop */ }
                  }}
                  className="accent-neon-cyan"
                />
                <span className="font-display text-[7px] text-neon-cyan">MOSTRAR JANELA DO MAME (DEBUG)</span>
                <span className="font-body text-[10px] text-foreground/45">
                  {showMameWindow ? "Vai abrir em janela com console." : "Oculto: só o jogo em fullscreen aparece."}
                </span>
              </label>

              <div className="flex flex-wrap gap-2 items-center">
                <button
                  onClick={async () => {
                    if (!mameExePath) { setConfigMsg("✗ Configure o MAME primeiro"); return; }
                    setConfigMsg("⏳ Aplicando teclado padrão...");
                    try {
                      const r = await fetch(`${BACKEND}/api/reset-controls`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ mamePath: mameExePath }),
                      });
                      const data = await r.json();
                      if (data.ok) setConfigMsg(`✓ Teclado configurado em todas as ROMs (${data.mappings} teclas)`);
                      else setConfigMsg(`✗ ${data.error}`);
                    } catch { setConfigMsg("✗ Backend offline"); }
                  }}
                  className="font-display text-[7px] border border-neon-green/40 text-neon-green px-3 py-1.5 rounded bg-neon-green/5 hover:bg-neon-green/15 transition"
                >⌨ CONFIGURAR TECLADO PADRÃO (TODAS AS ROMs)</button>
                <span className="font-body text-[10px] text-foreground/45">Setas + Ctrl/Alt/Espaço/Shift · 1=Start · 5=Coin</span>
              </div>

              <div className="flex flex-wrap gap-2 items-center">
                <button
                  onClick={async () => {
                    if (!configRomsPath) { setConfigMsg("✗ Configure a pasta de ROMs primeiro"); return; }
                    if (!romsList.length) { setConfigMsg("✗ Escaneie as ROMs antes"); return; }
                    setConfigMsg(`⏳ Baixando artes de ${romsList.length} ROMs... (pode demorar)`);
                    try {
                      const r = await fetch(`${BACKEND}/api/download-images`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ romsPath: configRomsPath, roms: romsList, kinds: ["snap", "title"] }),
                      });
                      const data = await r.json();
                      if (data.ok) setConfigMsg(`✓ ${data.downloaded} imagens baixadas · ${data.skipped} já existiam · ${data.failed} falharam → ${data.dir}`);
                      else setConfigMsg(`✗ ${data.error}`);
                    } catch { setConfigMsg("✗ Backend offline"); }
                  }}
                  className="font-display text-[7px] border border-neon-yellow/40 text-neon-yellow px-3 py-1.5 rounded bg-neon-yellow/5 hover:bg-neon-yellow/15 transition"
                >⬇ BAIXAR IMAGENS DAS ROMs (AUTO)</button>
                <span className="font-body text-[10px] text-foreground/45">Snap + Title de libretro-thumbnails / archive.org · salva em <code className="text-neon-cyan">..\images\</code></span>
              </div>

              <div className="flex flex-wrap gap-2 items-center">
                <button
                  onClick={async () => {
                    if (!mameExePath) { setConfigMsg("✗ Configure o MAME primeiro"); return; }
                    setConfigMsg("⏳ Lendo nomes oficiais (mame -listfull)... pode demorar 10-30s");
                    try {
                      const r = await fetch(`${BACKEND}/api/names?mamePath=${encodeURIComponent(mameExePath)}&refresh=1`);
                      const data = await r.json();
                      if (data?.names) {
                        setGameNames(data.names);
                        setConfigMsg(`✓ ${data.total} nomes oficiais carregados do MAME`);
                      } else setConfigMsg(`✗ ${data.error || "Falha ao ler nomes"}`);
                    } catch { setConfigMsg("✗ Backend offline"); }
                  }}
                  className="font-display text-[7px] border border-neon-cyan/40 text-neon-cyan px-3 py-1.5 rounded bg-neon-cyan/5 hover:bg-neon-cyan/15 transition"
                >🏷 ATUALIZAR NOMES DOS JOGOS (mame -listfull)</button>
                <span className="font-body text-[10px] text-foreground/45">
                  {Object.keys(gameNames).length > 0 ? `${Object.keys(gameNames).length} nomes em cache` : "Nenhum nome carregado ainda"}
                </span>
              </div>
            </div>

            <div className="mt-3 pt-3 border-t border-white/[0.06] space-y-1.5">
              <div className="font-display text-[7px] text-neon-magenta">// MAME OFICIAL (OPEN SOURCE)</div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => setInstallerOpen(true)} className="font-display text-[7px] border border-neon-yellow/50 text-neon-yellow px-3 py-1.5 rounded bg-neon-yellow/10 hover:bg-neon-yellow/20 transition">⬇ BAIXAR E INSTALAR MAME (AUTOMÁTICO)</button>
                <a href="https://www.mamedev.org/release.html" target="_blank" rel="noopener noreferrer" className="font-display text-[7px] border border-neon-cyan/35 text-neon-cyan px-3 py-1.5 rounded bg-neon-cyan/5 hover:bg-neon-cyan/15 transition">⬇ MAME OFICIAL (site)</a>
                <a href="https://www.mamedev.org/roms/" target="_blank" rel="noopener noreferrer" className="font-display text-[7px] border border-neon-green/35 text-neon-green px-3 py-1.5 rounded bg-neon-green/5 hover:bg-neon-green/15 transition">⬇ ROMS LEGAIS (MAMEDEV)</a>
              </div>
              <div className="font-body text-[10px] text-foreground/45 leading-snug">
                ⚠ Se alguns <span className="text-neon-yellow">.zip</span> não abrem é porque o romset é de outra versão do MAME (ex.: 0.139 / 0.245).
                Use o <span className="text-neon-cyan">MAME oficial</span> e ROMs do <span className="text-neon-cyan">mesmo set</span>, ou rode <span className="text-neon-yellow">mame -verifyroms nomedorom</span> para conferir.
              </div>
            </div>
          </div>
        </div>
      )}

      {showMameInfo && backendStatus === "offline" && !showConfig && (
        <div className="fixed top-[46px] left-3 right-3 z-[38] rounded-b-md px-4 py-2 bg-red-900/25 border border-red-500/25 backdrop-blur-md flex items-center gap-2">
          <AlertTriangle size={11} className="text-red-400 flex-shrink-0" />
          <span className="font-display text-[7px] text-red-300">Backend offline! Abra um terminal e rode: <span className="text-neon-yellow">node mame-server.js</span></span>
        </div>
      )}
      {showMameInfo && backendStatus === "ok" && mameStatus === "not_found" && !showConfig && (
        <div className="fixed top-[46px] left-3 right-3 z-[38] rounded-b-md px-4 py-2 bg-yellow-900/25 border border-yellow-500/25 backdrop-blur-md flex items-center gap-2">
          <AlertTriangle size={11} className="text-yellow-400 flex-shrink-0" />
          <span className="font-display text-[7px] text-yellow-300">MAME não configurado. Clique em CONFIG (ESC) para definir os caminhos.</span>
        </div>
      )}

      {/* BOTÃO FLUTUANTE quando oculto */}
      {sidebarMode === "hidden" && (
        <button
          onClick={() => setSidebarMode("normal")}
          className="fixed bottom-[30px] right-4 z-50 font-display text-[8px] border border-neon-cyan/50 text-neon-cyan px-3 py-2 rounded bg-black/80 backdrop-blur-md hover:bg-neon-cyan/10 transition"
          style={{ boxShadow: "0 0 16px rgba(0,229,255,0.3)" }}>
          ▶ JOGOS
        </button>
      )}

      {/* MODO EXPANDIDO — grade virtualizada */}
      {sidebarMode === "expanded" && (
        <animated.div
          style={{
            opacity: expandedSpring.opacity,
            transform: expandedSpring.scale.to((s) => `scale(${s})`),
            boxShadow: "0 8px 48px rgba(0,229,255,0.06)",
          }}
          className={`fixed top-[46px] left-3 right-3 bottom-[22px] z-30 rounded-md flex flex-col overflow-hidden ${glassDark}`}>
          <div className="px-4 py-2 border-b border-white/[0.06] flex items-center gap-3 flex-shrink-0">
            <div className="font-display text-[9px] text-neon-magenta flex-1">MASTER GAMES ARCADE · {filteredRoms.length} JOGOS</div>
            <input type="text" placeholder="Buscar (fuzzy)..." value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setSelectedIndex(0); }}
              className="px-2 py-1 bg-black/40 border border-white/[0.07] text-foreground font-body text-[11px] rounded focus:outline-none focus:border-neon-cyan/35 w-48" />
            <SidebarControls size="md" />
            <button onClick={() => setSidebarMode("normal")} title="Voltar pro modo normal"
              className="font-display text-[8px] border border-white/20 text-foreground/40 px-2 py-1 rounded hover:text-neon-cyan hover:border-neon-cyan/40 transition">⊟</button>
          </div>
          <div ref={gridScrollRef} className="flex-1 overflow-y-auto p-3">
            {filteredRoms.length === 0 ? (
              <div className="font-body text-[11px] text-foreground/25 text-center mt-10">
                {romsList.length === 0 ? "Configure a pasta de ROMs em ⚙ CONFIG" : "Sem resultados"}
              </div>
            ) : (
              <div style={{ height: gridVirtualizer.getTotalSize(), position: "relative", width: "100%" }}>
                {gridVirtualizer.getVirtualItems().map((vRow) => {
                  const startIdx = vRow.index * COLS;
                  const rowRoms = filteredRoms.slice(startIdx, startIdx + COLS);
                  return (
                    <div
                      key={vRow.key}
                      className="grid gap-2 absolute left-0 right-0"
                      style={{
                        top: 0,
                        transform: `translateY(${vRow.start}px)`,
                        height: vRow.size,
                        gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`,
                      }}>
                      {rowRoms.map((rom, j) => {
                        const idx = startIdx + j;
                        const isFav = favorites.includes(rom);
                        const isSelected = selectedIndex === idx;
                        const clean = rom.replace(/\.(zip|7z|chd)$/i, "");
                        const title = displayName(rom);
                        return (
                          <button key={rom}
                            onClick={() => { setSelectedIndex(idx); handleLaunchGame(rom); }}
                            onMouseEnter={() => setSelectedIndex(idx)}
                            disabled={isLaunching}
                            title={title}
                            className={`flex flex-col rounded overflow-hidden border transition disabled:opacity-50 ${isSelected ? "border-neon-cyan/60 shadow-[0_0_12px_rgba(0,229,255,0.3)]" : "border-white/[0.07] hover:border-neon-cyan/30"}`}>
                            <div className="h-24 relative bg-black/50 flex-shrink-0">
                              <RomArtCard rom={rom} isFavorite={isFav} title={title} />
                            </div>
                            <div className={`px-2 py-1.5 text-left ${isSelected ? "bg-neon-cyan/10" : "bg-black/40"}`}>
                              <div className="font-display text-[6px] truncate leading-tight"
                                style={{ color: isSelected ? "#00e5ff" : "rgba(255,255,255,0.5)" }}>
                                {isFav && "★ "}{title.toUpperCase()}
                                <span className="opacity-30"> · {clean}</span>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="flex items-center justify-between px-4 py-1 border-t border-white/[0.06] bg-white/[0.02] font-display text-[6px] flex-shrink-0">
            <span className="text-foreground/25">CLICK OU ENTER · BUSCA FUZZY · [ ENCURTAR · ] EXPANDIR · \ OCULTAR</span>
            {isLaunching && <span className="text-neon-yellow animate-pulse">⏳ CARREGANDO...</span>}
          </div>
        </animated.div>
      )}

      {/* MODO NORMAL / COMPACT — sidebar lateral animada */}
      {sidebarMode !== "expanded" && (
        <animated.aside
          style={{
            opacity: sidebarSpring.opacity,
            width: sidebarSpring.width.to((w) => `${w}px`),
            transform: sidebarSpring.transform,
            boxShadow: "0 8px 48px rgba(0,229,255,0.06)",
            pointerEvents: sidebarMode === "hidden" ? "none" : "auto",
          }}
          className={`fixed top-[46px] right-3 bottom-[22px] z-30 rounded-md flex flex-col overflow-hidden ${glassDark}`}>
          <div className="px-2 pt-2 pb-2 border-b border-white/[0.06] flex-shrink-0">
            <div className="flex items-center justify-between mb-1 gap-1">
              <div className="font-display text-[7px] text-neon-cyan truncate">{sidebarMode === "compact" ? "// MAME" : "// Lançador MAME"}</div>
              <SidebarControls />
            </div>
            {sidebarMode === "normal" && (
              <>
                <h1 className="font-display text-[13px] leading-tight text-neon-magenta mb-1">SELECIONE<br />SEU JOGO</h1>
                <p className="font-body text-[11px] text-foreground/35 mb-2">
                  {mameStatus === "found" ? `✓ MAME · ${romsList.length} jogos · ${favorites.length} favoritos` : mameStatus === "checking" ? "⏳ Verificando MAME..." : "⚠ MAME não configurado"}
                </p>
                {showMameInfo && (
                  <div className="bg-black/30 border border-white/[0.05] rounded px-2 py-1.5">
                    <div className="flex flex-wrap gap-x-2 gap-y-0.5 mb-1">
                      <span className="font-display text-[6px]">MAME: <span className={mameStatusColor}>{mameStatusLabel}</span></span>
                      <span className="font-display text-[6px]">JOGOS: <span className="text-neon-yellow">{romsList.length}</span></span>
                      <span className="font-display text-[6px]">FAVORITOS: <span className="text-neon-yellow">{favorites.length}</span></span>
                    </div>
                    <div className="font-display text-[5px] text-foreground/25">↑↓ MOVER · ENTER JOGAR · * ESTRELA · ESC CONFIG · [ ] \</div>
                  </div>
                )}
              </>
            )}
            {sidebarMode === "compact" && (
              <div className="font-display text-[6px] text-foreground/40">{filteredRoms.length} jogos</div>
            )}
          </div>

          {sidebarMode === "normal" && (
            <>
              <div className="h-28 border-b border-white/[0.06] overflow-hidden bg-black/50 flex-shrink-0 relative">
                {selectedRom ? <RomArtCard rom={selectedRom} isFavorite={!!isFavorite} title={displayName(selectedRom)} /> : (
                  <div className="w-full h-full flex items-center justify-center">
                    <div className="text-center">
                      <div className="font-display text-[7px] text-foreground/20 mb-1">SEM IMAGEM</div>
                      <div className="font-body text-[9px] text-neon-cyan/25">~/Snapshots/</div>
                    </div>
                  </div>
                )}
              </div>

              <div className="px-3 py-2 border-b border-white/[0.06] flex-shrink-0">
                <div className="font-display text-[7px] text-neon-magenta mb-1">// INFORMAÇÕES DO JOGO</div>
                {selectedRom ? (
                  <div className="flex items-start justify-between gap-1 mb-0.5">
                    <div className="flex-1 min-w-0">
                      <div className="font-display text-[10px] text-neon-cyan break-words line-clamp-2 leading-tight">{displayName(selectedRom)}</div>
                      <div className="font-display text-[7px] text-foreground/35 truncate">{selectedRom}</div>
                    </div>
                    <button onClick={() => toggleFavorite(selectedRom)} className="flex-shrink-0 transition">
                      <Star size={13} className={isFavorite ? "fill-neon-yellow text-neon-yellow" : "text-foreground/25"} />
                    </button>
                  </div>
                ) : (
                  <div className="font-body text-xs text-foreground/25">Selecione um jogo</div>
                )}
              </div>

              <div className="flex items-center justify-between px-3 py-1 border-b border-white/[0.06] bg-white/[0.02] flex-shrink-0">
                <span className="font-display text-[7px] text-neon-magenta">▶ JOGOS</span>
                <span className="font-display text-[7px] text-neon-green">{filteredRoms.length}</span>
              </div>

              <div className="px-2 py-1.5 border-b border-white/[0.06] flex-shrink-0">
                <input ref={inputRef} type="text" placeholder="Buscar (fuzzy)..." value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setSelectedIndex(0); }}
                  className="w-full px-2 py-1 bg-black/30 border border-white/[0.07] text-foreground font-body text-[11px] rounded focus:outline-none focus:border-neon-cyan/35" />
              </div>
            </>
          )}

          {/* Lista — normal: texto · compact: thumbs */}
          {sidebarMode === "normal" ? (
            <div ref={listRef} className="flex-1 overflow-y-auto divide-y divide-white/[0.03]">
              {showHistory && historyRoms.length > 0 ? (
                <>
                  <div className="px-3 py-1 bg-neon-green/5 border-b border-neon-green/15 font-display text-[6px] text-neon-green sticky top-0">⏱ ÚLTIMOS</div>
                  {historyRoms.map((rom, idx) => (
                    <button key={`h${idx}`} onClick={() => handleLaunchGame(rom)} disabled={isLaunching}
                      className="w-full text-left px-3 py-1.5 font-display text-[8px] text-neon-green hover:text-neon-cyan hover:bg-neon-cyan/5 transition disabled:opacity-50">
                      {favorites.includes(rom) && "★ "}{rom}
                    </button>
                  ))}
                </>
              ) : romsList.length === 0 ? (
                <div className="px-3 py-6 font-body text-[10px] text-foreground/25 text-center">
                  {backendStatus === "offline" ? "Backend offline.\nRode: node mame-server.js" : "Configure a pasta de ROMs em ⚙ CONFIG"}
                </div>
              ) : filteredRoms.length > 0 ? (
                filteredRoms.map((rom, idx) => {
                  const isFav = favorites.includes(rom);
                  const isSelected = selectedIndex === idx;
                  return (
                    <button key={rom} onClick={() => { setSelectedIndex(idx); handleLaunchGame(rom); }} disabled={isLaunching} onMouseEnter={() => setSelectedIndex(idx)}
                      title={rom}
                      className={`w-full text-left px-3 py-1.5 font-display text-[8px] transition whitespace-nowrap overflow-hidden text-ellipsis disabled:opacity-50 ${isSelected ? "bg-neon-cyan/10 border-l-2 border-neon-cyan text-neon-cyan" : "text-foreground/45 hover:text-neon-cyan hover:bg-neon-cyan/5"}`}>
                      {isFav && "★ "}▶ {displayName(rom)}
                    </button>
                  );
                })
              ) : (
                <div className="px-3 py-6 font-body text-[10px] text-foreground/25 text-center">Sem resultados</div>
              )}
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-1.5">
              {filteredRoms.length === 0 ? (
                <div className="font-body text-[9px] text-foreground/25 text-center mt-4">Sem ROMs</div>
              ) : (
                <div className="grid grid-cols-2 gap-1">
                  {filteredRoms.map((rom, idx) => {
                    const isFav = favorites.includes(rom);
                    const isSelected = selectedIndex === idx;
                    return (
                      <button key={rom} onClick={() => { setSelectedIndex(idx); handleLaunchGame(rom); }}
                        onMouseEnter={() => setSelectedIndex(idx)}
                        disabled={isLaunching}
                        title={`${displayName(rom)} (${rom})`}
                        className={`h-12 relative rounded overflow-hidden border transition disabled:opacity-50 ${isSelected ? "border-neon-cyan/60 shadow-[0_0_8px_rgba(0,229,255,0.4)]" : "border-white/[0.07] hover:border-neon-cyan/30"}`}>
                        <RomArtCard rom={rom} isFavorite={isFav} compact title={displayName(rom)} />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between px-3 py-1 border-t border-white/[0.06] bg-white/[0.02] font-display text-[6px] flex-shrink-0">
            <span className="text-foreground/25">↑↓ · [ ] \</span>
            {isLaunching && <span className="text-neon-yellow animate-pulse">⏳</span>}
          </div>
        </animated.aside>
      )}

      {launchMsg && (
        <div className={`fixed bottom-[30px] left-3 z-50 px-4 py-2 rounded font-display text-[8px] backdrop-blur-md border ${launchMsg.startsWith("✓") ? "bg-neon-green/10 border-neon-green/30 text-neon-green" : launchMsg.startsWith("✗") ? "bg-red-900/30 border-red-500/30 text-red-300" : "bg-black/50 border-neon-cyan/20 text-neon-yellow"}`}
          style={{ right: sidebarMode === "hidden" ? 16 : sidebarMode === "compact" ? 140 : sidebarMode === "expanded" ? 16 : 256 }}>
          {launchMsg}
        </div>
      )}

      <footer className="fixed bottom-0 left-0 right-0 z-40">
        <div className={`px-4 py-1 flex items-center justify-between ${glass}`}>
          <div className="font-display text-[7px] text-foreground/25">© 2026 MASTER GAMES ARCADE · MAME LAUNCHER ULTIMATE · <span className="text-fuchsia-400/70">dev emerson 2026</span></div>
          {showMameInfo && <span className={`font-display text-[7px] ${mameStatus === "found" ? "text-neon-green animate-blink" : "text-red-400"}`}>{mameStatus === "found" ? "● ONLINE" : "● MAME OFFLINE"}</span>}
        </div>
        <div className="marquee-bar h-[2px] w-full" />
      </footer>

      <FolderBrowser
        open={browser !== null}
        mode={browser === "mame" ? "exe" : "dir"}
        title={browser === "mame" ? "PROCURAR MAME.EXE" : "PROCURAR PASTA DE ROMS"}
        initialPath={browser === "mame" ? configMamePath : configRomsPath}
        backend={BACKEND}
        onClose={() => setBrowser(null)}
        onSelect={(p) => {
          if (browser === "mame") setConfigMamePath(p);
          else setConfigRomsPath(p);
          setBrowser(null);
        }}
      />

      {/* PICKER da pasta de instalação do MAME */}
      <FolderBrowser
        open={installBrowserOpen}
        mode="dir"
        title="ESCOLHER PASTA PARA INSTALAR O MAME"
        initialPath={installDest}
        backend={BACKEND}
        onClose={() => setInstallBrowserOpen(false)}
        onSelect={(p) => { setInstallDest(p); setInstallBrowserOpen(false); }}
      />

      {/* JANELA DE INSTALAÇÃO DO MAME */}
      {installerOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/85 backdrop-blur-sm" onClick={() => !installProgress.active && setInstallerOpen(false)}>
          <div
            className="relative w-[92vw] max-w-xl rounded-lg overflow-hidden border border-neon-yellow/40"
            style={{ boxShadow: "0 0 48px rgba(255,234,0,0.18)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Cabeçalho com a imagem de fundo do sistema */}
            <div
              className="h-32 relative"
              style={{
                backgroundImage: "url('/assets/background.png')",
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
            >
              <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/30 to-black/95" />
              <div className="absolute inset-0 flex flex-col items-center justify-end p-3">
                <div className="font-display text-[10px] text-neon-yellow tracking-[0.3em]" style={{ textShadow: "0 0 12px #ffea00" }}>
                  INSTALADOR MAME · OPEN SOURCE
                </div>
                <div className="font-display text-[7px] text-neon-cyan mt-1 tracking-widest">MASTER GAMES ARCADE</div>
              </div>
              {!installProgress.active && (
                <button onClick={() => setInstallerOpen(false)} className="absolute top-2 right-2 text-white/80 hover:text-white bg-black/40 rounded p-1"><X size={14} /></button>
              )}
            </div>

            <div className="bg-black/95 px-5 py-4 space-y-3">
              <div className="font-body text-[11px] text-foreground/70 leading-snug">
                Vamos baixar a versão mais recente do <span className="text-neon-cyan">MAME</span> direto do GitHub oficial
                (<span className="text-neon-yellow">mamedev/mame</span>) e extrair na pasta escolhida. O sistema vai reconhecer
                automaticamente o <code className="text-neon-cyan">mame.exe</code> e a pasta <code className="text-neon-cyan">roms/</code> — e lembrar para sempre.
              </div>

              <div className="space-y-1">
                <label className="font-display text-[7px] text-neon-cyan block">PASTA DE DESTINO</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={installDest}
                    onChange={(e) => setInstallDest(e.target.value)}
                    disabled={installProgress.active}
                    className="flex-1 px-3 py-1.5 bg-black/40 border border-white/10 text-foreground font-body text-sm rounded focus:outline-none focus:border-neon-yellow/40 disabled:opacity-50"
                    placeholder="C:\MAME"
                  />
                  <button
                    onClick={() => setInstallBrowserOpen(true)}
                    disabled={installProgress.active}
                    className="font-display text-[7px] border border-neon-magenta/40 text-neon-magenta px-3 py-1.5 rounded bg-neon-magenta/5 hover:bg-neon-magenta/15 transition disabled:opacity-40"
                  ><FolderOpen size={9} className="inline mr-1" />PROCURAR</button>
                </div>
              </div>

              {installProgress.active || installProgress.phase === "done" || installProgress.phase === "error" ? (
                <div className="space-y-2 pt-1">
                  <div className="h-2 w-full bg-white/[0.06] rounded overflow-hidden">
                    <div
                      className="h-full transition-all"
                      style={{
                        width: `${installProgress.percent}%`,
                        background: installProgress.phase === "error" ? "#ef4444" : installProgress.phase === "done" ? "#00e676" : "linear-gradient(90deg, #00e5ff, #ffea00)",
                      }}
                    />
                  </div>
                  <div className={`font-display text-[8px] ${installProgress.phase === "error" ? "text-red-400" : installProgress.phase === "done" ? "text-neon-green" : "text-neon-yellow"}`}>
                    {installProgress.phase === "error"
                      ? `✗ ${installProgress.error || "Falhou"}`
                      : installProgress.phase === "done"
                      ? `✓ Instalado em ${installProgress.mamePath}`
                      : `${installProgress.percent}% · ${installProgress.message || installProgress.phase}`}
                  </div>
                </div>
              ) : null}

              <div className="flex gap-2 pt-2 border-t border-white/[0.05]">
                <button
                  onClick={startInstallMame}
                  disabled={installProgress.active || backendStatus !== "ok"}
                  className="flex-1 font-display text-[8px] border border-neon-yellow/50 text-neon-yellow px-4 py-2 rounded bg-neon-yellow/10 hover:bg-neon-yellow/20 transition disabled:opacity-40"
                >
                  {installProgress.active ? "⏳ INSTALANDO..." : installProgress.phase === "done" ? "✓ REINSTALAR" : "⬇ BAIXAR E INSTALAR AGORA"}
                </button>
                <button
                  onClick={() => setInstallerOpen(false)}
                  disabled={installProgress.active}
                  className="font-display text-[8px] border border-white/15 text-white/70 px-4 py-2 rounded hover:bg-white/5 disabled:opacity-40"
                >FECHAR</button>
              </div>

              {backendStatus !== "ok" && (
                <div className="font-display text-[7px] text-red-400">
                  ⚠ Backend offline. Rode <span className="text-neon-yellow">node mame-server.js</span> antes de instalar.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
