/**
 * renderer/app.js
 */

/** ****************************************************************************
 * 전역 상태
 ******************************************************************************/
const state = {
  bots: {},
  logs: [],
  logFilter: "all",

  /** browser 옵션 */
  launchOptions: {
    headless: false,
  },

  /** bot 실행 설정 */
  config: {
    target: "reddit",

    reddit: {
      dateRange: "",
      subreddit: "",
      keyword: "",
      commentCount: 1,
      recommendLink: "http://monio.co.kr/",
      commentLanguage: "en",  // ko: 한국어 / zh: 중국어 / ja: 일본어 / en: 영어
      userDataDirMode: "persistent",
    },

    thread: {
      dateRange: "",
      keyword: "",
      commentCount: 1,
      recommendLink: "http://monio.co.kr/",
      commentLanguage: "en",
      searchOption: "default",   // default | recent
      exploreMinutes: 10,
      userDataDirMode: "persistent",
    },
  },
};

/** ****************************************************************************
 * DOM 참조
 ******************************************************************************/
const botGridEl = document.getElementById("bot-grid");
const logViewEl = document.getElementById("log-view");
const refreshBtnEl = document.getElementById("refresh-btn");
const clearLogBtnEl = document.getElementById("clear-log-btn");
const historyBtnEl = document.getElementById("history-btn");
const logFilterEl = document.getElementById("log-filter");
const browserOptionsEl = document.getElementById("browser-options");
const botConfigEl = document.getElementById("bot-config");
const historyPanelEl = document.getElementById("history-panel");
const historyListEl = document.getElementById("history-list");
const historyBackBtnEl = document.getElementById("history-back-btn");

/** ****************************************************************************
 * 공통 helpers
 ******************************************************************************/
