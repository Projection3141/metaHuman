"use strict";

/* eslint-disable no-console */

/** ****************************************************************************
 * platforms/thread/runThread.js
 *
 * 역할:
 *  - Threads runner
 *  - 브라우저 생성
 *  - 사용자 수동 로그인 대기
 *  - 검색/댓글 작업 수행
 *  - 작업 완료 후 standby 유지
 ******************************************************************************/

const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  enterSite,
  bindThreadPageDebug,
  waitForManualThreadLogin,
  commentOnSearchResults,
} = require("./threadBot");

const { closeAll, armProfilePromotion, finalizeProfilePromotion } = require("../../core/browserEngine");
const { sleep } = require("../../core/helpers");

/** ****************************************************************************
 * 안전한 env 읽기
 ******************************************************************************/
function readEnvString(name, fallback = "") {
  const value = process.env[name];
  return typeof value === "string" ? value : fallback;
}

function readEnvNumber(name, fallback = 0) {
  const raw = process.env[name];
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

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
 ******************************************************************************/
function getWritableUserDataRoot() {
  const fromEnv = readEnvString("BOT_USER_DATA", "").trim();
  if (fromEnv) return fromEnv;

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
      target: "thread",
      ...entry,
    });

    fs.appendFileSync(HISTORY_FILE, line + "\n", "utf8");
  } catch (err) {
    console.error("[runThread] appendHistory failed:", err?.message || err);
  }
}

/** ****************************************************************************
 * env 설정
 ******************************************************************************/
const THREAD_TARGET_KEYWORD = readEnvString("THREAD_TARGET_KEYWORD", "").trim();
const THREAD_TARGET_DATE_RANGE = readEnvString("THREAD_TARGET_DATE_RANGE", "").trim();
const THREAD_TARGET_COMMENT_COUNT = readEnvNumber("THREAD_TARGET_COMMENT_COUNT", 0);
const THREAD_TARGET_COMMENT_TEXT = readEnvString("THREAD_TARGET_COMMENT_TEXT", "").trim();
const THREAD_SEARCH_OPTION = readEnvString("THREAD_SEARCH_OPTION", "default").trim() || "default";
const THREAD_EXPLORE_MINUTES = readEnvNumber("THREAD_EXPLORE_MINUTES", 10);

const HEADLESS = readEnvBool("BOT_HEADLESS", false);
const USER_DATA_DIR_MODE = normalizeUserDataDirMode(readEnvString("USER_DATA_DIR_MODE", "persistent").trim());
const LOGIN_WAIT_TIMEOUT_MS = readEnvNumber("BOT_LOGIN_WAIT_TIMEOUT_MS", 10 * 60 * 1000);
const STANDBY_POLL_MS = readEnvNumber("BOT_STANDBY_POLL_MS", 2000);

/** ****************************************************************************
 * 작업 여부
 ******************************************************************************/
function hasCommentJobConfig() {
  return Boolean(
    THREAD_TARGET_KEYWORD &&
    THREAD_TARGET_COMMENT_TEXT &&
    THREAD_TARGET_COMMENT_COUNT > 0
  );
}

/** ****************************************************************************
 * 로그용 실행 요약
 ******************************************************************************/
function getRunSummaryLine() {
  return [
    `userDataRoot=${USER_DATA_ROOT}`,
    `userDataDirMode=${USER_DATA_DIR_MODE}`,
    `headless=${HEADLESS}`,
    `manualLogin=true`,
    `loginWaitTimeoutMs=${LOGIN_WAIT_TIMEOUT_MS}`,
    `standbyPollMs=${STANDBY_POLL_MS}`,
    `commentJob=${hasCommentJobConfig()}`,
    `keyword=${THREAD_TARGET_KEYWORD || "(없음)"}`,
    `dateRange=${THREAD_TARGET_DATE_RANGE || "(없음)"}`,
    `count=${THREAD_TARGET_COMMENT_COUNT}`,
    `searchOption=${THREAD_SEARCH_OPTION || "(없음)"}`,
    `exploreMinutes=${THREAD_EXPLORE_MINUTES}`,
  ].join(" ");
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
   */
  const onStop = (signal) => {
    console.log(`[runThread] stop signal received: ${signal}`);
    isStopping = true;
  };

  process.on("SIGINT", onStop);
  process.on("SIGTERM", onStop);

  /**
   * Electron utilityProcess stop 메시지 대응.
   */
  try {
    if (process.parentPort) {
      process.parentPort.on("message", (event) => {
        const message = event?.data || event;

        if (message?.type === "stop") {
          console.log("[runThread] stop message received");
          isStopping = true;
        }
      });
    }
  } catch {
    /** ignore */
  }

  /**
   * child_process.fork 호환용.
   */
  try {
    process.on("message", (message) => {
      if (message?.type === "stop") {
        console.log("[runThread] stop message received");
        isStopping = true;
      }
    });
  } catch {
    /** ignore */
  }
}

