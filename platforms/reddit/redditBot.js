/**
 * platforms/reddit/redditBot.js
 *
 * =============================================================================
 * REDDIT HIGH-LEVEL API
 * =============================================================================
 *
 * 역할:
 *  - Reddit 자동화의 고수준 API 제공
 *  - 외부에서 사용하는 주요 기능만 노출
 *  - 흐름 제어에 집중, 세부 DOM 조작은 redditInternals.js에서 처리
 *
 * 포함된 함수들:
 *  - enterSite(options): Reddit 사이트 진입
 *  - gotoUrlSafe(page, url, opts): 안전한 URL 이동
 *  - loginRedditAuto(page, credentials): 자동 로그인
 *  - searchAndScroll(page, options): 검색 및 스크롤
 *  - enterSubreddit(page, subredditName): 서브레딧 진입
 *  - createTextPost(page, options): 텍스트 포스트 생성
 *  - createComment(page, options): 댓글 생성
 *  - commentOnSearchResults(page, options): 검색 결과에 댓글
 * =============================================================================
 */

const { openPage } = require("../../core/browserEngine");
const { sleep } = require("../../core/helpers");
const {
  gotoUrlSafe,
  safeWaitNetworkIdle,
  safeEvaluate,
} = require("../../core/navigation");

const {
  buildSearchUrl,
  buildTextSubmitUrlFromPickValue,

  setFaceplateTextInputById,
  clickLoginButton,

  setTitleFaceplateTextarea,
  setBodyLexicalRTE,
  clickSubmitPostButton,

  clickCommentsActionButton,
  scrollToCommentsArea,
  focusCommentEditorDeepStrict,
  setCommentTextByKeyboard,
  clickCommentSubmitButtonDeep,
} = require("./redditInternals");

/**
 * Reddit 사이트에 진입하는 함수
 * @param {Object} options - 진입 옵션
 * @param {string} options.targetUrl - 대상 URL (기본: reddit.com)
 * @param {string} options.storageKey - 저장소 키
 * @param {string} options.localeProfileKey - 로케일 프로필 키
 * @param {boolean} options.headless - 헤드리스 모드
 * @param {Object} options.viewport - 뷰포트 설정
 * @param {boolean} options.useTempProfile - 임시 프로필 사용 여부
 * @returns {Promise<Object>} 페이지 객체를 포함한 결과
 * 로직: browserEngine.openPage를 호출하여 Reddit 페이지 열기, 임시 프로필 사용으로 detached frame 이슈 방지
 */
async function enterSite({
  targetUrl = "https://www.reddit.com/",
  storageKey = "reddit_main",
  localeProfileKey = "kr",
  headless = false,
  viewport = { width: 1280, height: 900 },
  useTempProfile = true,
} = {}) {
  return openPage({
    url: targetUrl,
    storageKey,
    localeProfileKey,
    headless,
    viewport,
    userDataDirMode: useTempProfile ? "temp" : "persistent",
    useMobile: false,
    tag: "reddit.page",
    launchArgs: [
      "--no-sandbox",
      "--disable-setuid-sandbox"
    ]
  });
}

/** ****************************************************************************
 * 2) Reddit 로그인
 *
 * 단계:
 *  - login URL로 안전 이동
 *  - username shadow input 입력
 *  - password shadow input 입력
 *  - 로그인 버튼 클릭
 *  - network idle 대기
 *
 * 반환:
 *  - 최신 page 객체
 ******************************************************************************/
