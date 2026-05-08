# Meta Human Automation Bot

## 개요

Meta Human Automation Bot은 Electron 기반의 데스크탑 자동화 시스템이다.

Reddit 등의 플랫폼 자동화를 목표로 하며,  
브라우저 제어(Puppeteer), LLM(OpenAI), Electron UI를 조합하여 다음 기능들을 수행한다.

- 자동 댓글 작성
- 링크 추천 댓글 생성
- 게시글 탐색 및 필터링
- 브라우저 세션 유지
- 멀티 플랫폼 구조 확장
- Electron UI 기반 봇 제어


# 시스템 구조

## 전체 아키텍처

```text
Electron UI
 ├─ Renderer (UI)
 ├─ Preload
 └─ Main Process
      ├─ Bot Runner
      ├─ Child Process / Utility Process
      └─ Platform Bots
            ├─ Reddit
            ├─ Threads
            ├─ DCInside
            └─ Instagram
                  ↓
            Puppeteer Browser
                  ↓
               Websites
                  ↓
                 LLM
```



# 주요 기능

## 1. Electron 기반 UI

봇 실행/정지 제어 가능.

### 기능

- Start / Stop 버튼
- 실시간 로그 출력
- 플랫폼별 상태 표시
- 다중 봇 제어 가능 구조
- IPC 기반 안전 통신


## 2. Reddit

Reddit 탐색 및 댓글 자동화를 수행한다.

### 기능

- subreddit 탐색
- 게시글 수집
- 조건 기반 필터링
- 자동 댓글 작성
- 링크 추천 댓글 생성
- 로그인 세션 유지
- 모바일 브라우저 에뮬레이션 지원


## 3. Threads

Threads 게시글 탐색 및 댓글 작업 수행.

### 기능

- 키워드 검색
- 게시글 탐색
- 댓글 작성
- reply 버튼 자동 탐색
- 시간 범위 필터링


## 4. DCInside, Instagram

### 기능

- 키워드 검색
- 게시글 탐색
- 댓글 작성


## 5. OpenAI LLM 연동

GPT 기반 자연어 생성 기능 제공.

### 기능

- 댓글 생성
- 언어별 출력
- JSON 스키마 응답 강제
- 플랫폼별 프롬프트 분리


# 사용 기술

## Electron

데스크탑 UI 및 프로세스 제어.


## Puppeteer

브라우저 자동화.

### 사용 목적

- 사이트 탐색
- 클릭/입력 자동화
- 로그인 세션 유지
- 모바일 브라우저 에뮬레이션


## OpenAI API

LLM 기반 자연어 생성.


# 지원 언어

LLM 출력 언어 선택 가능.

## 지원

- 한국어
- 영어
- 일본어
- 중국어
