/**
 * platforms/instagram/instaBot.js
 *
 * =============================================================================
 * Instagram 고수준 기능 API
 * =============================================================================
 *
 * 제공 기능:
 *
 * 1) enterSite()
 *    - 인스타그램 홈 진입
 *    - persistent profile 기본 사용
 *    - 수동 로그인 세션 유지에 유리
 *
 * 2) gotoUrl()
 *    - 공통 안전 이동 래퍼
 *
 * 3) postInstaCustom(page)
 *    - 홈으로 이동
 *    - Create 아이콘 클릭
 *
 * 4) uploadImageinInstaPostCustom(page, imagePath)
 *    - input[type=file] 업로드
 *    - "다음" 버튼 2회 클릭
 *
 * 5) setCaptionAndShareCustom(page, caption)
 *    - 캡션 영역 클릭
 *    - Lexical editor 입력
 *    - "공유하기" 클릭
 *
 * 6) postInstaWithImagePostOnly()
 *    - 수동 로그인 완료 상태를 가정한 원샷 실행
 *
 * 설계 포인트:
 *  - Instagram은 로그인 세션을 유지하는 것이 중요하므로
 *    persistent profile을 기본값으로 둔다.
 *  - 실제 DOM 클릭/입력 로직은 instaInternals.js에 둔다.
 * =============================================================================
 */

const { openPage } = require("../../core/browserEngine");
const { sleep } = require("../../core/helpers");
const { gotoUrlSafe, safeEvaluate } = require("../../core/navigation");

const {
  waitForSelectorOrThrow,
  clickRoleButtonDivByText,
  clickCreateByIcon,
  uploadImageFile,
  typeCaptionLexical,
} = require("./instaInternals");

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

/** ****************************************************************************
 * Instagram 로그인 상태 감지
 *
 * 기준:
 *  - 로그인 URL이 아님
 *  - username/password input이 없음
 *  - 로그인 후 보이는 홈/Create/DM/Profile 계열 UI가 있음
 ******************************************************************************/
async function isInstagramLoggedIn(page) {
  if (!page) throw new Error("isInstagramLoggedIn: page is required");

  const result = await safeEvaluate(page, () => {
    const href = String(location.href || "");
    const bodyText = String(document.body?.innerText || "");

    /** 1) 로그인/챌린지 URL이면 미로그인으로 판단 */
    const loginUrlTokens = [
      "/accounts/login",
      "/accounts/emailsignup",
      "/challenge",
    ];

    if (loginUrlTokens.some((token) => href.includes(token))) {
      return {
        ok: false,
        reason: "LOGIN_OR_CHALLENGE_URL",
        href,
      };
    }

    /** 2) 로그인 폼이 보이면 미로그인 */
    const hasLoginInputs = Boolean(
      document.querySelector('input[name="username"]') ||
      document.querySelector('input[name="password"]') ||
      document.querySelector('input[type="password"]')
    );

    if (hasLoginInputs) {
      return {
        ok: false,
        reason: "LOGIN_INPUTS_VISIBLE",
        href,
      };
    }

    /** 3) 로그인 후 보이는 UI 후보 */
    const loggedInSelectors = [
      /** Create */
      'svg[aria-label="새로운 게시물"]',
      'svg[aria-label="Create"]',
      'svg[aria-label="New post"]',

      /** Home */
      'svg[aria-label="홈"]',
      'svg[aria-label="Home"]',
      'a[href="/"]',

      /** DM */
      'a[href="/direct/inbox/"]',
      'a[href^="/direct/"]',

      /** Explore/Profile 계열 */
      'a[href="/explore/"]',
      'a[href*="/accounts/edit"]',
      'img[alt*="profile"]',
      'img[alt*="프로필"]',
    ];

    const hasLoggedInUi = loggedInSelectors.some((sel) => {
      try {
        return Boolean(document.querySelector(sel));
      } catch {
        return false;
      }
    });

    /** 4) 로그인/가입 문구가 강하게 보이면 미로그인 가능성 */
    const loginTexts = [
      "로그인",
      "가입하기",
      "log in",
      "sign up",
      "登录",
      "登入",
      "ログイン",
    ];

    const normalizedBodyText = bodyText.toLowerCase();
    const hasLoginText = loginTexts.some((text) =>
      normalizedBodyText.includes(String(text).toLowerCase())
    );

    return {
      ok: Boolean(hasLoggedInUi && !hasLoginText),
      reason: hasLoggedInUi && !hasLoginText ? "LOGGED_IN_UI" : "NOT_CONFIRMED",
      href,
      hasLoggedInUi,
      hasLoginText,
    };
  }, { tag: "instagram.isLoggedIn" });

  return Boolean(result?.ok);
}

/** ****************************************************************************
 * Instagram 로그인 완료 대기
 *
 * 설명:
 *  - 사용자가 브라우저에서 직접 로그인할 때까지 DOM을 polling한다.
 *  - Electron utilityProcess에서는 readline/Enter 대기 대신 이 방식을 써야 한다.
 ******************************************************************************/
