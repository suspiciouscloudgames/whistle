"use client";
import { useEffect, useRef, useState } from "react";
import { Dialog, MakerActions } from "./Dialogs";
import { useLanguage, userErrorMessage } from "./Language";
import { uid, type Asset } from "@/lib/world";
import { readRecording, type Recording } from "@/lib/audio/recording";

const timeLabel = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export function SoundMaker({ asset, defaultName, onSave, onClose, onDelete, deleteDisabled, placement = false }: {
  asset?: Asset; defaultName: string; onSave: (asset: Asset) => void; onClose: () => void; onDelete?: () => void; placement?: boolean;
  deleteDisabled?: boolean;
}) {
  const { t } = useLanguage();
  const [name, setName] = useState((asset?.name || defaultName).slice(0, 12));
  const [clip, setClip] = useState(asset?.sound);
  const [volume, setVolume] = useState(asset?.sound?.volume ?? 0.7);
  const [mode, setMode] = useState<Recording["mode"]>(asset?.sound?.mode ?? "loop");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [listening, setListening] = useState(false), [position, setPosition] = useState(0);
  const request = useRef(0);
  const uploadController = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const preview = useRef<HTMLAudioElement>(null);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showError = (message: string) => {
    if (errorTimer.current) clearTimeout(errorTimer.current);
    setError(message);
    errorTimer.current = setTimeout(() => setError(""), 4000);
  };
  useEffect(() => () => {
    if (errorTimer.current) clearTimeout(errorTimer.current);
  }, []);
  useEffect(() => {
    const pause = () => preview.current?.pause();
    const hidden = () => { if (document.hidden) pause(); };
    window.addEventListener("blur", pause);
    document.addEventListener("visibilitychange", hidden);
    return () => { request.current++; uploadController.current?.abort(); pause(); window.removeEventListener("blur", pause); document.removeEventListener("visibilitychange", hidden); };
  }, []);
  useEffect(() => { if (preview.current) preview.current.volume = volume; }, [volume, clip]);
  useEffect(() => {
    const audio = preview.current;
    return () => audio?.pause();
  }, [clip?.data]);
  const upload = async (file?: File) => {
    if (!file) return;
    const generation = ++request.current;
    uploadController.current?.abort();
    uploadController.current = new AbortController();
    preview.current?.pause(); setBusy(true); setError("");
    try {
      const result = await readRecording(file, uploadController.current.signal);
      if (generation !== request.current) return;
      setClip({ ...result, volume, mode });
      setPosition(0); setListening(false);
    } catch (error) {
      if (generation === request.current) showError(userErrorMessage(error, "사운드 파일을 읽을 수 없습니다."));
    } finally { if (generation === request.current) setBusy(false); }
  };
  const listen = async () => {
    const audio = preview.current;
    if (!audio) return;
    if (!audio.paused) { audio.pause(); return; }
    try { await audio.play(); }
    catch (error) { console.warn("[Whistle:Audio] 미리 듣기 오류", error); }
  };
  return <Dialog className="maker-dialog" title={t("사운드")} onClose={onClose}>
    <div className="sound-editor">
      <div className="photo-actions">
        <button type="button" disabled={busy} onClick={() => input.current?.click()}>{t("사운드 불러오기")}</button>
        <span />
        <label className="sound-name">{t("이름")}
          <input aria-label={t("사운드 이름")} value={name} maxLength={12} placeholder={defaultName} onChange={e => setName(e.target.value)} />
        </label>
      </div>
      <input ref={input} type="file" hidden aria-label={t("사운드 파일")} accept="audio/*,.mp3,.wav,.ogg,.webm,.m4a,.mp4,.aac,.flac" disabled={busy}
        onChange={e => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
      {error && <p className="error" role="alert">{t(error)}</p>}
      {busy && <p role="status">{t("사운드 처리 중")}</p>}
      <div className="sound-preview">
        <button type="button" disabled={!clip || busy} aria-label={t(listening ? "미리 듣기 일시정지" : "미리 듣기")}
          aria-pressed={listening} onClick={() => void listen()}>
          <svg viewBox="0 0 16 16" aria-hidden="true">{listening ? <path d="M4 3h3v10H4zm5 0h3v10H9z" /> : <path d="m5 3 8 5-8 5z" />}</svg>
          {t("미리 듣기")}
        </button>
        <input type="range" aria-label={t("재생 위치")} min={0} max={clip?.duration ?? 1} step={0.01} value={position}
          disabled={!clip || busy} onChange={e => {
            const value = Number(e.target.value);
            if (preview.current) preview.current.currentTime = value;
            setPosition(value);
          }} />
        <output>{timeLabel(position)} / {timeLabel(clip?.duration ?? 0)}</output>
      </div>
      {clip && <audio ref={preview} hidden preload="metadata" src={clip.data} aria-label={t("사운드 미리 듣기")}
        onPlay={() => setListening(true)} onPause={() => setListening(false)} onEnded={() => setListening(false)}
        onTimeUpdate={e => setPosition(e.currentTarget.currentTime)} />}
    </div>
    <div className="asset-options-row sound-options-row">
      <fieldset className="size-options asset-size-options sound-playback">
        <legend>{t("재생 방식")}</legend>
        <div>
          <button type="button" aria-pressed={mode === "loop"} onClick={() => setMode("loop")}>{t("반복")}</button>
          <button type="button" aria-pressed={mode === "approach"} onClick={() => setMode("approach")}>{t("한 번")}</button>
        </div>
      </fieldset>
      <label className="sound-volume">{t("볼륨")}
        <input type="range" aria-label={t("볼륨")} min={0} max={1} step={0.05} value={volume} onChange={e => setVolume(Number(e.target.value))} />
        <output>{Math.round(volume * 100)}%</output>
      </label>
    </div>
    <MakerActions onDelete={onDelete} deleteDisabled={deleteDisabled} deleteLabel={placement ? "배치 삭제" : "사운드 삭제"}
      disabled={!clip || busy} onSave={() => {
        if (!clip) return;
        try {
          onSave({ id: asset?.id ?? uid(), name: name.trim() || defaultName, shape: "sphere", color: "#111111", solid: false,
            sound: { data: clip.data, duration: clip.duration, volume, mode } });
        } catch (error) { showError(userErrorMessage(error, "저장할 수 없습니다.")); }
      }} />
  </Dialog>;
}
