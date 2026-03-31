// /**
//  * platforms/reddit/runReddit.js
//  *
//  * =============================================================================
//  * REDDIT RUNNER
//  * =============================================================================
//  *
//  * 역할:
//  *  - Reddit 자동화 시나리오를 실제로 실행하는 runner
//  *  - 직접 `node runReddit.js`로 실행 가능
//  *  - Electron main.js에서도 child process로 실행 가능
//  *
//  * 구조:
//  *  - runReddit()를 export
//  *  - require.main === module 인 경우에만 직접 실행
//  * =============================================================================
//  */

// /* eslint-disable no-console */
// const fs = require("fs");
// const path = require("path");
// const {
//   enterSite,
//   loginRedditAuto,
//   searchAndScroll,
//   enterSubreddit,
//   createTextPost,
//   createComment,
//   commentOnSearchResults,
// } = require("./redditBot");
// const { closeAll } = require("../../core/browserEngine");
// const { sleep } = require("../../core/helpers");

// const historyBaseDir = process.env.BOT_USER_DATA || process.cwd();
// const HISTORY_DIR = path.resolve(historyBaseDir, "history");
// const HISTORY_FILE = path.join(HISTORY_DIR, "history.log");

// function ensureHistoryDir() {
//   try {
//     fs.mkdirSync(HISTORY_DIR, { recursive: true });
//   } catch {
//     /** ignore */
//   }
// }

// function appendHistory(entry) {
//   try {
//     ensureHistoryDir();
//     const line = JSON.stringify({
//       createdAt: new Date().toISOString(),
//       ...entry,
//     });
//     fs.appendFileSync(HISTORY_FILE, line + "\n", "utf8");
//   } catch {
//     /** ignore */
//   }
// }

// const REDDIT_USERNAME = process.env.REDDIT_USERNAME || "";
// const REDDIT_PASSWORD = process.env.REDDIT_PASSWORD || "";

// const REDDIT_TARGET_SUBREDDIT = process.env.REDDIT_TARGET_SUBREDDIT || "";
// const REDDIT_TARGET_KEYWORD = process.env.REDDIT_TARGET_KEYWORD || "";
// const REDDIT_TARGET_DATE_RANGE = process.env.REDDIT_TARGET_DATE_RANGE || "";
// const REDDIT_TARGET_COMMENT_COUNT = Number(process.env.REDDIT_TARGET_COMMENT_COUNT || "0");
// const REDDIT_TARGET_COMMENT_TEXT = process.env.REDDIT_TARGET_COMMENT_TEXT || "";

// const HEADLESS =
//   process.env.BOT_HEADLESS === "1";

// async function runReddit() {
//   console.log("[runReddit] runner started");
  
//   const { page } = await enterSite({
//     headless: HEADLESS,
//     storageKey: "reddit_main",
//     localeProfileKey: "kr",
//     useTempProfile: true,
//   });
  
//   console.log("[runReddit] entered site");

//   try {
//     /** --------------------------------------------------------
//      * 1) 로그인
//      * - 환경변수가 있으면 자동 로그인
//      * - 없으면 스킵
//      * ------------------------------------------------------- */
//     if (REDDIT_USERNAME && REDDIT_PASSWORD) {
//       await loginRedditAuto(page, {
//         username: REDDIT_USERNAME,
//         password: REDDIT_PASSWORD,
//       });
//     } else {
//       console.log("[runReddit] login skipped: set REDDIT_USERNAME / REDDIT_PASSWORD env if needed");
//     }

//     /** --------------------------------------------------------
//      * 2) 댓글 자동 게시 (환경변수 기반)
//      * ------------------------------------------------------- */
//     if (
//       REDDIT_TARGET_SUBREDDIT &&
//       REDDIT_TARGET_KEYWORD &&
//       REDDIT_TARGET_COMMENT_TEXT &&
//       REDDIT_TARGET_COMMENT_COUNT > 0
//     ) {
//       console.log("[runReddit] comment job starting", {
//         subreddit: REDDIT_TARGET_SUBREDDIT,
//         keyword: REDDIT_TARGET_KEYWORD,
//         dateRange: REDDIT_TARGET_DATE_RANGE,
//         count: REDDIT_TARGET_COMMENT_COUNT,
//       });

