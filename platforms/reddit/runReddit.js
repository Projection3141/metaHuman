/**
 * platforms/reddit/runReddit.js
 *
 * =============================================================================
 * REDDIT RUNNER
 * =============================================================================
 *
 * 역할:
 *  - Reddit 자동화 시나리오를 실제로 실행하는 runner
 *  - 직접 `node runReddit.js`로 실행 가능
 *  - Electron main.js에서도 utility process로 실행 가능
 * =============================================================================
 */

/* eslint-disable no-console */
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  enterSite,
  waitForRedditLogin,
  ensureRedditLoggedIn,
  commentOnSearchResults,
} = require("./redditBot");

const { closeAll, armProfilePromotion, finalizeProfilePromotion, } = require("../../core/browserEngine");
const { sleep } = require("../../core/helpers");
const { createRedditCommentRecommendingLink } = require("../../llm/runLlm");

/** ****************************************************************************
 * 안전한 문자열 env 읽기
 ******************************************************************************/
function readEnvString(name, fallback = "") {
  const value = process.env[name];
  return typeof value === "string" ? value : fallback;
}

/** ****************************************************************************
 * 안전한 숫자 env 읽기
 ******************************************************************************/
function readEnvNumber(name, fallback = 0) {
  const raw = process.env[name];
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** ****************************************************************************
 * 안전한 boolean env 읽기
 ******************************************************************************/
function readEnvBool(name, fallback = false) {
  const raw = readEnvString(name, "");
  if (raw === "1" || raw.toLowerCase() === "true") return true;
  if (raw === "0" || raw.toLowerCase() === "false") return false;
  return fallback;
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

/** ****************************************************************************
 * writable user data root
 *
 * 우선순위:
 *  1) Electron main이 child env로 넘긴 BOT_USER_DATA
 *  2) 직접 node 실행 시 사용자 홈 디렉터리 기반 fallback
 ******************************************************************************/
function getWritableUserDataRoot() {
  const fromEnv = readEnvString("BOT_USER_DATA", "").trim();
  if (fromEnv) return fromEnv;

  /** 직접 실행 fallback - process.cwd()는 사용하지 않는다 */
  return path.join(os.homedir(), ".automation-bot");
}

/** ****************************************************************************
 * history 경로
 ******************************************************************************/
const USER_DATA_ROOT = getWritableUserDataRoot();
const HISTORY_DIR = path.join(USER_DATA_ROOT, "history");
const HISTORY_FILE = path.join(HISTORY_DIR, "history.log");

function ensureHistoryDir() {
  try {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
  } catch {
    /** ignore */
  }
}

function appendHistory(entry) {
  try {
    ensureHistoryDir();

    const line = JSON.stringify({
      createdAt: new Date().toISOString(),
      target: "reddit",
      ...entry,
    });

    fs.appendFileSync(HISTORY_FILE, line + "\n", "utf8");
  } catch (err) {
    console.error("[runReddit] appendHistory failed:", err?.message || err);
  }
}

/** ****************************************************************************
 * env 설정
 *
 * 중요:
 *  - main.js가 account 정보를 BOT_USERNAME / BOT_PASSWORD로 넘기므로
 *    이 값을 우선 사용한다.
 *  - 직접 단독 실행도 고려해 REDDIT_USERNAME / REDDIT_PASSWORD fallback 유지
 ******************************************************************************/
/** ****************************************************************************
 * env 설정
 *
 * 중요:
 *  - 로그인은 수동으로 처리한다.
 *  - runner는 브라우저를 연 뒤 로그인 완료를 기다린다.
 ******************************************************************************/
const REDDIT_TARGET_SUBREDDIT = readEnvString("REDDIT_TARGET_SUBREDDIT", "").trim();
const REDDIT_TARGET_KEYWORD = readEnvString("REDDIT_TARGET_KEYWORD", "").trim();
const REDDIT_TARGET_DATE_RANGE = readEnvString("REDDIT_TARGET_DATE_RANGE", "").trim();
const REDDIT_TARGET_COMMENT_COUNT = readEnvNumber("REDDIT_TARGET_COMMENT_COUNT", 0);
const REDDIT_COMMENT_LANGUAGE = readEnvString("REDDIT_COMMENT_LANGUAGE", "en").trim();
const REDDIT_RECOMMEND_LINK = readEnvString(
  "REDDIT_RECOMMEND_LINK",
  "http://monio.co.kr/",
).trim();

const HEADLESS = readEnvBool("BOT_HEADLESS", false);

const USER_DATA_DIR_MODE = normalizeUserDataDirMode(
  readEnvString("USER_DATA_DIR_MODE", "persistent").trim(),
);

/** 로그인 완료 대기 최대 시간 */
const LOGIN_WAIT_TIMEOUT_MS = readEnvNumber("BOT_LOGIN_WAIT_TIMEOUT_MS", 10 * 60 * 1000);

/** 대기 상태에서 루프 간격 */
const STANDBY_POLL_MS = readEnvNumber("BOT_STANDBY_POLL_MS", 2000);

/** ****************************************************************************
 * 댓글 작업 가능 여부
 ******************************************************************************/
function hasCommentJobConfig() {
  return Boolean(
    REDDIT_TARGET_SUBREDDIT &&
    REDDIT_TARGET_KEYWORD &&
    REDDIT_RECOMMEND_LINK &&
    REDDIT_COMMENT_LANGUAGE &&
    REDDIT_TARGET_COMMENT_COUNT > 0
  );
}

/** ****************************************************************************
 * 실행 config 로그용 객체
 ******************************************************************************/
function getRunSummary() {
  return {
    userDataRoot: USER_DATA_ROOT,
    headless: HEADLESS,
    userDataDirMode: USER_DATA_DIR_MODE,
    manualLogin: true,
    loginWaitTimeoutMs: LOGIN_WAIT_TIMEOUT_MS,
    standbyPollMs: STANDBY_POLL_MS,
    commentJob: hasCommentJobConfig(),
    subreddit: REDDIT_TARGET_SUBREDDIT,
    keyword: REDDIT_TARGET_KEYWORD,
    dateRange: REDDIT_TARGET_DATE_RANGE,
    count: REDDIT_TARGET_COMMENT_COUNT,
    recommendLink: REDDIT_RECOMMEND_LINK,
    commentLanguage: REDDIT_COMMENT_LANGUAGE,
  };
}

/** ****************************************************************************
 * runner 상태
 ******************************************************************************/
let isStopping = false;
let signalsBound = false;

/** ****************************************************************************
 * 종료 시그널 바인딩
 ******************************************************************************/
function bindShutdownSignals() {
  if (signalsBound) return;
  signalsBound = true;

  /**
   * 일반 signal 종료 대응.
   *
   * 역할:
   *  - 직접 node 실행 또는 POSIX SIGTERM 상황에서 standby loop를 종료한다.
   */
  const onStop = (signal) => {
    console.log(`[runReddit] stop signal received: ${signal}`);
    isStopping = true;
  };

  process.on("SIGINT", onStop);
  process.on("SIGTERM", onStop);
  /**
   * Electron utilityProcess stop 메시지 대응.
   *
   * 중요:
   *  - main.js가 utilityProcess.fork()를 사용하므로,
   *    stop 시 child.postMessage({ type: "stop" })를 받을 수 있어야 한다.
   *  - 이 메시지를 받아야 waitForStandby()가 빠져나가고 finally가 실행된다.
   */
  try {
    if (process.parentPort) {
      process.parentPort.on("message", (event) => {
        const message = event?.data || event;

        if (message?.type === "stop") {
          console.log("[runReddit] stop message received");
          isStopping = true;
        }
      });
    }
  } catch {
    /** ignore */
  }

  /**
   * child_process.fork 호환용.
   *
   * 역할:
   *  - 나중에 utilityProcess 대신 child_process.fork로 돌려도 동일하게 stop 처리한다.
   */
  try {
    process.on("message", (message) => {
      if (message?.type === "stop") {
        console.log("[runReddit] stop message received");
        isStopping = true;
      }
    });
  } catch {
    /** ignore */
  }
}

/** ****************************************************************************
 * 대기 상태 유지
 ******************************************************************************/
async function waitForStandby(tag = "standby") {
  console.log(`[runReddit] entering ${tag}`);

  while (!isStopping) {
    await sleep(STANDBY_POLL_MS);
  }

  console.log(`[runReddit] leaving ${tag}`);
}

/** ****************************************************************************
 * Reddit runner
 ******************************************************************************/
async function runReddit() {
  console.log("[runReddit] runner started");
  console.log("[runReddit] config:", getRunSummary());

  bindShutdownSignals();

  let page = null;
  let runResult = null;
  let opened = null;

  try {
    /** ------------------------------------------------------------------------
     * 1) 사이트 진입
     * ---------------------------------------------------------------------- */
    opened = await enterSite({
      headless: HEADLESS,
      storageKey: "reddit_main",
      localeProfileKey: "kr",
      userDataDirMode: USER_DATA_DIR_MODE,
    });

    page = opened?.page;

    if (!page) {
      throw new Error("Reddit page was not created");
    }

    console.log("[runReddit] entered site");

    /** ------------------------------------------------------------------------
     * 2) 사용자 수동 로그인 대기
     * ---------------------------------------------------------------------- */
    console.log("[runReddit] waiting for manual login");
    page = await waitForRedditLogin(page, {
      timeout: LOGIN_WAIT_TIMEOUT_MS,
    });
    console.log("[runReddit] login detected");

    if (USER_DATA_DIR_MODE === "promote") {
      armProfilePromotion(opened.browser);
    }

    appendHistory({
      action: "manualLoginWait",
      status: "success",
      config: {
        timeoutMs: LOGIN_WAIT_TIMEOUT_MS,
      },
    });

    /** ------------------------------------------------------------------------
     * 3) 작업 전 로그인 보장
     * ---------------------------------------------------------------------- */
    page = await ensureRedditLoggedIn(page);

    /** ------------------------------------------------------------------------
     * 4) 댓글 자동 게시 작업
     * ---------------------------------------------------------------------- */
    if (hasCommentJobConfig()) {
      console.log("[runReddit] comment job starting", {
        subreddit: REDDIT_TARGET_SUBREDDIT,
        keyword: REDDIT_TARGET_KEYWORD,
        dateRange: REDDIT_TARGET_DATE_RANGE,
        count: REDDIT_TARGET_COMMENT_COUNT,
        commentLanguage: REDDIT_COMMENT_LANGUAGE,
      });

      const result = await commentOnSearchResults(page, {
        subreddit: REDDIT_TARGET_SUBREDDIT,
        keyword: REDDIT_TARGET_KEYWORD,
        dateRange: REDDIT_TARGET_DATE_RANGE,
        count: REDDIT_TARGET_COMMENT_COUNT,
        createCommentText: async ({ post }) => {
          return createRedditCommentRecommendingLink({
            subreddit: REDDIT_TARGET_SUBREDDIT,
            title: post.title,
            link: REDDIT_RECOMMEND_LINK,
            language: REDDIT_COMMENT_LANGUAGE,
          });
        },
      });

      page = result?.page || page;

      appendHistory({
        action: "commentOnSearchResults",
        status: "success",
        config: {
          subreddit: REDDIT_TARGET_SUBREDDIT,
          keyword: REDDIT_TARGET_KEYWORD,
          dateRange: REDDIT_TARGET_DATE_RANGE,
          count: REDDIT_TARGET_COMMENT_COUNT,
          language: REDDIT_COMMENT_LANGUAGE,
          recommendLink: REDDIT_RECOMMEND_LINK,
        },
        result: {
          urls: Array.isArray(result?.urls) ? result.urls : [],
          total: Array.isArray(result?.urls) ? result.urls.length : 0,
        },
      });

      console.log("[runReddit] comment job completed");

      runResult = {
        ok: true,
        action: "comment",
        result,
      };
    } else {
      console.log("[runReddit] no comment job config, standby after login");

      appendHistory({
        action: "idleStandby",
        status: "success",
        config: {
          manualLogin: true,
        },
      });

      runResult = {
        ok: true,
        action: "idleStandby",
      };
    }

    /** ------------------------------------------------------------------------
     * 5) 작업 종료 후 브라우저 유지 대기
     * ---------------------------------------------------------------------- */
    await waitForStandby("post-run-standby");

    return runResult;
  } catch (err) {
    const message = String(err?.message || err || "Unknown error");

    console.error("[runReddit] failed:", message);

    appendHistory({
      action: hasCommentJobConfig() ? "commentOnSearchResults" : "idleStandby",
      status: "error",
      error: message,
      config: {
        subreddit: REDDIT_TARGET_SUBREDDIT,
        keyword: REDDIT_TARGET_KEYWORD,
        dateRange: REDDIT_TARGET_DATE_RANGE,
        count: REDDIT_TARGET_COMMENT_COUNT,
        commentLanguage: REDDIT_COMMENT_LANGUAGE,
      },
    });

    throw err;
  } finally {
    /**
   * promote 모드에서는 closeAll보다 먼저 명시적으로 프로필 승격을 처리한다.
   * 그래야 브라우저 종료 후 userDataDir 파일 lock이 풀린 다음 persistent로 교체된다.
   */
    if (USER_DATA_DIR_MODE === "promote") {
      try {
        const promoted = await finalizeProfilePromotion(opened?.browser);

        console.log("[runReddit] profile promotion finalized", {
          promoted,
          storageKey: "reddit_main",
        });
      } catch (promoteErr) {
        console.error(
          "[runReddit] profile promotion failed:",
          promoteErr?.message || promoteErr,
        );
      }
    }
    await closeAll().catch((closeErr) => {
      console.error("[runReddit] closeAll failed:", closeErr?.message || closeErr);
    });
  }
}

/** ****************************************************************************
 * 직접 실행
 ******************************************************************************/
if (require.main === module) {
  runReddit().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

module.exports = runReddit;