function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function toSafeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function isPositiveNumber(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function getThreadSearchOptionLabel(value) {
  if (value === "recent") return "최근 검색";
  return "인기 검색";
}

function getCommentLanguageLabel(value) {
  if (value === "ko") return "한국어";
  if (value === "zh") return "중국어";
  if (value === "ja") return "일본어";
  return "영어";
}

function normalizeUserDataDirMode(mode) {
  /**
   * persistent:
   *  - 기존 로그인 유지
   *
   * temp:
   *  - 새 로그인 1회
   *
   * promote:
   *  - 새 로그인 후 유지
   */
  if (mode === "temp") return "temp";
  if (mode === "promote") return "promote";
  return "persistent";
}

function getUserDataDirModeLabel(mode) {
  const normalizedMode = normalizeUserDataDirMode(mode);
  if (normalizedMode === "persistent") return "로그인 유지";
  if (normalizedMode === "promote") return "새 로그인 후 유지";
  return "새 로그인";
}

function pushUiLog(key, level, message) {
  state.logs.push({
    key,
    level,
    message,
    ts: new Date().toISOString(),
  });

  if (state.logs.length > 3000) {
    state.logs = state.logs.slice(-2000);
  }

  renderLogs();
}

/** ****************************************************************************
 * browser 옵션 토글 렌더링
 ******************************************************************************/
function renderHeadlessToggle() {
  browserOptionsEl.innerHTML = `
    <label class="toggle">
      <input type="checkbox" id="headless-toggle" ${state.launchOptions.headless ? "checked" : ""}>
      창 없이 실행
    </label>
  `;

  const toggle = document.getElementById("headless-toggle");
  if (!toggle) return;

  toggle.addEventListener("change", (event) => {
    state.launchOptions.headless = event.target.checked;
  });
}

/** ****************************************************************************
 * bot 실행 설정 렌더링
 *
 * 구성:
 *  - target 선택
 *  - reddit 설정 블록
 *  - thread 설정 블록
 ******************************************************************************/
function renderBotConfig() {
  botConfigEl.innerHTML = `
    <div class="bot-config-row">
      <label for="target-select">적용 대상</label>
      <select id="target-select" class="select">
        <option value="reddit" ${state.config.target === "reddit" ? "selected" : ""}>Reddit</option>
        <option value="instagram" ${state.config.target === "instagram" ? "selected" : ""}>Instagram</option>
        <option value="dc" ${state.config.target === "dc" ? "selected" : ""}>DCInside</option>
        <option value="thread" ${state.config.target === "thread" ? "selected" : ""}>Thread</option>
      </select>
    </div>

    <div id="reddit-config" class="${state.config.target !== "reddit" ? "hidden" : ""}">
      <div class="bot-config-row">
        <label for="reddit-date-range">날짜 범위 (YYYY-MM-DD~YYYY-MM-DD)</label>
        <input
          id="reddit-date-range"
          placeholder="2026-03-01~2026-03-10"
          value="${escapeHtml(state.config.reddit.dateRange)}"
        />
      </div>

      <div class="bot-config-row">
        <label for="reddit-subreddit">커뮤니티 (subreddit)</label>
        <input
          id="reddit-subreddit"
          placeholder="javascript"
          value="${escapeHtml(state.config.reddit.subreddit)}"
        />
      </div>

      <div class="bot-config-row">
        <label for="reddit-keyword">키워드 (제목 포함)</label>
        <input
          id="reddit-keyword"
          placeholder="automation"
          value="${escapeHtml(state.config.reddit.keyword)}"
        />
      </div>

      <div class="bot-config-row">
        <label for="reddit-comment-count">댓글 개수</label>
        <input
          id="reddit-comment-count"
          type="number"
          min="1"
          value="${state.config.reddit.commentCount}"
        />
      </div>

      <div class="bot-config-row">
        <label for="reddit-comment-language">댓글 언어</label>
        <select id="reddit-comment-language" class="select">
          <option value="ko" ${state.config.reddit.commentLanguage === "ko" ? "selected" : ""}>한국어</option>
          <option value="zh" ${state.config.reddit.commentLanguage === "zh" ? "selected" : ""}>중국어</option>
          <option value="ja" ${state.config.reddit.commentLanguage === "ja" ? "selected" : ""}>일본어</option>
          <option value="en" ${state.config.reddit.commentLanguage === "en" ? "selected" : ""}>영어</option>
        </select>
      </div>

      <div class="bot-config-row">
        <label for="reddit-recommend-link">추천 링크</label>
        <input
          id="reddit-recommend-link"
          placeholder="http://monio.co.kr/"
          value="${escapeHtml(state.config.reddit.recommendLink)}"
        />
      </div>

      <div class="bot-config-row">
        <label for="reddit-user-data-dir-mode">로그인 방식</label>
        <select id="reddit-user-data-dir-mode" class="select">
          <option value="persistent" ${state.config.reddit.userDataDirMode === "persistent" ? "selected" : ""}>
            로그인 유지
          </option>
          <option value="temp" ${state.config.reddit.userDataDirMode === "temp" ? "selected" : ""}>
            새 로그인 1회
          </option>
          <option value="promote" ${state.config.reddit.userDataDirMode === "promote" ? "selected" : ""}>
            새 로그인 후 유지
          </option>
        </select>
      </div>

    </div>


    <div id="thread-config" class="${state.config.target !== "thread" ? "hidden" : ""}">
      <div class="bot-config-row">
        <label for="thread-date-range">날짜 범위 (YYYY-MM-DD~YYYY-MM-DD)</label>
        <input
          id="thread-date-range"
          placeholder="2026-03-01~2026-03-10"
          value="${escapeHtml(state.config.thread.dateRange)}"
        />
      </div>

      <div class="bot-config-row">
        <label for="thread-keyword">키워드</label>
        <input
          id="thread-keyword"
          placeholder="ai automation"
          value="${escapeHtml(state.config.thread.keyword)}"
        />
      </div>

      <div class="bot-config-row">
        <label for="thread-search-option">검색 옵션</label>
        <select id="thread-search-option" class="select">
          <option value="default" ${state.config.thread.searchOption === "default" ? "selected" : ""}>인기 검색</option>
          <option value="recent" ${state.config.thread.searchOption === "recent" ? "selected" : ""}>최근 검색</option>
        </select>
      </div>

      <div class="bot-config-row">
        <label for="thread-comment-count">댓글 개수</label>
        <input
          id="thread-comment-count"
          type="number"
          min="1"
          value="${state.config.thread.commentCount}"
        />
      </div>

      <div class="bot-config-row">
        <label for="thread-explore-minutes">탐색 시간 (분)</label>
        <input
          id="thread-explore-minutes"
          type="number"
          min="1"
          value="${state.config.thread.exploreMinutes}"
        />
      </div>

  <div class="bot-config-row">
    <label for="thread-comment-language">댓글 언어</label>
    <select id="thread-comment-language" class="select">
      <option value="ko" ${state.config.thread.commentLanguage === "ko" ? "selected" : ""}>한국어</option>
      <option value="zh" ${state.config.thread.commentLanguage === "zh" ? "selected" : ""}>중국어</option>
      <option value="ja" ${state.config.thread.commentLanguage === "ja" ? "selected" : ""}>일본어</option>
      <option value="en" ${state.config.thread.commentLanguage === "en" ? "selected" : ""}>영어</option>
    </select>
  </div>

  <div class="bot-config-row">
    <label for="thread-recommend-link">추천 링크</label>
    <input
      id="thread-recommend-link"
      placeholder="http://monio.co.kr/"
      value="${escapeHtml(state.config.thread.recommendLink)}"
    />
  </div>

      <div class="bot-config-row">
        <label for="thread-user-data-dir-mode">로그인 방식</label>
        <select id="thread-user-data-dir-mode" class="select">
          <option value="persistent" ${state.config.thread.userDataDirMode === "persistent" ? "selected" : ""}>
            로그인 유지
          </option>
          <option value="temp" ${state.config.thread.userDataDirMode === "temp" ? "selected" : ""}>
            새 로그인 1회
          </option>
          <option value="promote" ${state.config.thread.userDataDirMode === "promote" ? "selected" : ""}>
            새 로그인 후 유지
          </option>
        </select>
      </div>

    </div>
  `;
}

/** ****************************************************************************
 * 설정 UI 동기화
 *
 * 역할:
 *  - target 변경 시 섹션 show/hide
 *  - state 값을 각 입력창에 다시 반영
 ******************************************************************************/
function updateBotConfigUI() {
  const targetSelect = document.getElementById("target-select");
  const redditConfig = document.getElementById("reddit-config");
  const threadConfig = document.getElementById("thread-config");

  if (targetSelect) {
    targetSelect.value = state.config.target;
  }

  if (redditConfig) {
    redditConfig.classList.toggle("hidden", state.config.target !== "reddit");

    const dateRange = document.getElementById("reddit-date-range");
    const subreddit = document.getElementById("reddit-subreddit");
    const keyword = document.getElementById("reddit-keyword");
    const commentCount = document.getElementById("reddit-comment-count");
    const commentLanguage = document.getElementById("reddit-comment-language");
    const recommendLink = document.getElementById("reddit-recommend-link");
    const loginKeepToggle = document.getElementById("reddit-login-keep-toggle");
    const redditUserDataDirMode = document.getElementById("reddit-user-data-dir-mode");

    if (dateRange) dateRange.value = state.config.reddit.dateRange;
    if (subreddit) subreddit.value = state.config.reddit.subreddit;
    if (keyword) keyword.value = state.config.reddit.keyword;
    if (commentCount) commentCount.value = state.config.reddit.commentCount;
    if (commentLanguage) commentLanguage.value = state.config.reddit.commentLanguage;
    if (recommendLink) recommendLink.value = state.config.reddit.recommendLink;
    if (loginKeepToggle) { loginKeepToggle.checked = state.config.reddit.userDataDirMode === "persistent"; }
    if (redditUserDataDirMode) { redditUserDataDirMode.value = normalizeUserDataDirMode(state.config.reddit.userDataDirMode); }
  }

  if (threadConfig) {
    threadConfig.classList.toggle("hidden", state.config.target !== "thread");

    const dateRange = document.getElementById("thread-date-range");
    const keyword = document.getElementById("thread-keyword");
    const searchOption = document.getElementById("thread-search-option");
    const commentCount = document.getElementById("thread-comment-count");
    const exploreMinutes = document.getElementById("thread-explore-minutes");
    const commentLanguage = document.getElementById("thread-comment-language");
    const recommendLink = document.getElementById("thread-recommend-link");
    const loginKeepToggle = document.getElementById("thread-login-keep-toggle");
    const threadUserDataDirMode = document.getElementById("thread-user-data-dir-mode");

    if (dateRange) dateRange.value = state.config.thread.dateRange;
    if (keyword) keyword.value = state.config.thread.keyword;
    if (searchOption) searchOption.value = state.config.thread.searchOption;
    if (commentCount) commentCount.value = state.config.thread.commentCount;
    if (exploreMinutes) exploreMinutes.value = state.config.thread.exploreMinutes;
    if (commentLanguage) commentLanguage.value = state.config.thread.commentLanguage;
    if (recommendLink) recommendLink.value = state.config.thread.recommendLink;
    if (loginKeepToggle) { loginKeepToggle.checked = state.config.thread.userDataDirMode === "persistent"; }
    if (threadUserDataDirMode) { threadUserDataDirMode.value = normalizeUserDataDirMode(state.config.thread.userDataDirMode); }
  }
}

/** ****************************************************************************
 * bot 설정 입력 처리
 ******************************************************************************/
function handleBotConfigInput(event) {
  const { id, value } = event.target;

  /** --------------------------------------------------------------------------
   * 1) 타겟 선택
   * ----------------------------------------------------------------------- */
  if (id === "target-select") {
    state.config.target = value;
    renderBots();
    updateBotConfigUI();
    return;
  }

  /** --------------------------------------------------------------------------
   * 2) reddit 설정
   * ----------------------------------------------------------------------- */
  if (id === "reddit-date-range") {
    state.config.reddit.dateRange = value;
    return;
  }

  if (id === "reddit-subreddit") {
    state.config.reddit.subreddit = value;
    return;
  }

  if (id === "reddit-keyword") {
    state.config.reddit.keyword = value;
    return;
  }

  if (id === "reddit-comment-count") {
    state.config.reddit.commentCount = toSafeNumber(value, 0);
    return;
  }

  if (id === "reddit-comment-language") {
    state.config.reddit.commentLanguage = value;
    return;
  }

  if (id === "reddit-recommend-link") {
    state.config.reddit.recommendLink = value;
    return;
  }

  if (id === "reddit-login-keep-toggle") {
    state.config.reddit.userDataDirMode = event.target.checked ? "persistent" : "temp";
    renderBotConfig();
    return;
  }

  if (id === "reddit-user-data-dir-mode") {
    state.config.reddit.userDataDirMode = normalizeUserDataDirMode(value);
    return;
  }

  /** --------------------------------------------------------------------------
   * 3) thread 설정
   * ----------------------------------------------------------------------- */
  if (id === "thread-date-range") {
    state.config.thread.dateRange = value;
    return;
  }

  if (id === "thread-keyword") {
    state.config.thread.keyword = value;
    return;
  }

  if (id === "thread-search-option") {
    state.config.thread.searchOption = value;
    return;
  }

  if (id === "thread-comment-count") {
    state.config.thread.commentCount = toSafeNumber(value, 0);
    return;
  }

  if (id === "thread-explore-minutes") {
    state.config.thread.exploreMinutes = toSafeNumber(value, 0);
    return;
  }

  if (id === "thread-comment-language") {
    state.config.thread.commentLanguage = value;
  }

  if (id === "thread-recommend-link") {
    state.config.thread.recommendLink = value;
  }

  if (id === "thread-user-data-dir-mode") {
    state.config.thread.userDataDirMode = normalizeUserDataDirMode(value);
    return;
  }
}

/** ****************************************************************************
 * 상태 helpers
 ******************************************************************************/
function getBadgeClass(status) {
  if (status === "starting") return "badge badge-starting";
  if (status === "waiting_login") return "badge badge-waiting-login";
  if (status === "running") return "badge badge-running";
  if (status === "standby") return "badge badge-standby";
  if (status === "stopping") return "badge badge-stopping";
  if (status === "stopped") return "badge badge-stopped";
  if (status === "error") return "badge badge-error";
  return "badge badge-idle";
}

function isActiveStatus(status) {
  return ["starting", "waiting_login", "running", "standby", "stopping"].includes(status);
}

/** ****************************************************************************
 * bot 카드 렌더링
 ******************************************************************************/
function renderBots() {
  const bots = Object.values(state.bots);

  botGridEl.innerHTML = bots
    .map((bot) => {
      const isSelected = bot.key === state.config.target;
      const startDisabled = isActiveStatus(bot.status) || !isSelected;
      const stopDisabled = !isActiveStatus(bot.status);

      return `
        <div class="bot-card">
          <div class="bot-card-top">
            <div class="bot-title">${bot.label}</div>
            <div class="${getBadgeClass(bot.status)}">${bot.status}</div>
          </div>

          <div class="bot-meta">
            <div><strong>key:</strong> ${bot.key}</div>
            <div><strong>pid:</strong> ${bot.pid ?? "-"}</div>
            <div><strong>startedAt:</strong> ${bot.startedAt ?? "-"}</div>
            <div><strong>exitCode:</strong> ${bot.exitCode ?? "-"}</div>
            <div><strong>lastError:</strong> ${bot.lastError || "-"}</div>
          </div>

          <div class="bot-actions">
            <button
              class="btn"
              data-action="start"
              data-key="${bot.key}"
              ${startDisabled ? "disabled" : ""}
            >
              Start
            </button>

            <button
              class="btn btn-danger"
              data-action="stop"
              data-key="${bot.key}"
              ${stopDisabled ? "disabled" : ""}
            >
              Stop
            </button>
          </div>
        </div>
      `;
    })
    .join("");
}

/** ****************************************************************************
 * 로그 렌더링
 ******************************************************************************/
function renderLogs() {
  const visibleLogs =
    state.logFilter === "all"
      ? state.logs
      : state.logs.filter((log) => log.key === state.logFilter);

  logViewEl.innerHTML = visibleLogs
    .map((log) => {
      const levelClass =
        log.level === "error"
          ? "lvl-error"
          : log.level === "system"
            ? "lvl-system"
            : "lvl-info";

      return `
        <div class="log-line">
          <span class="ts">[${escapeHtml(log.ts)}]</span>
          <span class="key">[${escapeHtml(log.key)}]</span>
          <span class="${levelClass}">${escapeHtml(log.message)}</span>
        </div>
      `;
    })
    .join("");

  logViewEl.scrollTop = logViewEl.scrollHeight;
}

/** ****************************************************************************
 * bot 상태 목록 새로 로드
 ******************************************************************************/
async function refreshBots() {
  const list = await window.botAPI.listBots();

  state.bots = Object.fromEntries(
    list.map((bot) => [bot.key, bot]),
  );

  renderBots();
}

/** ****************************************************************************
 * 시작 전 설정 검증
 ******************************************************************************/
function validateBotConfig(key) {
  /** --------------------------------------------------------------------------
   * Reddit
   * ----------------------------------------------------------------------- */
  if (key === "reddit") {
    const cfg = state.config.reddit;

    if (
      !cfg.subreddit || 
      !cfg.keyword || 
      !cfg.recommendLink || 
      !cfg.commentLanguage || 
      !isPositiveNumber(cfg.commentCount)
    ) {
      return {
        ok: false,
        message:
          "Reddit 설정이 불완전합니다. 커뮤니티, 키워드, 댓글 개수, 추천 링크, 댓글 언어를 모두 입력해 주세요.",
      };
    }

    return { ok: true };
  }

  /** --------------------------------------------------------------------------
   * Thread
   * ----------------------------------------------------------------------- */
  if (key === "thread") {
    const cfg = state.config.thread;

    if (
      !cfg.keyword ||
      !cfg.recommendLink ||
      !cfg.commentLanguage ||
      !isPositiveNumber(cfg.commentCount) ||
      !isPositiveNumber(cfg.exploreMinutes)
    ) {
      return {
        ok: false,
        message:
          "Thread 설정이 불완전합니다. 키워드, 댓글 개수, 추천 링크, 댓글 언어, 탐색 시간을 모두 올바르게 입력해 주세요.",
      };
    }

    return { ok: true };
  }

  return { ok: true };
}

/** ****************************************************************************
 * 시작 옵션 생성
 ******************************************************************************/
function buildStartOptions(key) {
  const options = {
    headless: state.launchOptions.headless,
  };

  if (key === "reddit") {
    options.userDataDirMode = normalizeUserDataDirMode(
      state.config.reddit.userDataDirMode,
    );
    options.redditConfig = { ...state.config.reddit };
    return options;
  }

  if (key === "thread") {
    options.userDataDirMode = normalizeUserDataDirMode(
      state.config.thread.userDataDirMode,
    );
    options.threadConfig = {
      ...state.config.thread,
    };
    return options;
  }

  return options;
}

/** ****************************************************************************
 * 버튼 이벤트 위임
 ******************************************************************************/
async function handleBotActionClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const { action, key } = button.dataset;
  if (!action || !key) return;

  /** --------------------------------------------------------------------------
   * 1) 시작
   * ----------------------------------------------------------------------- */
  if (action === "start") {
    const validation = validateBotConfig(key);

    if (!validation.ok) {
      pushUiLog(key, "error", validation.message);
      return;
    }

    const options = buildStartOptions(key);
    const res = await window.botAPI.startBot(key, options);

    if (!res?.ok) {
      pushUiLog(key, "error", `[renderer] start failed: ${res?.error || "unknown error"}`);
    }

    return;
  }

  /** --------------------------------------------------------------------------
   * 2) 중지
   * ----------------------------------------------------------------------- */
  if (action === "stop") {
    const res = await window.botAPI.stopBot(key);

    if (!res?.ok) {
      pushUiLog(key, "error", `[renderer] stop failed: ${res?.error || "unknown error"}`);
    }
  }
}

