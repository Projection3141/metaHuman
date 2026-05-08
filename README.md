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


# 실행 플로우

## 전체 흐름

```text
메인 화면
   ↓
플랫폼 선택
   ↓
조건 입력
   ↓
실행 대상 선택
   ↓
자동화 실행
```

# 실행 단계 설명

## 1. 메인 화면

사용자가 자동화 기능을 시작하는 초기 화면.

### 기능

- 플랫폼 및 조건 선택
- 로그 출력
- 봇 실행

<img src="./screenshots/1. 메인 화면.png" width="900" />

## 2. 적용대상 선정

자동화를 적용할 플랫폼 또는 타겟 선택

<img src="./screenshots/2. 적용대상 선정.png" width="900" />

## 3. 조건 입력 완료

자동화 실행 조건 입력 단계.

### 입력 가능 항목 (플랫폼별로 상이)

- 키워드
- 탐색 시간
- 댓글 개수
- 날짜 범위
- 언어 설정
- 검색 옵션
- ...


<img src="./screenshots/3. 조건 입력 완료.png" width="900" />

## 4. 실행할 대상 선택

작업할 플랫폼에서 봇 시작/정지 결정

<img src="./screenshots/4. 실행할 봇 선택.png" width="900" />


## 5. 봇 실행 단계

실제 자동화 작업 수행 단계.

브라우저 창이 생성되어 작업이 진행되며, ui에서 상태 확인 가능

### 수행 작업

- 브라우저 실행
- 로그인 유지
- 게시글 탐색
- 댓글 생성
- 댓글 등록
- 로그 기록

<img src="./screenshots/5. 봇 실행 단계.png" width="900" />


# 실행 중 내부 동작

## 브라우저 초기화

```text
Electron Main
   ↓
Bot Runner
   ↓
Puppeteer Launch
   ↓
Persistent Context 연결
```


## 페이지 탐색

```text
키워드 검색
   ↓
게시글 수집
   ↓
조건 필터링
   ↓
대상 선정
```

## 댓글 생성

```text
게시글 분석
   ↓
LLM 요청
   ↓
JSON 응답 생성
   ↓
댓글 후처리
```

## 댓글 등록

```text
reply 버튼 탐색
   ↓
입력창 탐색
   ↓
댓글 입력
   ↓
등록
```


# 로그 예시

```text
[reddit]
[runReddit] entered site

[thread][scan]
{ visible: 12, candidates: 5 }

[runThread] comment job starting

[bot][goto] success
```


# 언어 설정 흐름

```text
UI 언어 선택
   ↓
Renderer IPC 전달
   ↓
Main Process 전달
   ↓
runLlm.js 전달
   ↓
LLM 프롬프트 언어 지정
```


# 브라우저 세션 흐름

```text
브라우저 실행
   ↓
사용자 로그인
   ↓
세션 저장
   ↓
봇 정지
   ↓
재시작 후 세션 복원
```

# 예외 처리 흐름

## Navigation Error

```text
frame detached 발생
   ↓
page recreate
   ↓
goto retry
```

## 로그인 오류

```text
로그인 실패 감지
   ↓
재시도 또는 대기
```