//       const result = await commentOnSearchResults(page, {
//         subreddit: REDDIT_TARGET_SUBREDDIT,
//         keyword: REDDIT_TARGET_KEYWORD,
//         dateRange: REDDIT_TARGET_DATE_RANGE,
//         count: REDDIT_TARGET_COMMENT_COUNT,
//         commentText: REDDIT_TARGET_COMMENT_TEXT,
//       });

//       appendHistory({
//         target: "reddit",
//         config: {
//           subreddit: REDDIT_TARGET_SUBREDDIT,
//           keyword: REDDIT_TARGET_KEYWORD,
//           dateRange: REDDIT_TARGET_DATE_RANGE,
//           count: REDDIT_TARGET_COMMENT_COUNT,
//           commentText: REDDIT_TARGET_COMMENT_TEXT,
//         },
//         urls: Array.isArray(result?.urls) ? result.urls : [],
//       });

//       await sleep(2000);
//     } else {
//       /** --------------------------------------------------------
//        * 3) 브라우저 유지 시간
//        * ------------------------------------------------------- */
//       await sleep(10000);
//     }
//   } catch (e) {
//     console.error("[runReddit] ❌ failed:", e?.message || e);
//     throw e;
//   } finally {
//     await closeAll();
//   }
// }

// if (require.main === module) {
//   runReddit().catch((e) => {
//     console.error(e);
//     process.exitCode = 1;
//   });
// }

// module.exports = runReddit;

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
 *  - Electron main.js에서도 child process로 실행 가능
 *
 * 변경 포인트:
 *  1) history 경로에서 process.cwd() 제거
 *  2) BOT_USERNAME / BOT_PASSWORD 우선 사용
 *  3) 안전한 env 파싱 추가
 *  4) success / error history 구조 정리
 * =============================================================================
 */

/* eslint-disable no-console */
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  enterSite,
  loginRedditAuto,
  commentOnSearchResults,
} = require("./redditBot");

const { closeAll } = require("../../core/browserEngine");
const { sleep } = require("../../core/helpers");

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
const REDDIT_USERNAME =
  readEnvString("BOT_USERNAME") || readEnvString("REDDIT_USERNAME") || "";

const REDDIT_PASSWORD =
  readEnvString("BOT_PASSWORD") || readEnvString("REDDIT_PASSWORD") || "";

const REDDIT_TARGET_SUBREDDIT = readEnvString("REDDIT_TARGET_SUBREDDIT", "").trim();
const REDDIT_TARGET_KEYWORD = readEnvString("REDDIT_TARGET_KEYWORD", "").trim();
const REDDIT_TARGET_DATE_RANGE = readEnvString("REDDIT_TARGET_DATE_RANGE", "").trim();
const REDDIT_TARGET_COMMENT_COUNT = readEnvNumber("REDDIT_TARGET_COMMENT_COUNT", 0);
const REDDIT_TARGET_COMMENT_TEXT = readEnvString("REDDIT_TARGET_COMMENT_TEXT", "").trim();

const HEADLESS = readEnvBool("BOT_HEADLESS", false);

/** ****************************************************************************
 * 댓글 작업 가능 여부
 ******************************************************************************/
function hasCommentJobConfig() {
  return Boolean(
    REDDIT_TARGET_SUBREDDIT &&
      REDDIT_TARGET_KEYWORD &&
      REDDIT_TARGET_COMMENT_TEXT &&
      REDDIT_TARGET_COMMENT_COUNT > 0
  );
}

/** ****************************************************************************
 * 실행 config 로그용 객체
 *
 * 비밀번호는 절대 로그에 남기지 않는다.
 ******************************************************************************/
function getRunSummary() {
  return {
    userDataRoot: USER_DATA_ROOT,
    headless: HEADLESS,
    hasLogin: Boolean(REDDIT_USERNAME && REDDIT_PASSWORD),
    commentJob: hasCommentJobConfig(),
    subreddit: REDDIT_TARGET_SUBREDDIT,
    keyword: REDDIT_TARGET_KEYWORD,
    dateRange: REDDIT_TARGET_DATE_RANGE,
    count: REDDIT_TARGET_COMMENT_COUNT,
  };
}

