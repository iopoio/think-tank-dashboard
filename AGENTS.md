# Think Tank 대시보드 에이전트 공통 규칙

## 등급: 스몰

## 프로젝트 개요
- Think Tank 시스템(../Think/)의 웹 대시보드 (프론트엔드)
- 목적: inbox/ideas/domains/journal을 한눈에 보고, 자동 분류, 검색, 통계
- 기술 스택: HTML + Tailwind CSS + Vanilla JS, GitHub API, GitHub Pages
- 배포 주소: https://iopoio.github.io/think-tank-dashboard/
- 인증: PIN + GitHub PAT (localStorage)
- 서버 없음 (정적 사이트, 전부 클라이언트)

## 조직
- 후추님(CEO) → 방향/결정 (폰에서 주로 확인)
- 클과장(Claude) → 시스템 설계/분석/코드 리뷰 총괄
- 제대리(Gemini) → 복잡한 UI/기능 구현
- 양념이(텔레그램 봇) → 수집/검증 (Think 전용)

## 공통 규칙
- 호칭: "후추님" (팀장님/사용자님 금지)
- 한국어 우선. 볼드체(**) 금지, 강조는 이모지로.
- 핸드오프 시 "무엇을 바꿨고 왜 바꿨는지" 2~3줄 요약 필수
- 시간은 KST 기준
- 보안: .env/토큰/키 절대 커밋 금지

## 이 프로젝트만의 규칙
- 모바일 퍼스트 — 폰에서 보는 게 메인
- 오버엔지니어링 금지 — React/Vue 쓰지 말고 Vanilla JS 유지
- GitHub API 호출 최소화 (캐싱)
- 보안은 기능보다 우선 — 의심되면 막고 논의

### 보안 절대 금지
- .env 파일 Git 커밋 금지
- 토큰/키 코드 하드코딩 금지
- innerHTML에 외부 데이터 삽입 시 반드시 HTML 이스케이프
- GitHub PAT는 Authorization 헤더로만 전송, URL 파라미터 금지
- eval()/Function()/document.write() 사용 금지

### 코드 리뷰 시 체크 (제대리 핸드오프)
- innerHTML 외부 데이터 → HTML 이스케이프 여부 확인
- id/class에 사용자 데이터 → 특수문자 제거 확인
- git diff에서 토큰/키 패턴 검색 후 push (github_pat, ghp_, gho_ 등)

## 현재 할 일
- ROADMAP.md 확인
- 세션 시작 시 오늘이 회고일(목요일 저녁 / 격주 월요일)인지 확인

## 참고
- 글로벌 규칙: ~/.claude/CLAUDE.md
- 프로젝트 셋업 가이드: Think/system/프로젝트_셋업_가이드.md
