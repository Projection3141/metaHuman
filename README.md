<!-- =========================================================
FILE: README.md
========================================================= -->

# Puppeteer Chromium Utility (PowerShell-friendly) — Max 4 Cache (LRU)

## 설치 방법 (PowerShell)

### 저장소 클론 및 의존성 설치

```powershell
git clone https://github.com/Projection3141/metaHuman.git
cd metaHuman

npm install
```

### 실행

```powershell
node main.js
```

---

## 목표

멀티프로파일 **동시 브라우저 인스턴스 관리 및 리소스 최적화 솔루션**

### 핵심 아키텍처

- **프로파일 격리 아키텍처**: `profiles.json` 기반의 지역화 설정(로캘, 타임존, HTTP 헤더, Chromium 런타임 인자)을 프로파일별로 독립적으로 관리
- **스테이트풀 브라우저 풀링**: 프로파일 키별 단일 브라우저 인스턴스 재활용을 통한 세션 유지 및 쿠키 관리
- **자동 메모리 관리 메커니즘**: 전체 브라우저 캐시를 최대 4개 제한하고 **LRU(Least Recently Used) 퇴출 정책**을 적용하여 메모리 누수 방지
- **실시간 리소스 모니터링**: 30초 단위의 메트릭 리포팅으로 Node.js 프로세스 및 Chromium WorkingSet의 메모리 점유율을 추적 및 최적화

### 멀티플랫폼 자동화 봇 스위트

- **Reddit 네이티브 오토메이션**: Shadow DOM 기반 인증 체계 우회, 검색 결과의 동적 페이지 로딩(Lazy Loading) 처리, 서브레딧 네비게이션, 및 마크다운 에디터 기반 텍스트 포스팅/댓글 작성 기능
- **Instagram 페이지 크롤링 및 컨텐츠 발행**: Lexical 에디터 통합, 멀티미디어 파일 핸들링, 및 퍼시스턴트 세션 기반 인스턴스 재사용을 통한 자동 게시물 업로드
- **DCInside 갤러리 봇 오토매션**: Naver 모바일 URL 리다이렉팅 처리, 크로스 도메인 네비게이션, 갤러리별 필터링 크롤러(탭/추천/날짜/키워드 기반), 및 댓글 작성 자동화