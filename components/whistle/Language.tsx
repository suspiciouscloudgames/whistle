"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

type Language = "ko" | "en";
const english: Record<string, string> = {
  풀: "Grass",
  나무: "Tree",
  물: "Water",
  안개: "Mist",
  바람: "Wind",
  날씨: "Weather",
  구름: "Clouds",
  비: "Rain",
  눈: "Snow",
  그늘: "Shade",
  플레이: "Play",
  화면: "Mode",
  언어: "Language",
  "다시 시작": "Start over",
  "지금 만든 세계를 지우고 새로 시작할까요?": "Clear this world and start over?",
  불러오기: "Open",
  공유: "Share",
  처음: "Restart",
  "소리 켜기": "Unmute",
  "소리 끄기": "Mute",
  재료: "Materials",
  타일: "Tiles",
  기호: "Symbols",
  "바닥 높이": "Ground height",
  높이: "Height",
  높이기: "Raise",
  낮추기: "Lower",
  구멍: "Hole",
  비우기: "Clear",
  "다른 지형": "Shuffle terrain",
  "단단한 바닥": "Firm ground",
  "거친 바닥": "Rough ground",
  "미끄러운 바닥": "Slippery ground",
  "부드러운 바닥": "Soft ground",
  시작점: "Start",
  배치: "Place",
  만들기: "Create",
  이미지: "Image",
  텍스트: "Text",
  "텍스트 입력": "Enter text",
  "이미지 또는 텍스트": "Image or text",
  "텍스트를 입력하세요.": "Enter some text.",
  "만들기로 돌아가기": "Return to Create",
  빈틈: "Gap",
  되돌리기: "Undo",
  "다시 실행": "Redo",
  "배치 결과": "Preview",
  "세계에 들어가기": "Enter world",
  "들어가기 ↗": "Enter ↗",
  회전: "Rotate",
  크기: "Size",
  "현재 파일 저장": "Save current world",
  "새 지형 열기": "New terrain",
  "파일 저장": "Save file",
  "준비 중": "Getting ready",
  "저장 중": "Saving",
  "이 브라우저에 저장됨": "Saved in this browser",
  "저장 공간 부족 · 파일로 보관": "Storage full · Save a file",
  "저장 공간 부족": "Storage full",
  "저장한 세계를 불러오지 못했어요.": "Could not open the saved world.",
  "시작점에는 바닥이 필요해요.": "The start needs ground underneath.",
  "시작점이 막혀 있습니다.": "The start is blocked.",
  "최대 250개": "Up to 250 objects",
  "첫 버전에서는 사물을 40종류까지 만들 수 있어요.":
    "You can create up to 40 object types.",
  "6MB 이하의 세계 파일을 선택해 주세요.": "Choose a world file under 6 MB.",
  "세계 파일을 읽을 수 없어요.": "Could not read the world file.",
  점프: "Jump",
  기어가기: "Crawl",
  빠르게: "Move faster",
  "점프 · 빠르게": "Jump · move faster",
  "숙이기 · 천천히": "Crouch · move slower",
  "이동 터치패드": "Movement pad",
  앞으로: "Forward",
  뒤로: "Back",
  "왼쪽으로 회전": "Turn left",
  "오른쪽으로 회전": "Turn right",
  격자: "Board",
  닫기: "Close",
  원: "Circle",
  사각형: "Square",
  삼각형: "Triangle",
  마름모: "Diamond",
  고리: "Ring",
  선: "Line",
  무제: "Untitled",
  "이미지 편집": "Edit image",
  속성: "Properties",
  작게: "Small",
  중간: "Medium",
  크게: "Large",
  "아주 크게": "Extra large",
  이름: "Name",
  충돌: "Solid",
  저장: "Save",
  "저장할 수 없습니다.": "Could not save.",
  "사진 불러오기": "Add photo",
  "사진 편집 되돌리기": "Undo image edit",
  "사진 편집 다시 실행": "Redo image edit",
  원본: "Original",
  "사진 편집 캔버스": "Image editing canvas",
  "사진 편집 도구": "Image tools",
  "불러오는 중": "Loading",
  자르기: "Crop",
  "배경 지우기": "Remove background",
  그리기: "Draw",
  지우개: "Erase",
  "자르기 적용": "Apply crop",
  취소: "Cancel",
  "남길 영역을 드래그하세요": "Drag the area to keep",
  "지울 배경을 누르세요": "Tap the background to remove",
  범위: "Tolerance",
  "배경 색상 범위": "Background tolerance",
  "붓 색": "Brush color",
  굵기: "Width",
  "붓 굵기": "Brush width",
  "이미지를 읽을 수 없습니다.": "Could not read the image.",
  "이미지를 불러오는 중입니다.": "The image is still loading.",
  "사진이나 그림을 추가하세요.": "Add a photo or drawing.",
  "PNG, JPG, WebP, GIF 파일만 가능합니다.": "Use PNG, JPG, WebP or GIF.",
  "최대 15MB": "Up to 15 MB",
  "원본을 읽을 수 없습니다.": "Could not read the original.",
  링크: "Link",
  "세계 링크": "World link",
  복사됨: "Copied",
  복사: "Copy",
  "링크 용량 초과. 파일로 저장하세요.":
    "Too large for a link. Save a file instead.",
  "링크 생성 실패": "Could not create a link",
  "선택된 링크를 복사하세요.": "Copy the selected link.",
  "1인칭으로 탐험하는 세계": "First-person world",
  "세계의 3D 미리보기": "World preview",
  "3D 화면을 시작하지 못했어요.": "Could not start the scene.",
  "WebGL을 지원하는 브라우저에서 다시 열어 주세요.":
    "Open in a browser that supports WebGL.",
  전체: "All",
  규칙: "Rule",
  대상: "Target",
  조건: "Condition",
  바라보기: "Look",
  접근: "Approach",
  표시: "Mark",
  "표시된 이웃": "Marked neighbor",
  이웃: "Neighbor",
  거리: "Distance",
  변화: "Change",
  "표시 추가": "Add mark",
  "다른 도형": "Change shape",
  "한 칸 이동": "Move one cell",
  제거: "Remove",
  소리: "Sound",
  도형: "Shape",
  "공유 링크가 너무 커요. 세계 파일로 가져와 주세요.":
    "This link is too large. Open a world file instead.",
  "지원하지 않는 공유 링크예요.": "Unsupported world link.",
  "이 브라우저에서는 링크를 열 수 없어요. 최신 브라우저를 사용해 주세요.":
    "This browser cannot open the link. Use a newer browser.",
  "세계 데이터가 너무 커요.": "The world data is too large.",
  "지원하지 않는 세계 형식이에요.": "Unsupported world format.",
  "사물 데이터가 올바르지 않아요.": "Invalid object data.",
  "사물 위치가 올바르지 않아요.": "Invalid object position.",
  "규칙 데이터가 올바르지 않아요.": "Invalid rule data.",
  "시작 위치가 올바르지 않아요.": "Invalid start position.",
  "지형 데이터가 올바르지 않아요.": "Invalid terrain data.",
};
const LanguageContext = createContext({
  language: "ko" as Language,
  setLanguage: (_language: Language) => {},
  t: (text: string): string => text,
});
const STORAGE = "whistle.language";
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, updateLanguage] = useState<Language>("ko");
  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE) === "en") updateLanguage("en");
    } catch {

    }
  }, []);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  const setLanguage = useCallback((next: Language) => {
    updateLanguage(next);
    try {
      localStorage.setItem(STORAGE, next);
    } catch {

    }
  }, []);
  const t = useCallback(
    (text: string) => (language === "en" ? (english[text] ?? text) : text),
    [language],
  );
  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}
export const useLanguage = () => useContext(LanguageContext);
export function SceneLoading() {
  const { t } = useLanguage();
  return <div className="scene scene-loading" aria-label={t("불러오는 중")} />;
}