/** ****************************************************************************
 * 실행 이력
 ******************************************************************************/
async function loadHistory() {
  const history = await window.botAPI.getHistory();
  renderHistory(history);
}

function renderHistory(history = []) {
  historyListEl.innerHTML = history
    .slice()
    .reverse()
    .map((item) => {
      const time = new Date(item.createdAt || item.ts || Date.now()).toLocaleString();
      const target = item.target || "unknown";
      const config = item.config || {};
      const urls = Array.isArray(item?.result?.urls)
        ? item.result.urls
        : Array.isArray(item.urls)
          ? item.urls
          : [];

      /** ----------------------------------------------------------------------
       * 공통/플랫폼별 조건 메타 표시
       * ------------------------------------------------------------------- */
      const meta = [];

      if (config.subreddit) meta.push(`subreddit: ${escapeHtml(config.subreddit)}`);
      if (config.keyword) meta.push(`keyword: ${escapeHtml(config.keyword)}`);
      if (config.dateRange) meta.push(`dateRange: ${escapeHtml(config.dateRange)}`);
      if (typeof config.count !== "undefined") meta.push(`count: ${escapeHtml(String(config.count))}`);

      if (config.searchOption) {
        meta.push(`searchOption: ${escapeHtml(getThreadSearchOptionLabel(config.searchOption))}`);
      }

      if (config.commentLanguage) {
        meta.push(`language: ${escapeHtml(getCommentLanguageLabel(config.commentLanguage))}`);
      }

      if (typeof config.exploreMinutes !== "undefined") {
        meta.push(`exploreMinutes: ${escapeHtml(String(config.exploreMinutes))}`);
      }

      return `
        <div class="history-card">
          <h3>${escapeHtml(target)} - ${escapeHtml(time)}</h3>

          <div class="meta">
            <div>조건: ${meta.length ? meta.join(" / ") : "-"}</div>
            <div>
              ${target === "reddit" || target === "thread"
          ? `추천 링크: ${escapeHtml(config.recommendLink || "(없음)")}`
          : `댓글 내용: ${escapeHtml(config.commentText || "(없음)")}`
        }
            </div>
          </div>

          <div>
            <div style="font-weight:700; margin-bottom:6px;">댓글 단 URL</div>
            <ul class="urls">
              ${urls.length
          ? urls
            .map((url) => `<li><a href="${escapeHtml(url)}" target="_blank">${escapeHtml(url)}</a></li>`)
            .join("")
          : "<li>(없음)</li>"
        }
            </ul>
          </div>
        </div>
      `;
    })
    .join("");
}

