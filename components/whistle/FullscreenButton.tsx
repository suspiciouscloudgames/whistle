import { useEffect, useState } from "react";
import { useLanguage } from "./Language";

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element;
  webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => void;
};
const doc = document as FullscreenDocument;
const root = doc.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
const isFullscreen = () => Boolean(doc.fullscreenElement || doc.webkitFullscreenElement);

export function FullscreenButton({ notify }: { notify: (message: string) => void }) {
  const { t } = useLanguage();
  const [active, setActive] = useState(isFullscreen);
  useEffect(() => {
    const sync = () => setActive(isFullscreen());
    doc.addEventListener("fullscreenchange", sync);
    doc.addEventListener("webkitfullscreenchange", sync);
    sync();
    return () => {
      doc.removeEventListener("fullscreenchange", sync);
      doc.removeEventListener("webkitfullscreenchange", sync);
    };
  }, []);

  const ios = navigator as Navigator & { standalone?: boolean };
  const appleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 0 && typeof ios.standalone === "boolean");
  const standard = typeof root.requestFullscreen === "function" && doc.fullscreenEnabled !== false;
  const webkit = typeof root.webkitRequestFullscreen === "function" && doc.webkitFullscreenEnabled !== false;
  useEffect(() => {
    if (standard || !webkit) return;
    const onError = () => notify("전체 화면을 전환할 수 없어요.");
    doc.addEventListener("webkitfullscreenerror", onError);
    return () => doc.removeEventListener("webkitfullscreenerror", onError);
  }, [standard, webkit, notify]);
  if (!standard && !webkit && (ios.standalone || window.matchMedia("(display-mode: standalone)").matches)) return null;

  async function toggle() {
    const homeScreenHint = "공유 메뉴에서 ‘홈 화면에 추가’를 누른 뒤 홈 화면에서 휘슬을 여세요.";
    try {
      if (doc.fullscreenElement) {
        await doc.exitFullscreen();
      } else if (doc.webkitFullscreenElement) {
        doc.webkitExitFullscreen?.();
      } else if (standard) {
        await root.requestFullscreen({ navigationUI: "hide" });
      } else if (webkit) {
        root.webkitRequestFullscreen?.();
      } else if (appleMobile) {
        notify(homeScreenHint);
      } else {
        notify("이 브라우저에서는 전체 화면을 열 수 없어요.");
      }
    } catch {
      notify(appleMobile && !active ? homeScreenHint : "전체 화면을 전환할 수 없어요.");
    }
  }

  return (
    <button type="button" className="fullscreen-toggle" onClick={toggle}
      aria-label={t("전체 화면")} aria-pressed={active} title={t(active ? "전체 화면 종료" : "전체 화면")}>
      <svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
        <path d={active
          ? "M1.5 6.5h5v-5m5 0v5h5m0 5h-5v5m-5 0v-5h-5"
          : "M7 1.5H1.5V7 M11 1.5h5.5V7 M16.5 11v5.5H11 M7 16.5H1.5V11"} />
      </svg>
    </button>
  );
}
