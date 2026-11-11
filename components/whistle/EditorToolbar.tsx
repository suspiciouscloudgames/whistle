"use client";
import type { RefObject } from "react";
import { useLanguage } from "./Language";

type Props = {
  playing: boolean;
  saveStatus: string;
  makeButton: RefObject<HTMLButtonElement | null>;
  onEnter: () => void;
  onExit: () => void;
  onNew: () => void;
  onImport: () => void;
  onShare: () => void;
};

export function EditorToolbar({
  playing, saveStatus, makeButton, onEnter, onExit, onNew, onImport, onShare,
}: Props) {
  const { language, setLanguage, t } = useLanguage();
  return (
    <header className="topbar" hidden={playing}>
      <h1>Whistle</h1>
      <nav className="view-tabs" aria-label={t("화면")}>
        <button
          ref={makeButton}
          className={!playing ? "active" : ""}
          onClick={() => {
            if (playing) onExit();
          }}
        >
          {t("만들기")}
        </button>
        <button
          className={playing ? "active" : ""}
          aria-pressed={playing}
          onClick={() => {
            if (!playing) onEnter();
          }}
        >
          {t("플레이")}
        </button>
      </nav>
      <div className="header-tools">
        <div className="language-switch" role="group" aria-label={t("언어")}>
          <button
            lang="ko"
            aria-label="한국어"
            aria-pressed={language === "ko"}
            onClick={() => setLanguage("ko")}
          >
            KO
          </button>
          <span aria-hidden="true">/</span>
          <button
            lang="en"
            aria-label="English"
            aria-pressed={language === "en"}
            onClick={() => setLanguage("en")}
          >
            EN
          </button>
        </div>
        <div className="file-actions">
          <button onClick={onNew}>{t("다시 시작")}</button>
          <button onClick={onImport}>
            {t("불러오기")}
          </button>
          <button
            onClick={onShare}
            aria-description={t(saveStatus)}
          >
            {t("공유")}
          </button>
        </div>
      </div>
    </header>
  );
}