async function loginRedditAuto(page, { username, password } = {}) {
  if (!username) throw new Error("loginRedditAuto: username is required");
  if (!password) throw new Error("loginRedditAuto: password is required");

  page = await gotoUrlSafe(page, "https://www.reddit.com/login/", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  await setFaceplateTextInputById(page, "login-username", username, 30000);
  await sleep(150);
  await setFaceplateTextInputById(page, "login-password", password, 30000);
  await sleep(200);

  await clickLoginButton(page, 30000);
  await safeWaitNetworkIdle(page, 20000);
  await sleep(600);

  return page;
}

/** ****************************************************************************
 * 3) 검색 + 스크롤
 *
 * 단계:
 *  - 검색 URL 생성
 *  - 안전 이동
 *  - 여러 번 스크롤
 *  - 스크롤 후 network idle 대기
 ******************************************************************************/
async function searchAndScroll(page, { keyword, rounds = 4, delayMs = 900 } = {}) {
  if (!keyword) throw new Error("searchAndScroll: keyword is required");

  page = await gotoUrlSafe(page, buildSearchUrl(keyword), {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  await safeWaitNetworkIdle(page, 15000);

  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await safeEvaluate(page, () => window.scrollTo(0, document.body.scrollHeight));
    // eslint-disable-next-line no-await-in-loop
    await sleep(delayMs);
    // eslint-disable-next-line no-await-in-loop
    await safeWaitNetworkIdle(page, 8000);

    console.log(`[reddit][search] scroll ${i + 1}/${rounds}`);
  }

  return page;
}

/** ****************************************************************************
 * 4) 서브레딧 진입
 ******************************************************************************/
async function enterSubreddit(page, subredditName) {
  if (!subredditName) throw new Error("enterSubreddit: subredditName is required");

  const url = `https://www.reddit.com/r/${encodeURIComponent(String(subredditName))}/`;

  page = await gotoUrlSafe(page, url, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  await safeWaitNetworkIdle(page, 12000);
  return page;
}

/** ****************************************************************************
 * 5) 텍스트 글 작성
 *
 * 단계:
 *  - pickValue(u/... 또는 r/...)를 submit URL로 변환
 *  - submit page 이동
 *  - 제목 입력
 *  - 본문 입력
 *  - 게시 버튼 클릭
 *  - network idle 대기
 ******************************************************************************/
async function createTextPost(page, { pickValue, title, body } = {}) {
  if (!page) throw new Error("createTextPost: page is required");
  if (!pickValue) throw new Error("createTextPost: pickValue is required");

  const submitUrl = buildTextSubmitUrlFromPickValue(pickValue);
  console.log("[reddit][post] direct submit url:", submitUrl);

  page = await gotoUrlSafe(page, submitUrl, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  await safeWaitNetworkIdle(page, 12000);
  await sleep(600);

  await setTitleFaceplateTextarea(page, title, 30000);
  await sleep(200);

  await setBodyLexicalRTE(page, body, 30000);
  await sleep(300);

  await clickSubmitPostButton(page, 30000);
  await safeWaitNetworkIdle(page, 20000);
  await sleep(800);

  return page;
}

/** ****************************************************************************
 * 6) 댓글 작성
 *
 * 단계:
 *  - 대상 글 URL 이동
 *  - comments 버튼 클릭
 *  - 댓글 섹션 근처 스크롤
 *  - 댓글 editor 깊은 탐색
 *  - 텍스트 입력
 *  - 등록 버튼 클릭
 ******************************************************************************/
async function createComment(page, { url, commentText } = {}) {
  if (!page) throw new Error("createComment: page is required");
  if (!url) throw new Error("createComment: url is required");
  if (!commentText) throw new Error("createComment: commentText is required");

  page = await gotoUrlSafe(page, url, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  await safeWaitNetworkIdle(page, 12000);
  await sleep(700);

  await clickCommentsActionButton(page, 15000);
  await safeWaitNetworkIdle(page, 10000);
  await sleep(700);

  await scrollToCommentsArea(page, { rounds: 8, step: 900 });
  await safeWaitNetworkIdle(page, 10000);
  await sleep(600);

  await focusCommentEditorDeepStrict(page, { timeout: 25000 });
  await sleep(150);

  await setCommentTextByKeyboard(page, commentText);
  await sleep(250);

  await clickCommentSubmitButtonDeep(page, 20000);
  await safeWaitNetworkIdle(page, 15000);
  await sleep(800);

  return page;
}

function parseDateRange(range) {
  if (!range) return {};

  const [startRaw, endRaw] = String(range)
    .split("~")
    .map((s) => String(s || "").trim())
    .filter(Boolean);

  const toEpoch = (str) => {
    const d = new Date(str);
    if (Number.isNaN(d.getTime())) return null;
    return Math.floor(d.getTime() / 1000);
  };

  const from = toEpoch(startRaw);
  const to = toEpoch(endRaw || startRaw);
   
  return { from, to };
}

/**
 * 특정 서브레딧에서 키워드로 검색한 게시글에 댓글 작성
 */
async function commentOnSearchResults(
  page,
  { subreddit, keyword, dateRange, count = 1, commentText } = {},
) {
  if (!page) throw new Error("commentOnSearchResults: page is required");
  if (!subreddit) throw new Error("commentOnSearchResults: subreddit is required");
  if (!keyword) throw new Error("commentOnSearchResults: keyword is required");
  if (!commentText) throw new Error("commentOnSearchResults: commentText is required");
  if (!count || count <= 0) return page;

  const { from, to } = parseDateRange(dateRange);
  const q = encodeURIComponent(String(keyword).trim());
  const url = `/r/${encodeURIComponent(subreddit)}/search.json?q=${q}&restrict_sr=1&sort=new&limit=100`;

  console.log("[reddit][comment] fetching search results:", url);

  const res = await safeEvaluate(
    page,
    async (u) => {
      const r = await fetch(u, { credentials: "same-origin" });
      return r.json();
    },
    url,
  );

  const items = Array.isArray(res?.data?.children)
    ? res.data.children.map((c) => {
        const d = c?.data || {};
        return {
          title: d.title || "",
          url: d.permalink ? `https://www.reddit.com${d.permalink}` : null,
          createdUtc: Number(d.created_utc) || 0,
        };
      })
    : [];

  const matches = items.filter((item) => {
    if (!item.url) return false;
    const title = String(item.title || "").toLowerCase();
    const kw = String(keyword || "").toLowerCase();

    if (!title.includes(kw)) return false;

    if (from && item.createdUtc < from) return false;
    if (to && item.createdUtc > to) return false;

    return true;
  });

  const selected = matches.slice(0, count);
  const urls = selected.map((p) => p.url).filter(Boolean);

  for (const post of selected) {
    console.log("[reddit][comment] posting to", post.url);
    page = await createComment(page, { url: post.url, commentText });
    await sleep(1000);
  }

  return { page, urls };
}

module.exports = {
  enterSite,
  gotoUrlSafe,
  loginRedditAuto,
  searchAndScroll,
  enterSubreddit,
  createTextPost,
  createComment,
  commentOnSearchResults,
};