import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Download, ImagePlus, Trash2 } from "lucide-react";
import JSZip from "jszip";
import {
  JPEG_QUALITY,
  MAX_EDGE,
  MAX_FILES,
  SIZE_GROUPS,
  SIZE_PRESETS,
  bitmapHasAlpha,
  decodeFile,
  exportName,
  formatBytes,
  keepsPng,
  loadPresets,
  outputMime,
  paint,
  plan,
  stemOf,
  storePresets,
  type FitMode,
  type SavedPreset,
} from "@/lib/soroeru";

export const Route = createFileRoute("/")({ component: Home });

type Item = {
  id: string;
  fileName: string;
  status: "ok" | "error";
  message?: string;
  bitmap?: ImageBitmap;
  width: number;
  height: number;
  hasAlpha: boolean;
  mime: string;
  focalX: number;
  focalY: number;
};

const FITS: { id: FitMode; name: string; detail: string; figure: string }[] = [
  { id: "contain", name: "全部入れる", detail: "比率を保って、余白で収める", figure: "fit-contain" },
  { id: "cover", name: "枠いっぱい", detail: "比率を保って、はみ出しを切る", figure: "fit-cover" },
  { id: "stretch", name: "変形してぴったり", detail: "縦横を枠に合わせる", figure: "fit-stretch" },
];