function showHistory() {
  const panel = botGridEl.closest(".panel");
  if (panel) {
    panel.classList.add("hidden");
  }

  historyPanelEl.classList.remove("hidden");
  loadHistory();
}

function hideHistory() {
  historyPanelEl.classList.add("hidden");

  const panel = botGridEl.closest(".panel");
  if (panel) {
    panel.classList.remove("hidden");
  }
}

/** ****************************************************************************
 * 초기화
 ******************************************************************************/
async function init() {
  await refreshBots();
  renderLogs();
  renderHeadlessToggle();
  renderBotConfig();
  updateBotConfigUI();

  botConfigEl.addEventListener("input", handleBotConfigInput);
  botConfigEl.addEventListener("change", handleBotConfigInput);

  botGridEl.addEventListener("click", handleBotActionClick);

  historyBtnEl.addEventListener("click", showHistory);
  historyBackBtnEl.addEventListener("click", hideHistory);

  refreshBtnEl.addEventListener("click", async () => {
    await refreshBots();
  });

  clearLogBtnEl.addEventListener("click", () => {
    state.logs = [];
    renderLogs();
  });

  logFilterEl.addEventListener("change", () => {
    state.logFilter = logFilterEl.value;
    renderLogs();
  });

  window.botAPI.onStatus((payload) => {
    state.bots[payload.key] = payload;
    renderBots();
  });

  window.botAPI.onLog((payload) => {
    state.logs.push(payload);

    if (state.logs.length > 3000) {
      state.logs = state.logs.slice(-2000);
    }

    renderLogs();
  });
}

init().catch((err) => {
  pushUiLog("ui", "error", `[renderer] init failed: ${err?.message || err}`);
});