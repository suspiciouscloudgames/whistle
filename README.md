# Whistle

- 2D 격자 편집 → 3D 탐색 · WebPd 사운드
- [브라우저에서 열기](https://suspiciouscloudgames.github.io/whistle/)

## 실행

- Node.js 22.13 이상

```sh
npm ci       # 최초 설치
npm run dev  # Pd 자동 컴파일 · 서버 시작
```

- 종료: `Ctrl+C`
- 접속: [게임](http://127.0.0.1:5173/whistle/) · [오디오 테스트](http://127.0.0.1:5173/whistle/audio-lab/index.html) · [UWB 테스트](http://127.0.0.1:5173/whistle/uwb-lab/index.html)
- 포트 변경 시 터미널 주소 확인

## 사운드 수정

- `audio/patches/player3.pd` 및 하위 패치: 음색·리듬·볼륨 수정
- `audio/patches/uwb-player.pd`: 원본 패치 로드 · 앱/UWB 입력 연결. 사운드만 수정할 때 유지
- 적용: Pd 저장 → `npm run audio:build` → 페이지 새로고침 → 오디오 시작
- 서버 재시작 시에도 자동 컴파일
- 입력 파라미터 변경 시 연결 패치·앱 코드 확인
- `public/audio-test/`: 자동 생성 파일, 직접 수정 금지
- `whistle-board-height`: 보드 높이 수신만 연결, 소리 변화 없음

## UWB 테스트

- 세계 선택: **샘플 세계** / **Whistle 3D**
- Whistle 3D: 저장된 세계 표시 · 별도 편집기 변경 반영(같은 브라우저·서버 주소)
- 가상 입력: 평면도 클릭 또는 X·Z·보드 높이 입력(미터)
- 전시장 매핑: 원점·회전·가로·세로 설정
- **오디오 시작**: 풀 밀도에 따른 시계·사인파·바람 소리 확인
- 보드 높이: 가상 지면·플레이어 높이와 별개

### PC 수신 테스트 — 장비 없이

```sh
npm run uwb:demo  # 별도 터미널에서 실행
```

- 입력 모드: **실제 데이터 · PC 수신기**
- 연결: `ws://127.0.0.1:5194` · 태그 ID `0`
- 경로: 가상 거리 → UDP → 좌표 계산 → WebSocket
- 기본값: 6×6m 공간 · 보드 높이 1.2m 고정
- 수신: USB·UDP · 최대 4명 / 화면 표시: 선택한 1명
- 음소거: 1초간 위치 미수신 또는 계산 실패
- [실제 장비 연결 안내](docs/uwb-bridge.md)
- 미검증·미구현: 실물 장비 검증 · ESP32 스피커 출력

## 검증

```sh
npm run test:uwb  # UWB 테스트
npm test          # 전체 테스트
npm run build     # 빌드
```