function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [over, setOver] = useState(false);
  const [presetId, setPresetId] = useState("shop");
  const [customW, setCustomW] = useState("1280");
  const [customH, setCustomH] = useState("1280");
  const [fit, setFit] = useState<FitMode>("contain");
  const [stretchAsk, setStretchAsk] = useState(false);
  const [pad, setPad] = useState("#ffffff");
  const [keepTransparency, setKeepTransparency] = useState(false);
  const [noUpscale, setNoUpscale] = useState(false);
  const [quality, setQuality] = useState(JPEG_QUALITY);
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState("");
  const [presetName, setPresetName] = useState("");
  const [saved, setSaved] = useState<SavedPreset[]>([]);
  const [saveNote, setSaveNote] = useState("");

  useEffect(() => {
    setSaved(loadPresets());
  }, []);

  const preset = SIZE_PRESETS.find((item) => item.id === presetId) ?? SIZE_PRESETS[1];
  const customSize = readEdge(customW, customH);
  const width = presetId === "custom" ? customSize.width : preset.width;
  const height = presetId === "custom" ? customSize.height : preset.height;
  const sizeOk = width > 0 && height > 0;
  const ready = items.filter((item) => item.status === "ok");

  const focalKey = items.map((item) => `${item.id}:${item.focalX.toFixed(3)}:${item.focalY.toFixed(3)}`).join("|");

  useEffect(() => {
    if (!sizeOk) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        const next: Record<string, number> = {};
        for (const item of items) {
          if (cancelled) return;
          if (item.status !== "ok" || !item.bitmap) continue;
          const blob = await renderBlob(item, width, height, fit, pad, keepTransparency, noUpscale, quality);
          if (blob) next[item.id] = blob.size;
        }
        if (!cancelled) setSizes(next);
      })();
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [items, focalKey, width, height, fit, pad, keepTransparency, noUpscale, quality, sizeOk]);

  function chooseFit(next: FitMode) {
    if (next === "stretch") {
      setStretchAsk(true);
      return;
    }
    setStretchAsk(false);
    setFit(next);
  }

  async function addFiles(list: FileList | File[]) {
    const incoming = Array.from(list);
    if (!incoming.length) return;
    const room = Math.max(0, MAX_FILES - items.length);
    const accepted = incoming.slice(0, room);
    const overflow = incoming.slice(room);
    const loaded = await Promise.all(accepted.map(loadItem));
    const rejected: Item[] = overflow.map((file) => ({
      id: crypto.randomUUID(),
      fileName: file.name,
      status: "error",
      message: `一度にそろえられるのは${MAX_FILES}枚までです`,
      width: 0,
      height: 0,
      hasAlpha: false,
      mime: file.type,
      focalX: 0.5,
      focalY: 0.5,
    }));
    setItems((current) => [...current, ...loaded, ...rejected]);
  }

  function removeItem(id: string) {
    setItems((current) => {
      const found = current.find((item) => item.id === id);
      found?.bitmap?.close();
      return current.filter((item) => item.id !== id);
    });
  }

  function setFocal(id: string, focalX: number, focalY: number) {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, focalX, focalY } : item)),
    );
  }

  async function downloadOne(item: Item) {
    if (!sizeOk || !item.bitmap) return;
    const blob = await renderBlob(item, width, height, fit, pad, keepTransparency, noUpscale, quality);
    if (!blob) return;
    const ext = blob.type === "image/png" ? "png" : "jpg";
    saveBlob(blob, exportName(stemOf(item.fileName), width, height, indexOf(item), ext));
  }

  async function downloadZip() {
    if (!sizeOk || !ready.length || busy) return;
    setBusy(true);
    try {
      const zip = new JSZip();
      let n = 0;
      for (const item of ready) {
        const blob = await renderBlob(item, width, height, fit, pad, keepTransparency, noUpscale, quality);
        if (!blob) continue;
        n += 1;
        const ext = blob.type === "image/png" ? "png" : "jpg";
        zip.file(exportName(stemOf(item.fileName), width, height, n, ext), blob);
      }
      const packed = await zip.generateAsync({ type: "blob" });
      saveBlob(packed, `soroeru_${width}x${height}.zip`);
    } finally {
      setBusy(false);
    }
  }

  function remember() {
    const name = presetName.trim();
    if (!name || !sizeOk) {
      setSaveNote("名前と、有効な寸法が必要です");
      return;
    }
    const next = saved.filter((item) => item.name !== name);
    next.push({ name, width, height, fit, pad, keepTransparency, noUpscale, presetId });
    setSaved(next);
    storePresets(next);
    setPresetName("");
    setSaveNote(`「${name}」をこの端末に覚えました`);
  }

  function applySaved(item: SavedPreset) {
    const known =
      SIZE_PRESETS.find((preset) => preset.id === item.presetId && preset.id !== "custom") ??
      SIZE_PRESETS.find(
        (preset) => preset.id !== "custom" && preset.width === item.width && preset.height === item.height,
      );
    setPresetId(known?.id ?? "custom");
    setCustomW(String(item.width));
    setCustomH(String(item.height));
    setFit(item.fit);
    setStretchAsk(false);
    setPad(item.pad);
    setKeepTransparency(item.keepTransparency);
    setNoUpscale(item.noUpscale);
    setSaveNote(`「${item.name}」を使っています`);
  }

  function forget(name: string) {
    const next = saved.filter((item) => item.name !== name);
    setSaved(next);
    storePresets(next);
  }

  const sizeHint = presetId === "custom" ? "" : preset.hint;

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-8 sm:px-8 sm:py-12 lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-start">
      <header className="max-w-2xl lg:col-span-2">
        <h1 className="text-4xl font-bold text-fg sm:text-5xl">そろえる</h1>
        <p className="mt-3 text-base text-pretty text-muted sm:text-lg">
          縦横が混じった写真を、同じ大きさにする
        </p>
      </header>

      <div className="flex flex-col gap-8">
      <section
        className={`drop-zone rounded-3xl border border-dashed border-line bg-surface px-5 text-center sm:px-8 ${over ? "is-over" : ""} ${items.length ? "py-5" : "py-10"}`}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          if (event.dataTransfer.files?.length) void addFiles(event.dataTransfer.files);
        }}
      >
        <ImagePlus aria-hidden="true" className="mx-auto size-8 text-fg" strokeWidth={1.5} />
        <p className="mt-3 text-base font-medium text-fg">写真をドロップ、または選択</p>
        <p className="mt-1 text-sm text-muted">スマホでも同じです。一度に{MAX_FILES}枚まで。</p>
        <button
          type="button"
          className="press mt-5 inline-flex min-h-11 items-center justify-center rounded-full bg-fg px-5 text-sm font-medium text-surface"
          onClick={() => inputRef.current?.click()}
        >
          画像を選ぶ
        </button>
        <input
          ref={inputRef}
          className="sr-only"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          onChange={(event) => {
            if (event.target.files) void addFiles(event.target.files);
            event.target.value = "";
          }}
        />
        <p className="mx-auto mt-5 max-w-lg text-sm text-pretty text-muted">
          画像はこのブラウザの中だけで変換します。サーバへは送りません。
        </p>
      </section>

      <section id="sizes" aria-label="目的のサイズ" className="flex flex-col gap-4">
        <h2 className="text-sm font-medium text-fg">どこに出す？</h2>
        {SIZE_GROUPS.map((group) => (
          <div key={group.id} className="flex flex-col gap-2">
            <h3 className="text-sm text-muted">{group.label}</h3>
            <div className="grid grid-cols-2 gap-2">
              {SIZE_PRESETS.filter((item) => item.group === group.id).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="choice press min-h-11 rounded-2xl border border-line bg-surface px-3 py-2 text-left"
                  aria-pressed={presetId === item.id}
                  onClick={() => setPresetId(item.id)}
                >
                  <span className="block text-sm font-medium">{item.service}</span>
                  <span className="block text-sm tabular-nums opacity-80">
                    {item.detail} {item.width}×{item.height}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
        <button
          type="button"
          className="choice press min-h-11 rounded-2xl border border-line bg-surface px-3 py-2 text-left text-sm font-medium"
          aria-pressed={presetId === "custom"}
          onClick={() => setPresetId("custom")}
        >
          自分で指定
        </button>
        {presetId === "custom" ? (
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm text-muted">
              幅
              <input
                inputMode="numeric"
                value={customW}
                onChange={(event) => setCustomW(event.target.value)}
                className="min-h-11 w-28 rounded-xl border border-line bg-surface px-3 text-base text-fg"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-muted">
              高さ
              <input
                inputMode="numeric"
                value={customH}
                onChange={(event) => setCustomH(event.target.value)}
                className="min-h-11 w-28 rounded-xl border border-line bg-surface px-3 text-base text-fg"
              />
            </label>
            {!sizeOk ? <p className="pb-3 text-sm text-accent">1から{MAX_EDGE}の整数で指定してください</p> : null}
          </div>
        ) : null}
        <p className="text-sm text-pretty text-muted">
          {sizeHint ? `${sizeHint} ` : null}
          サイズは目安です。提出先の最新の案内を確認してください。このツールは各サービスの公式機能ではありません。
        </p>
      </section>

      <section aria-label="そろえ方" className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-fg">そろえ方</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          {FITS.map((item) => (
            <button
              key={item.id}
              type="button"
              className="choice press flex min-h-11 items-center gap-3 rounded-2xl border border-line bg-surface px-3 py-3 text-left"
              aria-pressed={fit === item.id}
              onClick={() => chooseFit(item.id)}
            >
              <span className={`fit-figure ${item.figure}`} aria-hidden="true">
                <i />
              </span>
              <span>
                <span className="block text-sm font-medium">{item.name}</span>
                <span className="block text-sm opacity-80">{item.detail}</span>
              </span>
            </button>
          ))}
        </div>
        {stretchAsk ? (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3">
            <p className="text-sm text-fg">縦横が歪みます</p>
            <button
              type="button"
              className="press min-h-11 rounded-full bg-fg px-4 text-sm font-medium text-surface"
              onClick={() => {
                setFit("stretch");
                setStretchAsk(false);
              }}
            >
              このまま適用
            </button>
            <button
              type="button"
              className="press min-h-11 rounded-full border border-line px-4 text-sm"
              onClick={() => setStretchAsk(false)}
            >
              やめる
            </button>
          </div>
        ) : null}
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
        <label className="flex min-h-11 items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-sm">
          <span>余白の色</span>
          <input
            type="color"
            value={pad}
            aria-label="余白の色"
            onChange={(event) => setPad(event.target.value)}
            className="size-11 cursor-pointer border-0 bg-transparent p-0"
          />
        </label>
        <label className="flex min-h-11 items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-sm">
          <input
            type="checkbox"
            checked={keepTransparency}
            onChange={(event) => setKeepTransparency(event.target.checked)}
          />
          PNGの透明を残す
        </label>
        <label className="flex min-h-11 items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-sm">
          <input type="checkbox" checked={noUpscale} onChange={(event) => setNoUpscale(event.target.checked)} />
          拡大しない
        </label>
        <label className="flex min-h-11 flex-col justify-center gap-2 rounded-2xl border border-line bg-surface px-4 py-3 text-sm">
          <span className="flex items-center justify-between">
            JPEG品質
            <span className="tabular-nums">{Math.round(quality * 100)}</span>
          </span>
          <input
            type="range"
            min={60}
            max={100}
            value={Math.round(quality * 100)}
            onChange={(event) => setQuality(Number(event.target.value) / 100)}
          />
        </label>
      </section>
      </div>

      <div className="flex flex-col gap-8">
      {items.length ? (
        <section aria-label="完成予定" className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-medium text-fg">完成予定</h2>
            <p className="text-sm text-muted">{ready.length}枚</p>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2">
            {items.map((item) => (
              <li key={item.id} className="overflow-hidden rounded-3xl border border-line bg-surface">
                {item.status === "ok" && item.bitmap && sizeOk ? (
                  <Preview
                    item={item}
                    width={width}
                    height={height}
                    fit={fit}
                    pad={pad}
                    keepTransparency={keepTransparency}
                    noUpscale={noUpscale}
                    bytes={sizes[item.id]}
                    onFocal={(x, y) => setFocal(item.id, x, y)}
                  />
                ) : (
                  <div className="flex min-h-40 items-center px-4 py-6">
                    <p className="text-sm text-pretty text-accent">{item.message}</p>
                  </div>
                )}
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <p className="min-w-0 truncate text-sm text-fg">{item.fileName}</p>
                  <div className="flex shrink-0 items-center gap-1">
                    {item.status === "ok" ? (
                      <button
                        type="button"
                        className="press inline-flex size-11 items-center justify-center rounded-full"
                        aria-label={`${item.fileName}を保存`}
                        onClick={() => void downloadOne(item)}
                      >
                        <Download aria-hidden="true" className="size-5" strokeWidth={1.75} />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="press inline-flex size-11 items-center justify-center rounded-full"
                      aria-label={`${item.fileName}を外す`}
                      onClick={() => removeItem(item.id)}
                    >
                      <Trash2 aria-hidden="true" className="size-5" strokeWidth={1.75} />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            className="press inline-flex min-h-12 items-center justify-center rounded-full bg-fg px-6 text-sm font-medium text-surface disabled:opacity-40"
            disabled={!ready.length || !sizeOk || busy}
            onClick={() => void downloadZip()}
          >
            {busy ? "書き出しています" : "ZIPで書き出す"}
          </button>
          <button
            type="button"
            className="press inline-flex min-h-12 items-center justify-center rounded-full border border-line bg-surface px-6 text-sm font-medium"
            onClick={() => {
              setHint("いまのそろえ方・余白・拡大しない、を引き継ぎます。別のサイズを選んで、もう一度書き出してください。");
              document.getElementById("sizes")?.scrollIntoView({ behavior: "smooth", block: "center" });
            }}
          >
            もう一つのサイズも作る
          </button>
        </div>
        <p className="text-sm text-muted" role="status">
          {hint}
        </p>
        <p className="text-sm text-pretty text-muted">元のファイルはそのままです。落ちてくるのは変換した画像だけです。</p>
        <p className="text-sm text-pretty text-muted">自分が使ってよい画像だけを入れてください。</p>
      </section>
      </div>

      <section aria-label="覚えた設定" className="flex flex-col gap-3 border-t border-line pt-6 lg:col-span-2">
        <h2 className="text-sm font-medium text-fg">この設定を端末に覚える</h2>
        <p className="text-sm text-muted">寸法、そろえ方、余白、拡大しない、だけを保存します。画像は保存しません。</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={presetName}
            onChange={(event) => setPresetName(event.target.value)}
            placeholder="例: ショップ正方形"
            className="min-h-11 flex-1 rounded-xl border border-line bg-surface px-3 text-base"
          />
          <button
            type="button"
            className="press min-h-11 rounded-full border border-line bg-surface px-5 text-sm font-medium"
            onClick={remember}
          >
            覚える
          </button>
        </div>
        {saveNote ? <p className="text-sm text-muted">{saveNote}</p> : null}
        {saved.length ? (
          <ul className="flex flex-col gap-2">
            {saved.map((item) => (
              <li key={item.name} className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-3 py-2">
                <button type="button" className="min-h-11 flex-1 text-left text-sm font-medium" onClick={() => applySaved(item)}>
                  {item.name}
                  <span className="ml-2 tabular-nums text-muted">
                    {item.width}×{item.height}
                  </span>
                </button>
                <button type="button" className="min-h-11 px-2 text-sm text-muted" onClick={() => forget(item.name)}>
                  消す
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );

  function indexOf(item: Item) {
    return ready.findIndex((candidate) => candidate.id === item.id) + 1;
  }
}

function Preview({
  item,
  width,
  height,
  fit,
  pad,
  keepTransparency,
  noUpscale,
  bytes,
  onFocal,
}: {
  item: Item;
  width: number;
  height: number;
  fit: FitMode;
  pad: string;
  keepTransparency: boolean;
  noUpscale: boolean;
  bytes?: number;
  onFocal: (x: number, y: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; fx: number; fy: number } | null>(null);
  const placement = useMemo(
    () => plan(item.width, item.height, width, height, fit, noUpscale, item.focalX, item.focalY),
    [item.width, item.height, item.focalX, item.focalY, width, height, fit, noUpscale],
  );
  const transparent = keepsPng(item.mime, item.hasAlpha, keepTransparency);
  const long = Math.max(width, height);
  const previewW = Math.max(1, Math.round((width / long) * 640));
  const previewH = Math.max(1, Math.round((height / long) * 640));

  useEffect(() => {
    const canvas = canvasRef.current;
    const bitmap = item.bitmap;
    if (!canvas || !bitmap) return;
    canvas.width = previewW;
    canvas.height = previewH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    paint(ctx, bitmap, placement, previewW, previewH, width, height, pad, transparent);
  }, [item.bitmap, placement, previewW, previewH, width, height, pad, transparent]);

  function move(clientX: number, clientY: number, rect: DOMRect) {
    const origin = drag.current;
    if (!origin) return;
    const dx = (clientX - origin.x) / rect.width;
    const dy = (clientY - origin.y) / rect.height;
    onFocal(clamp01(origin.fx - dx), clamp01(origin.fy - dy));
  }

  return (
    <div>
      <div
        className={`preview-frame relative ${placement.cropsALot ? "can-pan" : ""}`}
        style={{ aspectRatio: `${width} / ${height}` }}
        onPointerDown={(event) => {
          if (!placement.cropsALot) return;
          drag.current = { x: event.clientX, y: event.clientY, fx: item.focalX, fy: item.focalY };
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            // Capture can fail for a pointer the browser does not consider active.
          }
        }}
        onPointerMove={(event) => move(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect())}
        onPointerUp={() => {
          drag.current = null;
        }}
        onKeyDown={(event) => {
          if (!placement.cropsALot) return;
          const step = 0.04;
          if (event.key === "ArrowLeft") onFocal(clamp01(item.focalX - step), item.focalY);
          if (event.key === "ArrowRight") onFocal(clamp01(item.focalX + step), item.focalY);
          if (event.key === "ArrowUp") onFocal(item.focalX, clamp01(item.focalY - step));
          if (event.key === "ArrowDown") onFocal(item.focalX, clamp01(item.focalY + step));
        }}
        tabIndex={placement.cropsALot ? 0 : undefined}
        role={placement.cropsALot ? "application" : undefined}
        aria-label={placement.cropsALot ? "切り抜き位置。ドラッグでこの枚だけ動かせます" : undefined}
      >
        <canvas ref={canvasRef} />
        {placement.cropsALot ? (
          <span className="warn-pill absolute top-3 left-3 rounded-full px-3 py-1 text-sm">端が切れます</span>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 pt-3 text-sm">
        <p className="tabular-nums text-fg">
          {width} × {height}
        </p>
        <p className="tabular-nums text-muted">{bytes === undefined ? "容量を計算中" : `約 ${formatBytes(bytes)}`}</p>
        {placement.upscaled && !noUpscale ? <p className="text-muted">細部は増えません</p> : null}
        {placement.cropsALot ? <p className="text-muted">指でずらす</p> : null}
      </div>
      <p className="px-4 pt-1 text-sm tabular-nums text-muted">
        元 {item.width} × {item.height}
      </p>
    </div>
  );
}

async function loadItem(file: File): Promise<Item> {
  const base = {
    id: crypto.randomUUID(),
    fileName: file.name || "image",
    focalX: 0.5,
    focalY: 0.5,
    width: 0,
    height: 0,
    hasAlpha: false,
    mime: file.type || "application/octet-stream",
  };
  const looksImage = file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(file.name);
  if (!looksImage) {
    return { ...base, status: "error", message: "この形式は読めません" };
  }
  try {
    const bitmap = await decodeFile(file);
    if (bitmap.width < 1 || bitmap.height < 1) {
      bitmap.close();
      return { ...base, status: "error", message: "画像が壊れています" };
    }
    const mime = file.type === "image/jpg" ? "image/jpeg" : file.type || guessMime(file.name);
    const hasAlpha = mime === "image/jpeg" ? false : bitmapHasAlpha(bitmap);
    return { ...base, status: "ok", bitmap, width: bitmap.width, height: bitmap.height, hasAlpha, mime };
  } catch {
    return { ...base, status: "error", message: "画像が壊れています" };
  }
}

function guessMime(name: string) {
  if (/\.png$/i.test(name)) return "image/png";
  if (/\.webp$/i.test(name)) return "image/webp";
  if (/\.gif$/i.test(name)) return "image/gif";
  return "image/jpeg";
}

function readEdge(rawW: string, rawH: string) {
  const width = Number(rawW);
  const height = Number(rawH);
  if (!Number.isInteger(width) || !Number.isInteger(height)) return { width: 0, height: 0 };
  if (width < 1 || height < 1 || width > MAX_EDGE || height > MAX_EDGE) return { width: 0, height: 0 };
  return { width, height };
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

async function renderBlob(
  item: Item,
  width: number,
  height: number,
  fit: FitMode,
  pad: string,
  keepTransparency: boolean,
  noUpscale: boolean,
  quality: number,
) {
  if (!item.bitmap) return null;
  const placement = plan(item.width, item.height, width, height, fit, noUpscale, item.focalX, item.focalY);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const transparent = keepsPng(item.mime, item.hasAlpha, keepTransparency);
  paint(ctx, item.bitmap, placement, width, height, width, height, pad, transparent);
  const type = outputMime(item.mime, item.hasAlpha, keepTransparency);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  return blob;
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
