/**
 * platforms/instagram/runInstagram.js
 *
 * =============================================================================
 * INSTAGRAM RUNNER
 * =============================================================================
 *
 * 역할:
 *  - Instagram 업로드 시나리오 실행
 *  - 수동 로그인 후 Enter 입력
 *  - Create -> Upload -> Caption -> Share 진행
 *
 * 구조:
 *  - runInstagram()를 export
 *  - 직접 실행 / Electron child process 모두 지원
 * =============================================================================
 */

/* eslint-disable no-console */
const path = require("path");

const {
  enterSite,
  postInstaCustom,
  waitForInstagramLogin,
  ensureInstagramLoggedIn,
  uploadImageinInstaPostCustom,
  setCaptionAndShareCustom,
} = require("./instaBot");

const {
  closeAll,
  armProfilePromotion,
  finalizeProfilePromotion,
} = require("../../core/browserEngine");

const HEADLESS =
  process.env.BOT_HEADLESS === "1";

function readEnvString(name, fallback = "") {
  const value = process.env[name];
  return typeof value === "string" ? value : fallback;
}

function normalizeUserDataDirMode(mode) {
  /**
   * persistent: 기존 로그인 유지
   * temp: 새 로그인 1회
   * promote: 새 로그인 후 유지
   */
  if (mode === "temp") return "temp";
  if (mode === "promote") return "promote";
  return "persistent";
}

const USER_DATA_DIR_MODE = normalizeUserDataDirMode(
  readEnvString("USER_DATA_DIR_MODE", "persistent").trim(),
);


async function runInstagram() {
  const caption = process.env.INSTA_CAPTION || "테스트 업로드";
  const imagePath = process.env.INSTA_IMAGE_PATH || path.normalize("public\\assets\\image\\cat.jpg");

  let opened = null;
  let page = null;

  try {
    opened = await enterSite({
      headless: HEADLESS,
      storageKey: "instagram_main",
      localeProfileKey: "kr",
      useMobile: false,
      userDataDirMode: USER_DATA_DIR_MODE,
    });

    page = opened?.page;
    if (!page) throw new Error("Instagram page was not created");

    /** --------------------------------------------------------
     * 1) 로그인은 사용자가 수동으로 처리하고, runner는 DOM으로 감지
     * ------------------------------------------------------- */
    console.log("[runInstagram] waiting for manual login");

    page = await waitForInstagramLogin(page, {
      timeout: 10 * 60 * 1000,
      checkInterval: 1000,
    });

    console.log("[runInstagram] login detected");

    if (USER_DATA_DIR_MODE === "promote") {
      armProfilePromotion(opened.browser);
    }

    /** --------------------------------------------------------
     * 2) 작업 전 로그인 보장
     * ------------------------------------------------------- */
    page = await ensureInstagramLoggedIn(page);

    /** --------------------------------------------------------
     * 3) Create 열기
     * ------------------------------------------------------- */
    console.log("[insta] create flow");
    await postInstaCustom(page);

    /** --------------------------------------------------------
     * 4) 이미지 업로드 + 다음 2회
     * ------------------------------------------------------- */
    console.log("[insta] upload image + next x2");
    await uploadImageinInstaPostCustom(page, imagePath);

    /** --------------------------------------------------------
     * 5) 캡션 입력 + 공유하기
     * ------------------------------------------------------- */
    console.log("[insta] caption + share");
    await setCaptionAndShareCustom(page, caption);

    console.log("[runInstagram] ✅ done");
  } catch (e) {
    console.error("[runInstagram] ❌ failed:", e?.message || e);
    throw e;
  } finally {
    if (USER_DATA_DIR_MODE === "promote") {
      try {
        const promoted = await finalizeProfilePromotion(opened?.browser);

        console.log("[runInstagram] profile promotion finalized", {
          promoted,
          storageKey: "instagram_main",
        });
      } catch (promoteErr) {
        console.error(
          "[runInstagram] profile promotion failed:",
          promoteErr?.message || promoteErr,
        );
      }
    }

    // await closeAll();
  }
}

if (require.main === module) {
  runInstagram().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}

module.exports = runInstagram;