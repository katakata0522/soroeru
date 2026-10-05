export const MAX_FILES = 24;
export const MAX_EDGE = 4096;
export const JPEG_QUALITY = 0.85;
const CROP_FLAG = 0.08;

export type FitMode = "contain" | "cover" | "stretch";

export type SizePreset = {
  id: string;
  group: "sns" | "write" | "shop" | "custom";
  service: string;
  detail: string;
  width: number;
  height: number;
  hint: string;
};

export const SIZE_GROUPS: { id: SizePreset["group"]; label: string }[] = [
  { id: "sns", label: "SNS" },
  { id: "write", label: "文章" },
  { id: "shop", label: "ショップ" },
];

export const SIZE_PRESETS: SizePreset[] = [
  {
    id: "ig-square",
    group: "sns",
    service: "Instagram",
    detail: "正方形",
    width: 1080,
    height: 1080,
    hint: "Metaのフィード案内は、一辺1080以上です。",
  },
  {
    id: "ig-portrait",
    group: "sns",
    service: "Instagram",
    detail: "縦長",
    width: 1080,
    height: 1350,
    hint: "フィードの推奨比率は4:5です。短い辺を1080にするとこの大きさです。",
  },
  {
    id: "ig-story",
    group: "sns",
    service: "Instagram",
    detail: "ストーリー",
    width: 1080,
    height: 1920,
    hint: "ストーリーズ広告の推奨解像度は1080×1920です。",
  },
  {
    id: "ig-reel",
    group: "sns",
    service: "Instagram",
    detail: "リール",
    width: 1440,
    height: 2560,
    hint: "リール広告の推奨解像度は1440×2560です。ストーリーとは別です。",
  },
  {
    id: "x-post",
    group: "sns",
    service: "X",
    detail: "投稿",
    width: 1080,
    height: 1080,
    hint: "投稿画像に公式のピクセル指定はありません。2:1から3:4なら全体表示です。この1080は広告仕様の正方形です。",
  },
  {
    id: "x-header",
    group: "sns",
    service: "X",
    detail: "ヘッダー",
    width: 1500,
    height: 500,
    hint: "公式ヘルプのヘッダー推奨は1500×500です。上下が少し隠れることがあります。",
  },
  {
    id: "youtube",
    group: "sns",
    service: "YouTube",
    detail: "サムネイル",
    width: 3840,
    height: 2160,
    hint: "現在のヘルプの推奨は3840×2160、比率16:9です。最小幅は640。スマホからの登録は2MB未満です。",
  },
  {
    id: "youtube-short",
    group: "sns",
    service: "YouTube",
    detail: "ショート",
    width: 2160,
    height: 3840,
    hint: "ショートの推奨は2160×3840、比率9:16です。",
  },
  {
    id: "note",
    group: "write",
    service: "note",
    detail: "見出し",
    width: 1280,
    height: 670,
    hint: "noteヘルプの見出し画像の推奨は1280×670です。",
  },
  {
    id: "facebook",
    group: "write",
    service: "Facebook",
    detail: "シェア",
    width: 1200,
    height: 630,
    hint: "共有画像は1200×630以上、比率は1.91:1に近づける、と案内されています。ブログ全般の規格ではありません。",
  },
  {
    id: "mercari",
    group: "shop",
    service: "メルカリ",
    detail: "正方形",
    width: 720,
    height: 720,
    hint: "公式コラムでは、正方形で720×720程度が基本とされています。ヘルプにピクセル指定はありません。",
  },
  {
    id: "shop",
    group: "shop",
    service: "minne",
    detail: "正方形",
    width: 1280,
    height: 1280,
    hint: "公式案内は、一辺1280以上の正方形です。",
  },
  {
    id: "base",
    group: "shop",
    service: "BASE",
    detail: "正方形",
    width: 1280,
    height: 1280,
    hint: "公式ヘルプの推奨は1280×1280です。Pay IDアプリでは正方形に調整されます。",
  },
  { id: "custom", group: "custom", service: "自分で指定", detail: "幅と高さ", width: 0, height: 0, hint: "" },
];

