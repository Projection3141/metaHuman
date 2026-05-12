"use strict";

/** ****************************************************************************
 * platforms/thread/threadBot.js
 *
 * 역할:
 *  - Threads 사이트 진입
 *  - 수동 로그인 대기
 *  - 검색 결과 순회
 *  - 조건에 맞는 게시글에 댓글
 ******************************************************************************/

const { openPage } = require("../../core/browserEngine");
const { safeWaitNetworkIdle } = require("../../core/navigation");
const {
    sleep,
    buildThreadSearchUrl,
    parseDateRange,
    waitForThreadLogin,
    collectThreadFeedItems,
    commentOnThreadFeedItem,
    scrollThreadFeed,
} = require("./threadInternals");

/** ****************************************************************************
 * Threads 사이트 진입
 ******************************************************************************/
async function enterSite({
    targetUrl = "https://www.threads.com/",
    storageKey = "thread_main",
    localeProfileKey = "kr",
    headless = false,
    viewport = { width: 1280, height: 900 },
    userDataDirMode = "persistent",
} = {}) {
    return openPage({
        url: targetUrl,
        storageKey,
        localeProfileKey,
        headless,
        viewport,
        userDataDirMode: normalizeUserDataDirMode(userDataDirMode),
        useMobile: false,
        tag: "thread.page",
        launchArgs: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
        ],
    });
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
 * 페이지 디버그 이벤트 연결
 ******************************************************************************/
function bindThreadPageDebug(page) {
    if (!page) return;

    page.on("framenavigated", (frame) => {
        try {
            if (frame === page.mainFrame()) {
                console.log(
                    `[bot][thread.page][framenavigated] name=${frame.name() || ""} url=${frame.url()}`,
                );
            }
        } catch {
            /** ignore */
        }
    });

    page.on("domcontentloaded", () => {
        try {
            console.log(`[bot][thread.page][domcontentloaded] url=${page.url()}`);
        } catch {
            /** ignore */
        }
    });

    page.on("load", () => {
        try {
            console.log(`[bot][thread.page][load] url=${page.url()}`);
        } catch {
            /** ignore */
        }
    });

    page.on("close", () => {
        console.log("[bot][thread.page] closed");
    });
}

/** ****************************************************************************
 * 수동 로그인 대기
 *
 * 중요:
 *  - 로그인 클릭 후 auth_platform 이동은 정상
 *  - 여기서는 blank page 재생성 금지
 ******************************************************************************/
async function waitForManualThreadLogin(page, { timeoutMs = 10 * 60 * 1000 } = {}) {
    if (!page) {
        throw new Error("waitForManualThreadLogin: page is required");
    }

    console.log("[runThread] waiting for manual login");

    await page.goto("https://www.threads.com/", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
    });

    await waitForThreadLogin(page, {
        timeoutMs,
        intervalMs: 800,
        log: (message) => console.log(message),
    });

    console.log("[runThread] login detected");
    return page;
}

/** ****************************************************************************
 * 검색 결과에서 댓글 작성
 ******************************************************************************/
async function commentOnSearchResults(
    page,
    {
        keyword,
        dateRange,
        count = 1,
        commentText,
        searchOption = "default",
        exploreMinutes = 10,
    } = {},
) {
    if (!page) throw new Error("commentOnSearchResults: page is required");
    if (!keyword) throw new Error("commentOnSearchResults: keyword is required");
    if (!commentText) throw new Error("commentOnSearchResults: commentText is required");
    if (!count || count <= 0) return { page, urls: [] };

    const searchUrl = buildThreadSearchUrl({ keyword, searchOption });
    const range = parseDateRange(dateRange);
    const targetCount = Math.max(0, Number(count) || 0);
    const deadlineAt = Date.now() + (Math.max(1, Number(exploreMinutes) || 1) * 60 * 1000);

    const seenUrls = new Set();
    const commentedUrls = [];
    let stagnantRounds = 0;

    console.log(
        `[runThread] comment job starting keyword=${keyword} dateRange=${dateRange || "(없음)"} count=${targetCount} searchOption=${searchOption} exploreMinutes=${exploreMinutes} searchUrl=${searchUrl}`
    );

    await page.goto(searchUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
    });

    await safeWaitNetworkIdle(page, 12000).catch(() => { });
    await sleep(1200);

    while (Date.now() < deadlineAt && commentedUrls.length < targetCount) {
        const items = await collectThreadFeedItems(page, {
            dateRange: range,
            keyword,
        });

        /** ------------------------------------------------------------------------
        * 수집된 각 게시글의 날짜 범위 일치 여부 로그
        *
        * 로그 형식:
        *  - 게시글이 작성된 시각
        *  - 탐색 범위
        *  - 일치 여부
        * --------------------------------------------------------------------- */
        const rangeLabel = dateRange && String(dateRange).trim()
            ? String(dateRange).trim()
            : "(범위 없음)";

        for (const item of items) {
            console.log(
                `[thread][scan.item] postTime=${item.datetime || "(없음)"} | range=${rangeLabel} | inRange=${item.inRange ? "true" : "false"} | matchesKeyword=${item.matchesKeyword ? "true" : "false"} | url=${item.postUrl || "(없음)"}`
            );
        }

        const visibleUrls = items
            .map((item) => item.postUrl)
            .filter(Boolean);

        const candidates = items.filter((item) => {
            return (
                item.postUrl &&
                item.hasReplyButton &&
                item.inRange &&
                item.matchesKeyword &&
                !seenUrls.has(item.postUrl)
            );
        });

        console.log(
            `[thread][scan] visible=${items.length} visibleUrls=${visibleUrls.length} candidates=${candidates.length} commented=${commentedUrls.length} remaining=${targetCount - commentedUrls.length}`
        );

        let commentedInThisRound = 0;

        for (const item of candidates) {
            if (Date.now() >= deadlineAt) break;
            if (commentedUrls.length >= targetCount) break;

            try {
                console.log(`[thread][comment] posting to ${item.postUrl}`);
                await commentOnThreadFeedItem(page, {
                    postUrl: item.postUrl,
                    commentText,
                });

                commentedUrls.push(item.postUrl);
                seenUrls.add(item.postUrl);
                commentedInThisRound += 1;

                await sleep(1200);
            } catch (error) {
                console.log(
                    `[thread][comment] fail: ${String(error?.message || error)}`,
                );
                seenUrls.add(item.postUrl);
            }
        }

        /** ------------------------------------------------------------------------
         * 현재 화면의 URL은 모두 본 것으로 처리
         * --------------------------------------------------------------------- */
        for (const url of visibleUrls) {
            seenUrls.add(url);
        }

        if (commentedUrls.length >= targetCount) {
            break;
        }

        if (Date.now() >= deadlineAt) {
            break;
        }

        if (commentedInThisRound === 0) {
            stagnantRounds += 1;
        } else {
            stagnantRounds = 0;
        }

        await scrollThreadFeed(page, 1500);
        await safeWaitNetworkIdle(page, 8000).catch(() => { });
        await sleep(900);

        /** ------------------------------------------------------------------------
         * 너무 오래 새 결과가 안 나오면 시간 종료까지 느슨하게만 반복
         * --------------------------------------------------------------------- */
        if (stagnantRounds >= 10) {
            await sleep(1500);
        }
    }

    console.log("[runThread] comment job completed", {
        total: commentedUrls.length,
        urls: commentedUrls,
    });

    return {
        page,
        urls: commentedUrls,
    };
}

module.exports = {
    enterSite,
    bindThreadPageDebug,
    waitForManualThreadLogin,
    commentOnSearchResults,
};