async function waitForInstagramLogin(page, opts = {}) {
  if (!page) throw new Error("waitForInstagramLogin: page is required");

  const {
    timeout = 10 * 60 * 1000,
    checkInterval = 1000,
  } = opts;

  const start = Date.now();

  while (Date.now() - start < timeout) {
    const loggedIn = await isInstagramLoggedIn(page);

    if (loggedIn) {
      await sleep(700);
      return page;
    }

    await sleep(checkInterval);
  }

  throw new Error("waitForInstagramLogin: timeout");
}

/** ****************************************************************************
 * Instagram 로그인 보장
 ******************************************************************************/
async function ensureInstagramLoggedIn(page, opts = {}) {
  if (!page) throw new Error("ensureInstagramLoggedIn: page is required");

  const loggedIn = await isInstagramLoggedIn(page);
  if (loggedIn) return page;

  return waitForInstagramLogin(page, opts);
}

async function enterSite({
  targetUrl = "https://www.instagram.com/",
  storageKey = "instagram_main",
  localeProfileKey = "kr",
  headless = false,
  viewport = { width: 1280, height: 900 },
  useMobile = false,
  userDataDirMode = "persistent",
} = {}) {
  return openPage({
    url: targetUrl,
    storageKey,
    localeProfileKey,
    headless,
    viewport,
    userDataDirMode: normalizeUserDataDirMode(userDataDirMode),
    useMobile,
    tag: "instagram.page",
    launchArgs: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
    ],
  });
}

/** ****************************************************************************
 * 2) 안전 이동
 ******************************************************************************/
async function gotoUrl(page, url, opts = {}) {
  return gotoUrlSafe(page, url, opts);
}

/** ****************************************************************************
 * 3) Create 열기
 *
 * 단계:
 *  - 인스타 홈 이동
 *  - Create 아이콘 클릭
 ******************************************************************************/
async function postInstaCustom(page) {
  if (!page) throw new Error("postInstaCustom: page is required");

  await gotoUrlSafe(page, "https://www.instagram.com/", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await sleep(600);

  await clickCreateByIcon(page, 30000);
  await sleep(700);

  return page;
}

/** ****************************************************************************
 * 4) 이미지 업로드 + 다음 2회
 ******************************************************************************/
async function uploadImageinInstaPostCustom(page, imagePath) {
  if (!page) throw new Error("uploadImageinInstaPostCustom: page is required");
  if (!imagePath) throw new Error("uploadImageinInstaPostCustom: imagePath is required");

  await uploadImageFile(page, imagePath, 30000);

  await clickRoleButtonDivByText(page, ["다음", "Next", "次へ", "下一步", "下一個"], 30000);
  await sleep(1000);

  await clickRoleButtonDivByText(page, ["다음", "Next", "次へ", "下一步", "下一個"], 30000);
  await sleep(1000);

  return page;
}

/** ****************************************************************************
 * 5) 캡션 입력 + 공유하기
 *
 * 단계:
 *  - caption 영역 대기
 *  - 클릭으로 focus 유도
 *  - Lexical editor 입력
 *  - 공유하기 클릭
 ******************************************************************************/
async function setCaptionAndShareCustom(page, caption) {
  if (!page) throw new Error("setCaptionAndShareCustom: page is required");

  const captionSel =
    'div:has(> div[role="textbox"][aria-placeholder="문구를 입력하세요..."])';

  await waitForSelectorOrThrow(page, captionSel, 30000);

  const captionWrapper = await page.$(captionSel);
  if (!captionWrapper) {
    throw new Error("caption wrapper not found");
  }

  await captionWrapper.click();

  if (typeof captionWrapper.dispose === "function") {
    await captionWrapper.dispose();
  }

  await sleep(300);

  await typeCaptionLexical(page, caption);
  await sleep(1000);

  await clickRoleButtonDivByText(page, "공유하기", 30000);
  await sleep(1000);

  return page;
}

/** ****************************************************************************
 * 6) 원샷 실행
 *
 * 설명:
 *  - 로그인은 사용자가 수동으로 이미 끝냈다고 가정한다.
 *  - 들어가서 Create → Upload → Caption → Share 까지 수행한다.
 ******************************************************************************/
async function postInstaWithImagePostOnly({
  headless = false,
  profileKey = "insta_kr",
  caption = "test",
  imagePath = "public\\assets\\image\\cat.jpg",
} = {}) {
  const { browser, page } = await enterSite({
    headless,
    profileKey,
    targetUrl: "https://www.instagram.com/",
  });

  try {
    await postInstaCustom(page);
    await uploadImageinInstaPostCustom(page, imagePath);
    await setCaptionAndShareCustom(page, caption);

    console.log("[insta] ✅ done");
    return { ok: true };
  } catch (e) {
    console.error("[insta] ❌ failed:", e?.message || e);
    return { ok: false, error: String(e?.message || e) };
  } finally {
    await browser.close().catch(() => { });
  }
}

module.exports = {
  enterSite,
  gotoUrl,

  isInstagramLoggedIn,
  waitForInstagramLogin,
  ensureInstagramLoggedIn,

  postInstaCustom,
  uploadImageinInstaPostCustom,
  setCaptionAndShareCustom,

  postInstaWithImagePostOnly,
};