export type Placement = {
  dx: number;
  dy: number;
  drawnW: number;
  drawnH: number;
  upscaled: boolean;
  cropsALot: boolean;
};

export function plan(
  srcW: number,
  srcH: number,
  outW: number,
  outH: number,
  fit: FitMode,
  noUpscale: boolean,
  focalX: number,
  focalY: number,
): Placement {
  let sx: number;
  let sy: number;
  if (fit === "stretch") {
    sx = outW / srcW;
    sy = outH / srcH;
  } else if (fit === "contain") {
    const s = Math.min(outW / srcW, outH / srcH);
    sx = s;
    sy = s;
  } else {
    const s = Math.max(outW / srcW, outH / srcH);
    sx = s;
    sy = s;
  }
  const upscaled = sx > 1.001 || sy > 1.001;
  if (noUpscale) {
    sx = Math.min(sx, 1);
    sy = Math.min(sy, 1);
  }
  const drawnW = srcW * sx;
  const drawnH = srcH * sy;
  const fx = fit === "cover" ? focalX : 0.5;
  const fy = fit === "cover" ? focalY : 0.5;
  const dx = (outW - drawnW) * fx;
  const dy = (outH - drawnH) * fy;
  const cropX = drawnW > outW + 0.5 ? (drawnW - outW) / drawnW : 0;
  const cropY = drawnH > outH + 0.5 ? (drawnH - outH) / drawnH : 0;
  return {
    dx,
    dy,
    drawnW,
    drawnH,
    upscaled,
    cropsALot: fit === "cover" && Math.max(cropX, cropY) > CROP_FLAG,
  };
}

export function keepsPng(mime: string, hasAlpha: boolean, keepTransparency: boolean) {
  return mime === "image/png" && hasAlpha && keepTransparency;
}

export function outputMime(mime: string, hasAlpha: boolean, keepTransparency: boolean) {
  return keepsPng(mime, hasAlpha, keepTransparency) ? "image/png" : "image/jpeg";
}

export function paint(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  placement: Placement,
  destW: number,
  destH: number,
  outW: number,
  outH: number,
  pad: string,
  transparent: boolean,
) {
  const k = destW / outW;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, destW, destH);
  if (!transparent) {
    ctx.fillStyle = pad;
    ctx.fillRect(0, 0, destW, destH);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, placement.dx * k, placement.dy * k, placement.drawnW * k, placement.drawnH * k);
}

export function stemOf(filename: string) {
  const base = filename.split(/[/\\]/).pop() ?? "image";
  const dot = base.lastIndexOf(".");
  const raw = dot > 0 ? base.slice(0, dot) : base;
  const cleaned = raw.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim() || "image";
  return cleaned.slice(0, 80);
}

export function exportName(stem: string, width: number, height: number, index: number, ext: string) {
  return `${stem}_${width}x${height}_${String(index).padStart(2, "0")}.${ext}`;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 10 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export type SavedPreset = {
  name: string;
  width: number;
  height: number;
  fit: FitMode;
  pad: string;
  keepTransparency: boolean;
  noUpscale: boolean;
  presetId?: string;
};

const STORAGE_KEY = "soroeru.presets.v1";

export function loadPresets(): SavedPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedPreset[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item.name === "string" && item.width > 0);
  } catch {
    return [];
  }
}

export function storePresets(presets: SavedPreset[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

export async function decodeFile(file: File) {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = "async";
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("decode"));
        img.src = url;
      });
      return await createImageBitmap(img);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

export function bitmapHasAlpha(bitmap: ImageBitmap) {
  const w = Math.min(80, bitmap.width);
  const h = Math.min(80, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(bitmap, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 250) return true;
  }
  return false;
}
