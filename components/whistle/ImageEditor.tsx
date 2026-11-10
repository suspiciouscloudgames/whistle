"use client";
import { useLanguage } from "./Language";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { cropBounds, eraseBackground } from "@/lib/image-edit";

const SIZE = 256;
type Point = { x: number; y: number };
type Crop = ReturnType<typeof cropBounds>;
type Snapshot = { pixels: ImageData; original?: string };
export type ImageEditorHandle = {
  export: () => { image: string; originalImage?: string };
};

export const ImageEditor = forwardRef<
  ImageEditorHandle,
  {
    image?: string;
    originalImage?: string;
    onName: (name: string) => void;
    onBusy: (busy: boolean) => void;
  }
>(function ImageEditor({ image, originalImage, onName, onBusy }, ref) {
  const { t } = useLanguage();
  const canvas = useRef<HTMLCanvasElement>(null),
    input = useRef<HTMLInputElement>(null);
  const original = useRef(originalImage ?? image);
  const past = useRef<Snapshot[]>([]),
    future = useRef<Snapshot[]>([]);
  const gesture = useRef<{ start: Point; last: Point; pointer: number } | null>(
    null,
  );
  const ready = useRef(false),
    alive = useRef(true);
  const [tool, setTool] = useState<"draw" | "erase" | "background" | "crop">(
    image ? "crop" : "draw",
  );
  const [color, setColor] = useState("#111111"),
    [brush, setBrush] = useState(8),
    [tolerance, setTolerance] = useState(18);
  const [crop, setCrop] = useState<Crop | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [, refresh] = useState(0);
  const context = () =>
    canvas.current!.getContext("2d", { willReadFrequently: true })!;
  const snapshot = (): Snapshot => ({
    pixels: context().getImageData(0, 0, SIZE, SIZE),
    original: original.current,
  });
  const remember = () => {
    past.current.push(snapshot());
    if (past.current.length > 12) past.current.shift();
    future.current = [];
    refresh((v) => v + 1);
  };
  const restore = (s: Snapshot) => {
    context().putImageData(s.pixels, 0, 0);
    original.current = s.original;
    setCrop(null);
    refresh((v) => v + 1);
  };
  const load = async (src: string) => {
    const im = new Image();
    im.src = src;
    await im.decode();
    return im;
  };
  const fit = (im: CanvasImageSource, width: number, height: number) => {
    const ctx = context(),
      ratio = Math.min(SIZE / width, SIZE / height);
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.drawImage(
      im,
      (SIZE - width * ratio) / 2,
      (SIZE - height * ratio) / 2,
      width * ratio,
      height * ratio,
    );
  };
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    if (!image) {
      ready.current = true;
      return () => {
        alive.current = false;
      };
    }
    onBusy(true);
    setBusy(true);
    void load(image)
      .then((im) => {
        if (!cancelled) {
          fit(im, im.width, im.height);
          ready.current = true;
        }
      })
      .catch(() => {
        if (!cancelled) setError("이미지를 읽을 수 없습니다.");
      })
      .finally(() => {
        if (!cancelled) {
          onBusy(false);
          setBusy(false);
        }
      });
    return () => {
      cancelled = true;
      alive.current = false;
    };
  }, [image, onBusy]);
  const applyCrop = () => {
    if (!crop || crop.width < 2 || crop.height < 2) return;
    remember();
    const cut = document.createElement("canvas");
    cut.width = crop.width;
    cut.height = crop.height;
    cut
      .getContext("2d")!
      .drawImage(
        canvas.current!,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        0,
        0,
        crop.width,
        crop.height,
      );
    fit(cut, crop.width, crop.height);
    setCrop(null);
  };
  useImperativeHandle(ref, () => ({
    export: () => {
      if (!ready.current || busy) throw Error("이미지를 불러오는 중입니다.");
      if (crop) applyCrop();
      const pixels = context().getImageData(0, 0, SIZE, SIZE).data;
      if (!pixels.some((value, i) => i % 4 === 3 && value > 0))
        throw Error("사진이나 그림을 추가하세요.");
      const image = canvas.current!.toDataURL("image/png");
      return {
        image,
        originalImage:
          original.current !== image ? original.current : undefined,
      };
    },
  }));
  const upload = async (file?: File) => {
    if (!file) return;
    if (
      !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
        file.type,
      )
    ) {
      setError("PNG, JPG, WebP, GIF 파일만 가능합니다.");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setError("최대 15MB");
      return;
    }
    setBusy(true);
    onBusy(true);
    setError("");
    const url = URL.createObjectURL(file);
    try {
      const im = await load(url);
      if (!alive.current) return;
      remember();
      fit(im, im.width, im.height);
      original.current = canvas.current!.toDataURL("image/png");
      ready.current = true;
      setCrop(null);
      setTool("crop");
      onName(file.name.replace(/\.[^.]+$/, "").slice(0, 40));
    } catch {
      if (alive.current) setError("이미지를 읽을 수 없습니다.");
    } finally {
      URL.revokeObjectURL(url);
      if (alive.current) {
        setBusy(false);
        onBusy(false);
      }
    }
  };
  const reset = async () => {
    if (!original.current) return;
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      const im = await load(original.current);
      if (!alive.current) return;
      remember();
      fit(im, im.width, im.height);
      setCrop(null);
    } catch {
      if (alive.current) setError("원본을 읽을 수 없습니다.");
    } finally {
      if (alive.current) {
        setBusy(false);
        onBusy(false);
      }
    }
  };
  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(SIZE, ((e.clientX - r.left) * SIZE) / r.width)),
      y: Math.max(0, Math.min(SIZE, ((e.clientY - r.top) * SIZE) / r.height)),
    };
  };
  const stroke = (a: Point, b: Point) => {
    const ctx = context();
    ctx.save();
    ctx.globalCompositeOperation =
      tool === "erase" ? "destination-out" : "source-over";
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = brush;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(b.x, b.y, brush / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  return (
    <div className="image-editor">
      <div className="photo-actions">
        <button disabled={busy} onClick={() => input.current?.click()}>
          {t("사진 불러오기")}
        </button>
        <span />
        <button
          aria-label={t("사진 편집 되돌리기")}
          disabled={busy || !past.current.length}
          onClick={() => {
            future.current.push(snapshot());
            restore(past.current.pop()!);
          }}
        >
          ↶
        </button>
        <button
          aria-label={t("사진 편집 다시 실행")}
          disabled={busy || !future.current.length}
          onClick={() => {
            past.current.push(snapshot());
            restore(future.current.pop()!);
          }}
        >
          ↷
        </button>
        <button
          disabled={busy || !original.current}
          onClick={() => void reset()}
        >
          {t("원본")}
        </button>
      </div>
      <input
        ref={input}
        type="file"
        hidden
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={(e) => {
          void upload(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <div className="photo-canvas-wrap">
        <canvas
          ref={canvas}
          width={SIZE}
          height={SIZE}
          aria-label={t("사진 편집 캔버스")}
          onPointerDown={(e) => {
            if (busy || !ready.current || gesture.current) return;
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            setError("");
            const p = point(e);
            if (tool === "background") {
              const ctx = context(),
                pixels = ctx.getImageData(0, 0, SIZE, SIZE);
              const result = eraseBackground(
                pixels.data,
                SIZE,
                SIZE,
                Math.min(p.x, SIZE - 1),
                Math.min(p.y, SIZE - 1),
                tolerance,
              );
              if (result.some((v, i) => v !== pixels.data[i])) {
                remember();
                pixels.data.set(result);
                ctx.putImageData(pixels, 0, 0);
              }
              return;
            }
            gesture.current = { start: p, last: p, pointer: e.pointerId };
            if (tool === "crop") setCrop(null);
            else {
              remember();
              stroke(p, p);
            }
          }}
          onPointerMove={(e) => {
            const g = gesture.current;
            if (!g || g.pointer !== e.pointerId) return;
            const p = point(e);
            if (tool === "crop") setCrop(cropBounds(g.start, p, SIZE));
            else stroke(g.last, p);
            g.last = p;
          }}
          onPointerUp={() => {
            gesture.current = null;
          }}
          onPointerCancel={() => {
            gesture.current = null;
          }}
          onLostPointerCapture={() => {
            gesture.current = null;
          }}
        />
        {crop && (
          <div
            className="crop-selection"
            style={{
              left: `${(crop.x / SIZE) * 100}%`,
              top: `${(crop.y / SIZE) * 100}%`,
              width: `${(crop.width / SIZE) * 100}%`,
              height: `${(crop.height / SIZE) * 100}%`,
            }}
          />
        )}
        {busy && <div className="photo-busy">{t("불러오는 중")}</div>}
      </div>
      <div
        className="photo-tools"
        role="group"
        aria-label={t("사진 편집 도구")}
      >
        {(
          [
            ["crop", "자르기"],
            ["background", "배경 지우기"],
            ["draw", "그리기"],
            ["erase", "지우개"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            disabled={busy}
            className={tool === id ? "active" : ""}
            aria-pressed={tool === id}
            onClick={() => {
              setTool(id);
              setCrop(null);
              setError("");
            }}
          >
            {t(label)}
          </button>
        ))}
      </div>
      <div className="photo-options">
        {tool === "crop" &&
          (crop && crop.width >= 2 && crop.height >= 2 ? (
            <>
              <button onClick={applyCrop}>{t("자르기 적용")}</button>
              <button onClick={() => setCrop(null)}>{t("취소")}</button>
            </>
          ) : (
            <span>{t("남길 영역을 드래그하세요")}</span>
          ))}
        {tool === "background" && (
          <>
            <span>{t("지울 배경을 누르세요")}</span>
            <label>
              {t("범위")}{" "}
              <input
                aria-label={t("배경 색상 범위")}
                type="range"
                min="0"
                max="100"
                value={tolerance}
                onChange={(e) => setTolerance(Number(e.target.value))}
              />
            </label>
          </>
        )}
        {tool === "draw" && (
          <input
            type="color"
            aria-label={t("붓 색")}
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        )}
        {(tool === "draw" || tool === "erase") && (
          <label>
            {t("굵기")}{" "}
            <input
              aria-label={t("붓 굵기")}
              type="range"
              min="1"
              max="48"
              value={brush}
              onChange={(e) => setBrush(Number(e.target.value))}
            />
          </label>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {t(error)}
        </p>
      )}
    </div>
  );
});
