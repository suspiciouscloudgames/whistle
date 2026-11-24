"use client";
import { PresentationControls } from "./PresentationControls";
import { useLanguage, userErrorMessage } from "./Language";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  uid,
  MAX_TEXT_LENGTH,
  type Asset,
  type Shape,
  type Rule,
  type World,
} from "@/lib/world";
import { ImageEditor, type ImageEditorHandle } from "./ImageEditor";
import { ObjectArt } from "./Art";
import { textImage } from "@/lib/text-image";
export function Dialog({
  title,
  heading,
  children,
  onClose,
  className = "",
}: {
  title: string;
  heading?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const { t } = useLanguage();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog ${className}`}
      aria-label={title}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog-inner">
        <header className="dialog-heading">
          {heading ?? <h2>{title}</h2>}
          <button
            className="dialog-close"
            aria-label={t("닫기")}
            onClick={onClose}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="m4 4 8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.4"
              />
            </svg>
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
const shapeNames: Partial<Record<Shape, string>> = {
  sphere: "원",
  box: "사각형",
  cone: "삼각형",
  diamond: "마름모",
  ring: "고리",
  bar: "선",
};
export function MakerActions({ onSave, disabled, onDelete, deleteLabel, deleteDisabled = false }: {
  onSave: () => void;
  disabled: boolean;
  onDelete?: () => void;
  deleteLabel: string;
  deleteDisabled?: boolean;
}) {
  const { t } = useLanguage();
  return <div className="dialog-footer">
    {onDelete && <button type="button" disabled={deleteDisabled} onClick={onDelete}>{t(deleteLabel)}</button>}
    <button type="button" className="primary" disabled={disabled} onClick={onSave}>{t("저장")}</button>
  </div>;
}
export function AssetMaker({
  asset: existing,
  contentType,
  onSave,
  onClose,
  onDelete,
  deleteDisabled,
  placement: editingPlacement = false,
}: {
  asset?: Asset;
  contentType?: "image" | "text";
  onSave: (a: Asset) => void;
  onClose: () => void;
  onDelete?: () => void;
  deleteDisabled?: boolean;
  placement?: boolean;
}) {
  const { t } = useLanguage();
  const [shape, setShape] = useState<Shape>(
    existing?.shape === "image" ? "sphere" : (existing?.shape ?? "sphere"),
  );
  const [name, setName] = useState(existing?.name ?? "");
  const [mediaType, setMediaType] = useState<"image" | "text">(contentType ?? (existing?.text !== undefined ? "text" : "image"));
  const [text, setText] = useState(existing?.text ?? "");
  const [textColor, setTextColor] = useState(existing?.textColor ?? "#111111");
  const [scale, setScale] = useState(existing?.defaultScale ?? 1);
  const [placement, setPlacement] = useState<"upright" | "floating" | "surface">(existing?.placement === "field" ? "surface" : existing?.placement ?? "upright");
  const [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const editor = useRef<ImageEditorHandle>(null);
  const asset: Asset = {
    id: existing?.id ?? "preview",
    name: name || shapeNames[shape] || "무제",
    shape,
    color: existing?.color ?? "#111111",
    solid: false,
    defaultScale: scale,
    placement,
  };
  const save = () => {
    try {
      const media = mediaType === "text"
        ? { text, textColor, image: textImage(text, textColor) }
        : editor.current?.export();
      if (!media) return;
      onSave({
        ...asset,
        id: existing?.id ?? uid(),
        name: name.trim() || shapeNames[shape] || "무제",
        ...media,
      });
    } catch (e) {
      setError(userErrorMessage(e, "저장할 수 없습니다."));
    }
  };
  return (
    <Dialog className="maker-dialog" title={t(mediaType === "image" ? "이미지" : "텍스트")} onClose={onClose}
      heading={contentType ? undefined : <div className="media-tabs" role="group" aria-label={t("이미지 또는 텍스트")}>
        {(["image", "text"] as const).map((kind) => <button key={kind}
          aria-pressed={mediaType === kind}
          onClick={() => { setMediaType(kind); setError(""); }}>
          {t(kind === "image" ? "이미지" : "텍스트")}
        </button>)}
      </div>}>

      {!contentType && <div className="shape-options" role="group" aria-label={t("기호")}>
        {(["sphere", "box", "cone", "diamond", "ring", "bar"] as Shape[]).map(
          (s) => (
            <button
              key={s}
              aria-label={t(shapeNames[s] ?? "무제")}
              aria-pressed={shape === s}
              className={shape === s ? "active" : ""}
              onClick={() => setShape(s)}
            >
              <ObjectArt asset={{ ...asset, shape: s }} />
            </button>
          ),
        )}
      </div>}
      <div hidden={mediaType !== "image"}>
      <ImageEditor
        ref={editor}
        image={existing?.image}
        originalImage={existing?.originalImage}
        onName={setName}
        onBusy={setLoading}
      />
      </div>
      {mediaType === "text" && <div className="text-object-editor">
        <div className="text-object-actions">
          <label className="text-color-control">
            <input type="color" aria-label={t("글자 색")} value={textColor} onChange={e => setTextColor(e.target.value)} />
          </label>
          <span id="text-length">{text.length.toLocaleString()} / {MAX_TEXT_LENGTH.toLocaleString()}</span>
        </div>
        <textarea className="text-object-input" style={{ color: textColor }}
          aria-label={t("텍스트 입력")} placeholder={t("텍스트 입력")}
          aria-describedby="text-length"
          aria-invalid={text.length > MAX_TEXT_LENGTH}
          value={text}
          onChange={(e) => { setText(e.target.value); setError(""); }} />
        {text.length > MAX_TEXT_LENGTH && <p className="error" role="alert">{t("텍스트가 10,000자를 초과했습니다.")}</p>}
      </div>}
      <div className="asset-options-row">
        <SizeOptions compact value={scale} onChange={setScale} />
        <PresentationControls placement={placement} onPlacement={setPlacement} />
      </div>
      {error && (
        <p className="error" role="alert">
          {t(error)}
        </p>
      )}
      <MakerActions onSave={save} onDelete={onDelete} deleteDisabled={deleteDisabled}
        deleteLabel={editingPlacement ? "배치 삭제" : mediaType === "image" ? "이미지 삭제" : "텍스트 삭제"}
        disabled={mediaType === "image" ? loading : !text.trim() || text.length > MAX_TEXT_LENGTH} />
    </Dialog>
  );
}
export function SizeOptions({
  value,
  onChange,
  compact = false,
}: {
  compact?: boolean;
  value: number;
  onChange: (value: number) => void;
}) {
  const { t } = useLanguage();
  return (
    <fieldset className={`size-options ${compact ? "asset-size-options" : ""}`}>
      <legend>{t("크기")}</legend>
      <div>
        {(
          [
            [0.5, "작게"],
            [1, "중간"],
            [2, "크게"],
            [3, "아주 크게"],
          ] as const
        ).map(([scale, label]) => (
          <button
            key={scale}
            type="button"
            aria-pressed={value === scale}
            aria-label={t(label)}
            onClick={() => onChange(scale)}
          >
            {t(label)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
export function RuleMaker({
  world,
  rule,
  onSave,
  onClose,
}: {
  world: World;
  rule?: Rule;
  onSave: (r: Rule) => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [r, setR] = useState<Rule>(
    rule ?? {
      id: uid(),
      subject: world.assets[0].id,
      trigger: "gaze",
      source: "*",
      token: "a",
      radius: 2,
      action: "mark",
      result: "a",
      replacement: world.assets[0].id,
      enabled: true,
    },
  );
  const update = (p: Partial<Rule>) => setR({ ...r, ...p });
  const options = (
    <>
      <option value="*">{t("전체")}</option>
      {world.assets.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </>
  );
  return (
    <Dialog title={t("규칙")} onClose={onClose}>
      <div className="rule-form">
        <label className="field">
          {t("대상")}
          <select
            value={r.subject}
            onChange={(e) => update({ subject: e.target.value })}
          >
            {options}
          </select>
        </label>
        <label className="field">
          {t("조건")}
          <select
            value={r.trigger}
            onChange={(e) =>
              update({ trigger: e.target.value as Rule["trigger"] })
            }
          >
            <option value="gaze">{t("바라보기")}</option>
            <option value="approach">{t("접근")}</option>
            <option value="marked">{t("표시")}</option>
            <option value="neighbor">{t("표시된 이웃")}</option>
          </select>
        </label>
      </div>
      {["marked", "neighbor"].includes(r.trigger) && (
        <label className="field">
          {t("표시")}
          <input
            value={r.token}
            maxLength={20}
            onChange={(e) => update({ token: e.target.value })}
          />
        </label>
      )}
      {r.trigger === "neighbor" && (
        <label className="field">
          {t("이웃")}
          <select
            value={r.source}
            onChange={(e) => update({ source: e.target.value })}
          >
            {options}
          </select>
        </label>
      )}
      {r.trigger !== "marked" && (
        <label className="field inline-field">
          {t("거리")}
          <input
            type="number"
            min=".5"
            max="6"
            step=".1"
            value={r.radius}
            onChange={(e) => update({ radius: Number(e.target.value) })}
          />
        </label>
      )}
      <div className="form-divider">→</div>
      <label className="field">
        {t("변화")}
        <select
          value={r.action}
          onChange={(e) =>
            update({
              action: e.target.value as Rule["action"],
              replacement: r.replacement || world.assets[0].id,
            })
          }
        >
          <option value="mark">{t("표시 추가")}</option>
          <option value="change">{t("다른 도형")}</option>
          <option value="move">{t("한 칸 이동")}</option>
          <option value="disappear">{t("제거")}</option>
          <option value="sound">{t("소리")}</option>
        </select>
      </label>
      {r.action === "mark" && (
        <label className="field">
          {t("표시")}
          <input
            value={r.result}
            maxLength={20}
            onChange={(e) => update({ result: e.target.value })}
          />
        </label>
      )}
      {r.action === "change" && (
        <label className="field">
          {t("도형")}
          <select
            value={r.replacement}
            onChange={(e) => update({ replacement: e.target.value })}
          >
            {world.assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="dialog-footer">
        <button
          className="primary"
          disabled={
            r.radius < 0.5 ||
            r.radius > 6 ||
            !Number.isFinite(r.radius) ||
            (r.action === "mark" && !r.result.trim()) ||
            (["marked", "neighbor"].includes(r.trigger) && !r.token.trim())
          }
          onClick={() =>
            onSave({ ...r, token: r.token.trim(), result: r.result.trim() })
          }
        >
          {t("저장")}
        </button>
      </div>
    </Dialog>
  );
}