/** ****************************************************************************
 * standby 유지
 ******************************************************************************/
async function waitForStandby(tag = "standby") {
  console.log(`[runThread] entering ${tag}`);

  while (!isStopping) {
    await sleep(STANDBY_POLL_MS);
  }

  console.log(`[runThread] leaving ${tag}`);
}

/** ****************************************************************************
 * Threads runner
 ******************************************************************************/
async function runThread() {
  console.log("[runThread] runner started");
  console.log(`[runThread] config ${getRunSummaryLine()}`);

  bindShutdownSignals();

  let page = null;
  let runResult = null;
  let opened = null;

  try {
    /** ------------------------------------------------------------------------
     * 1) 사이트 진입
     * --------------------------------------------------------------------- */
    opened = await enterSite({
      headless: HEADLESS,
      storageKey: "thread_main",
      localeProfileKey: "kr",
      userDataDirMode: USER_DATA_DIR_MODE,
    });

    page = opened?.page;

    if (!page) {
      throw new Error("Thread page was not created");
    }

    bindThreadPageDebug(page);
    console.log("[runThread] entered site");

    /** ------------------------------------------------------------------------
     * 2) 사용자 수동 로그인 대기
     * --------------------------------------------------------------------- */
    page = await waitForManualThreadLogin(page, {
      timeoutMs: LOGIN_WAIT_TIMEOUT_MS,
    });

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
     * 3) 댓글 작업
     * --------------------------------------------------------------------- */
    if (hasCommentJobConfig()) {
      const result = await commentOnSearchResults(page, {
        keyword: THREAD_TARGET_KEYWORD,
        dateRange: THREAD_TARGET_DATE_RANGE,
        count: THREAD_TARGET_COMMENT_COUNT,
        commentText: THREAD_TARGET_COMMENT_TEXT,
        searchOption: THREAD_SEARCH_OPTION,
        exploreMinutes: THREAD_EXPLORE_MINUTES,
      });

      page = result?.page || page;

      appendHistory({
        action: "commentOnSearchResults",
        status: "success",
        config: {
          keyword: THREAD_TARGET_KEYWORD,
          dateRange: THREAD_TARGET_DATE_RANGE,
          count: THREAD_TARGET_COMMENT_COUNT,
          commentText: THREAD_TARGET_COMMENT_TEXT,
          searchOption: THREAD_SEARCH_OPTION,
          exploreMinutes: THREAD_EXPLORE_MINUTES,
        },
        result: {
          urls: Array.isArray(result?.urls) ? result.urls : [],
          total: Array.isArray(result?.urls) ? result.urls.length : 0,
        },
      });

      runResult = {
        ok: true,
        action: "comment",
        result,
      };
    } else {
      console.log("[runThread] no comment job config, standby after login");

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
     * 4) 작업 완료 후 대기
     * --------------------------------------------------------------------- */
    await waitForStandby("post-run-standby");

    return runResult;
  } catch (err) {
    const message = String(err?.message || err || "Unknown error");

    console.error("[runThread] failed:", message);

    appendHistory({
      action: hasCommentJobConfig() ? "commentOnSearchResults" : "idleStandby",
      status: "error",
      error: message,
      config: {
        keyword: THREAD_TARGET_KEYWORD,
        dateRange: THREAD_TARGET_DATE_RANGE,
        count: THREAD_TARGET_COMMENT_COUNT,
        searchOption: THREAD_SEARCH_OPTION,
        exploreMinutes: THREAD_EXPLORE_MINUTES,
      },
    });

    throw err;
  } finally {
    /**
     * promote 모드에서는 closeAll보다 먼저 명시적으로 프로필 승격을 처리한다.
     */
    if (USER_DATA_DIR_MODE === "promote") {
      try {
        const promoted = await finalizeProfilePromotion(opened?.browser);

        console.log("[runThread] profile promotion finalized", {
          promoted,
          storageKey: "thread_main",
        });
      } catch (promoteErr) {
        console.error(
          "[runThread] profile promotion failed:",
          promoteErr?.message || promoteErr,
        );
      }
    }

    await closeAll().catch((closeErr) => {
      console.error("[runThread] closeAll failed:", closeErr?.message || closeErr);
    });
  }
}

/** ****************************************************************************
 * 직접 실행
 ******************************************************************************/
if (require.main === module) {
  runThread().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

module.exports = runThread;