/** ****************************************************************************
 * Reddit runner
 ******************************************************************************/
async function runReddit() {
  console.log("[runReddit] runner started");
  console.log("[runReddit] config:", getRunSummary());

  let page = null;

  try {
    /** ------------------------------------------------------------------------
     * 1) 사이트 진입
     * ---------------------------------------------------------------------- */
    const opened = await enterSite({
      headless: HEADLESS,
      storageKey: "reddit_main",
      localeProfileKey: "kr",
      useTempProfile: true,
    });

    page = opened?.page;

    if (!page) {
      throw new Error("Reddit page was not created");
    }

    console.log("[runReddit] entered site");

    /** ------------------------------------------------------------------------
     * 2) 로그인
     * ---------------------------------------------------------------------- */
    if (REDDIT_USERNAME && REDDIT_PASSWORD) {
      console.log("[runReddit] login starting");
      await loginRedditAuto(page, {
        username: REDDIT_USERNAME,
        password: REDDIT_PASSWORD,
      });
      console.log("[runReddit] login completed");
    } else {
      console.log(
        "[runReddit] login skipped: set BOT_USERNAME/BOT_PASSWORD or REDDIT_USERNAME/REDDIT_PASSWORD"
      );
    }

    /** ------------------------------------------------------------------------
     * 3) 댓글 자동 게시 작업
     * ---------------------------------------------------------------------- */
    if (hasCommentJobConfig()) {
      console.log("[runReddit] comment job starting", {
        subreddit: REDDIT_TARGET_SUBREDDIT,
        keyword: REDDIT_TARGET_KEYWORD,
        dateRange: REDDIT_TARGET_DATE_RANGE,
        count: REDDIT_TARGET_COMMENT_COUNT,
      });

      const result = await commentOnSearchResults(page, {
        subreddit: REDDIT_TARGET_SUBREDDIT,
        keyword: REDDIT_TARGET_KEYWORD,
        dateRange: REDDIT_TARGET_DATE_RANGE,
        count: REDDIT_TARGET_COMMENT_COUNT,
        commentText: REDDIT_TARGET_COMMENT_TEXT,
      });

      appendHistory({
        action: "commentOnSearchResults",
        status: "success",
        config: {
          subreddit: REDDIT_TARGET_SUBREDDIT,
          keyword: REDDIT_TARGET_KEYWORD,
          dateRange: REDDIT_TARGET_DATE_RANGE,
          count: REDDIT_TARGET_COMMENT_COUNT,
          commentText: REDDIT_TARGET_COMMENT_TEXT,
        },
        result: {
          urls: Array.isArray(result?.urls) ? result.urls : [],
          total: Array.isArray(result?.urls) ? result.urls.length : 0,
        },
      });

      console.log("[runReddit] comment job completed");
      await sleep(2000);
      return { ok: true, action: "comment", result };
    }

    /** ------------------------------------------------------------------------
     * 4) 작업 설정이 없으면 브라우저만 잠시 유지
     * ---------------------------------------------------------------------- */
    console.log("[runReddit] no comment job config, keeping browser open briefly");
    await sleep(10000);

    appendHistory({
      action: "idleOpen",
      status: "success",
      config: {
        hasLogin: Boolean(REDDIT_USERNAME && REDDIT_PASSWORD),
      },
    });

    return { ok: true, action: "idleOpen" };
  } catch (err) {
    const message = String(err?.message || err || "Unknown error");

    console.error("[runReddit] failed:", message);

    appendHistory({
      action: hasCommentJobConfig() ? "commentOnSearchResults" : "idleOpen",
      status: "error",
      error: message,
      config: {
        subreddit: REDDIT_TARGET_SUBREDDIT,
        keyword: REDDIT_TARGET_KEYWORD,
        dateRange: REDDIT_TARGET_DATE_RANGE,
        count: REDDIT_TARGET_COMMENT_COUNT,
      },
    });

    throw err;
  } finally {
    /** ------------------------------------------------------------------------
     * 5) 모든 브라우저 정리
     * ---------------------------------------------------------------------- */
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