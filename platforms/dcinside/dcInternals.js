/**
 * platforms/dcinside/dcInternals.js
 *
 * =============================================================================
 * DCInside 내부 함수
 * =============================================================================
 *
 * 역할:
 *  - 네이버 검색 경유 진입
 *  - 로그인 보조
 *  - 검색 / 갤러리 진입
 *  - URL 파라미터 조작
 *  - 날짜 파싱
 *  - 크롤링
 *  - 댓글 작성
 *
 * 설계 포인트:
 *  - DCInside는 일반 DOM 기반이라 공통 domClick / setValue를 많이 활용한다.
 *  - 크롤러 로직은 기능 파일과 분리하여 유지보수를 쉽게 한다.
 * =============================================================================
 */

const fs = require("fs");
const path = require("path");

const { sleep, domClick, setValue } = require("../../core/helpers");
const { gotoUrlSafe, safeEvaluate } = require("../../core/navigation");

/** ****************************************************************************
 * URL helpers
 ******************************************************************************/
function toURL(href) {
  return new URL(href);
}

function toHref(u) {
  return u.toString();
}

function setParam(u, key, value) {
  if (value === null || value === undefined || value === "") {
    u.searchParams.delete(key);
  } else {
    u.searchParams.set(key, String(value));
  }
  return u;
}

/** ****************************************************************************
 * 날짜 helpers (KST 기준)
 ******************************************************************************/
function kstMidnight(yyyy, mm, dd) {
  const utcMs = Date.UTC(yyyy, mm - 1, dd, 0, 0, 0, 0) - 9 * 60 * 60 * 1000;
  return new Date(utcMs);
}

function getKSTYMD(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const d = Number(parts.find((p) => p.type === "day")?.value);
  return { y, m, d };
}

function formatKST_YYYY_MM_DD(d) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);

  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function parseYYMMDD(s) {
  const m = String(s).match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  if (!m) return null;
  const yyyy = 2000 + Number(m[1]);
  const mm = Number(m[2]);
  const dd = Number(m[3]);
  return kstMidnight(yyyy, mm, dd);
}

function parseRange(rangeStr) {
  if (!rangeStr) return null;

  const cleaned = String(rangeStr)
    .replace(/\s+/g, "")
    .replace(/[^\d.~]/g, "");

  const parts = cleaned.split("~");
  if (parts.length !== 2) throw new Error(`date range format invalid: ${rangeStr}`);

  const start = parseYYMMDD(parts[0]);
  const end = parseYYMMDD(parts[1]);

  if (!start || !end) throw new Error(`date range parse failed: ${rangeStr}`);

  if (start.getTime() > end.getTime()) return { start: end, end: start };
  return { start, end };
}

function toPostDate(dateTimeRaw, now = new Date()) {
  const raw = String(dateTimeRaw || "").trim();
  if (!raw) return null;

  const s = raw.replace(/\s+/g, "").replace(/[^\d.:]/g, "");
  if (!s) return null;

  if (/^\d{2}:\d{2}$/.test(s)) {
    const { y, m, d } = getKSTYMD(now);
    return kstMidnight(y, m, d);
  }

  let m4 = s.match(/^(\d{4})\.(\d{2})\.(\d{2})$/);
  if (m4) {
    const yyyy = Number(m4[1]);
    const mm = Number(m4[2]);
    const dd = Number(m4[3]);
    return kstMidnight(yyyy, mm, dd);
  }

  let m2 = s.match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  if (m2) {
    const yyyy = 2000 + Number(m2[1]);
    const mm = Number(m2[2]);
    const dd = Number(m2[3]);
    return kstMidnight(yyyy, mm, dd);
  }

  const md = s.match(/^(\d{2})\.(\d{2})$/);
  if (md) {
    const { y } = getKSTYMD(now);
    const mm = Number(md[1]);
    const dd = Number(md[2]);
    return kstMidnight(y, mm, dd);
  }

  return null;
}

/** ****************************************************************************
 * 네이버 검색창에 쿼리 입력
 ******************************************************************************/
async function naverSearchWithGivenInput(page, query) {
  await page.waitForSelector("#MM_SEARCH_FAKE", { timeout: 20000 });

  await safeEvaluate(page, () => {
    const el = document.querySelector("#MM_SEARCH_FAKE");
    if (el) el.value = "";
  });

  await page.focus("#MM_SEARCH_FAKE");
  await page.keyboard.type(query, { delay: 30 });
  await page.keyboard.press("Enter");

  await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => {});
}

/** ****************************************************************************
 * 네이버 결과에서 DCInside 첫 링크 클릭
 ******************************************************************************/
async function clickFirstDcinsideResult(page, browser) {
  await page.waitForFunction(() => {
    const as = Array.from(document.querySelectorAll('a[href]'));
    return as.some((a) => (a.getAttribute("href") || "").includes("dcinside.com"));
  }, { timeout: 25000 });

  const popupPromise = new Promise((resolve) => page.once("popup", resolve));
  const targetCreatedPromise = new Promise((resolve) => {
    browser.once("targetcreated", async (t) => {
      try {
        const p = await t.page();
        if (p) resolve(p);
      } catch {
        /** ignore */
      }
    });
  });

  const clicked = await safeEvaluate(page, () => {
    const links = Array.from(document.querySelectorAll('a[href]'));
    const target =
      links.find((a) => (a.getAttribute("href") || "").includes("m.dcinside.com")) ||
      links.find((a) => (a.getAttribute("href") || "").includes("dcinside.com"));

    if (!target) return false;

    target.scrollIntoView({ block: "center", inline: "center" });
    target.click();
    return true;
  });

  if (!clicked) throw new Error("dcinside link not found/clicked.");

  const navPromise = page
    .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 25000 })
    .then(() => page)
    .catch(() => null);

  const p = await Promise.race([popupPromise, targetCreatedPromise, navPromise]);
  return p || page;
}

/** ****************************************************************************
 * 로그인 수행
 ******************************************************************************/
async function loginDcinside(page, { id, pw } = {}) {
  if (!page) throw new Error("loginDcinside: page is required");
  if (!id) throw new Error("loginDcinside: id is required");
  if (!pw) throw new Error("loginDcinside: pw is required");

  await page.waitForSelector('a.mark[href*="msign.dcinside.com/login"], span.sign', {
    timeout: 20000,
  });

  const hasAnchor = await page.$('a.mark[href*="msign.dcinside.com/login"]');
  if (hasAnchor) {
    await Promise.allSettled([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 25000 }),
      domClick(page, 'a.mark[href*="msign.dcinside.com/login"]'),
    ]);
  } else {
    await Promise.allSettled([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 25000 }),
      domClick(page, "span.sign"),
    ]);
  }

  await setValue(page, 'input#code[name="code"]', id);
  await setValue(page, 'input#password[name="password"]', pw);

  await Promise.allSettled([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 25000 }),
    page.keyboard.press("Enter"),
  ]);

  await sleep(300);

  const hasCpiboxBtnBox = await page.$("div.cpibox.btn_box");
  if (hasCpiboxBtnBox) {
    const targetHref = "https://m.dcinside.com";
    const clicked = await safeEvaluate(page, (href) => {
      const box = document.querySelector("div.cpibox.btn_box");
      if (!box) return false;
      const a = Array.from(box.querySelectorAll('a[href]')).find((x) => x.getAttribute("href") === href);
      if (!a) return false;
      a.scrollIntoView({ block: "center", inline: "center" });
      a.click();
      return true;
    }, targetHref);

    if (clicked) {
      await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => {});
    }
  }

  return page;
}

/** ****************************************************************************
 * 검색 수행
 ******************************************************************************/
async function searchGallary(page, keyword) {
  if (!page) throw new Error("searchGallary: page is required");
  if (!keyword) throw new Error("searchGallary: keyword is required");

  const searchAllInputSel =
    'input.ipt-sch.search-all, input.search-all, form[role="search"] input[type="text"]';
  const submitBtnSel = "button.sp-btn-sch, .search-box button.sp-btn-sch";

  await page.waitForSelector(searchAllInputSel, { timeout: 20000 });
  await setValue(page, searchAllInputSel, keyword);

  await page.waitForSelector(submitBtnSel, { timeout: 20000 });

  const before = page.url();
  await Promise.allSettled([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 25000 }),
    domClick(page, submitBtnSel),
  ]);

  if (page.url() === before) {
    await safeEvaluate(page, (inputSel) => {
      const input = document.querySelector(inputSel);
      const form = input?.closest("form");
      if (form && typeof form.submit === "function") form.submit();
    }, searchAllInputSel);

    await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => {});
  }

  await sleep(200);
  return page;
}

/** ****************************************************************************
 * 검색결과 첫 갤러리 클릭
 ******************************************************************************/
async function clickFirstGalleryFromResult(page) {
  const firstLinkSel = "ul.flex-gall-lst > li:first-child a[href]";
  await page.waitForSelector(firstLinkSel, { timeout: 25000 });

  const popupPromise = new Promise((resolve) => page.once("popup", resolve));

  const clicked = await safeEvaluate(page, () => {
    const a = document.querySelector(sel);
    if (!a) return false;
    a.scrollIntoView({ block: "center", inline: "center" });
    a.click();
    return true;
  }, firstLinkSel);

  if (!clicked) throw new Error("clickFirstGalleryFromResult: failed to click first gallery link");

  const navPromise = page
    .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 25000 })
    .then(() => page)
    .catch(() => null);

  const p = await Promise.race([popupPromise, navPromise]);
  return p || page;
}

/** ****************************************************************************
 * 추천글 선택
 ******************************************************************************/
async function selectRecommend(page) {
  const u = toURL(page.url());
  setParam(u, "recommend", 1);

  const next = toHref(u);
  if (next === page.url()) return page;

  return gotoUrlSafe(page, next, { waitUntil: "domcontentloaded" });
}

/** ****************************************************************************
 * 탭 선택
 ******************************************************************************/
async function selectTab(page, tabStr) {
  const map = {
    전체: null,
    일반: 0,
  };

  const tabNum = Object.prototype.hasOwnProperty.call(map, tabStr) ? map[tabStr] : tabStr;

  const u = toURL(page.url());
  setParam(u, "headid", tabNum);

  const next = toHref(u);
  if (next === page.url()) return page;

  return gotoUrlSafe(page, next, { waitUntil: "domcontentloaded" });
}

/** ****************************************************************************
 * 페이지 이동
 ******************************************************************************/
async function movePage(page, pageNum) {
  if (!Number.isFinite(pageNum)) throw new Error("movePage: pageNum must be a number");

  const u = toURL(page.url());
  setParam(u, "page", pageNum);

  const next = toHref(u);
  if (next === page.url()) return page;

  await gotoUrlSafe(page, next, { waitUntil: "domcontentloaded" });
  console.log(`[dc][movePage] moved to page=${pageNum} url=${next}`);

  return page;
}

/** ****************************************************************************
 * 크롤링
 *
 * 기존 로직 유지:
 *  - recommend/headid/page URL 파라미터 제어
 *  - gall-detail-lnktb 단일 패스 추출
 *  - 날짜 범위 필터
 *  - maxPages / maxConsecutiveNoDatePages 안전장치
 *  - JSON 저장
 ******************************************************************************/
async function crawlGallary(page, opts = {}) {
  if (!page) throw new Error("crawlGallary: page is required");

  const {
    tab,
    date,
    recommend = false,
    keyword,
    amount,
    outDir = "./out",
    fileName,
    maxPages = 300,
    maxConsecutiveNoDatePages = 8,
  } = opts;

  if (!keyword) throw new Error("crawlGallary: opts.keyword is required");
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("crawlGallary: opts.amount must be a positive number");
  }

  if (recommend === true) await selectRecommend(page);
  if (typeof tab === "string" && tab.length > 0) await selectTab(page, tab);

  const range = date ? parseRange(date) : null;
  const now = new Date();

  const curUrl = toURL(page.url());
  const startPageNum = Number(curUrl.searchParams.get("page") || "1") || 1;

  const collected = [];
  let pageNum = startPageNum;
  let pagesVisited = 0;
  let stopReason = null;
  let consecutiveNoDatePages = 0;

  while (collected.length < amount) {
    if (pagesVisited >= maxPages) {
      stopReason = "max_pages_reached";
      console.log(`[dc][crawl] STOP ${stopReason} maxPages=${maxPages}`);
      break;
    }

    pagesVisited += 1;
    console.log(
      `[dc][crawl] LOOP page=${pageNum} url=${page.url()} collected=${collected.length}/${amount}`
    );

    await page.waitForSelector("body", { timeout: 20000 });
    await sleep(300);

    const items = await safeEvaluate(
      page,
      ({ keyword: kwArg, limit }) => {
        const kw = String(kwArg).toLowerCase();
        const pickText = (el) => (el?.textContent || el?.innerText || "").trim();
        const normHref = (href) => {
          try {
            return new URL(href, location.href).href;
          } catch {
            return String(href || "");
          }
        };

        const rows = Array.from(document.querySelectorAll("div.gall-detail-lnktb"));
        const out = [];

        for (const row of rows) {
          const a = row.querySelector(
            'a[href*="/board/"], a[href*="/mgallery/"], a[href*="/mini/"], a[href]',
          );
          if (!a) continue;

          const url = normHref(a.getAttribute("href") || a.href || "");
          if (!url) continue;
          if (!url.includes("/board/") && !url.includes("/mgallery/") && !url.includes("/mini/")) continue;

          const titleEl = row.querySelector(".subjectin") || row.querySelector(".subject");
          const title = pickText(titleEl);
          if (!title) continue;
          if (!title.toLowerCase().includes(kw)) continue;

          const infoLis = Array.from(row.querySelectorAll("ul.ginfo > li"));
          const info = infoLis.map((li) => pickText(li));

          out.push({
            title,
            url,
            tab: info[0] || null,
            user: info[1] || null,
            dateTime: info[2] || null,
            views: info[3] || null,
            upAdd: info[4] || null,
            source: "gall-detail-lnktb",
          });

          if (out.length >= limit) break;
        }

        return out;
      },
      { keyword, limit: Math.max(50, amount) }
    );

    console.log(`[dc][crawl] extracted=${items?.length} raw`);

    let newestOnPage = null;
    let oldestOnPage = null;
    let parsedDateCount = 0;
    let addedThisPage = 0;

    const itemsArr = Array.isArray(items) ? items : [];

    for (let i = 0; i < itemsArr.length; i += 1) {
      const it = itemsArr[i];
      const postDate = toPostDate(it?.dateTime, now);

      if (postDate) {
        parsedDateCount += 1;
        if (!newestOnPage || postDate.getTime() > newestOnPage.getTime()) newestOnPage = postDate;
        if (!oldestOnPage || postDate.getTime() < oldestOnPage.getTime()) oldestOnPage = postDate;
      }

      if (!range) {
        collected.push(it);
        addedThisPage += 1;
      } else {
        if (!postDate) continue;

        const inRange =
          postDate.getTime() >= range.start.getTime() &&
          postDate.getTime() <= range.end.getTime();

        if (inRange) {
          collected.push(it);
          addedThisPage += 1;
          console.log(
            `[dc][crawl] +1 title="${(it?.title || "").slice(0, 40)}" dateTime="${it?.dateTime}" -> date(KST)=${formatKST_YYYY_MM_DD(postDate)}`
          );
        }
      }

      if (collected.length >= amount) break;
    }

    const newestStr = newestOnPage ? formatKST_YYYY_MM_DD(newestOnPage) : "n/a";
    const oldestStr = oldestOnPage ? formatKST_YYYY_MM_DD(oldestOnPage) : "n/a";
    const rangeStr = range
      ? `${formatKST_YYYY_MM_DD(range.start)}~${formatKST_YYYY_MM_DD(range.end)}`
      : "none";

    console.log(
      `[dc][crawl] PAGE_DONE page=${pageNum} added=${addedThisPage} parsedDates=${parsedDateCount} newest=${newestStr} oldest=${oldestStr} range=${rangeStr} total=${collected.length}/${amount}`
    );

    if (range) {
      if (parsedDateCount === 0) consecutiveNoDatePages += 1;
      else consecutiveNoDatePages = 0;

      if (consecutiveNoDatePages >= maxConsecutiveNoDatePages) {
        stopReason = "date_parse_failed";
        console.log(
          `[dc][crawl] STOP ${stopReason} consecutiveNoDatePages=${consecutiveNoDatePages}`
        );
        break;
      }

      if (newestOnPage && newestOnPage.getTime() < range.start.getTime()) {
        stopReason = "date_out_of_range";
        console.log(
          `[dc][crawl] STOP ${stopReason} newest=${newestStr} < start=${formatKST_YYYY_MM_DD(range.start)}`
        );
        break;
      }
    }

    if (collected.length >= amount) {
      stopReason = "amount_reached";
      console.log(`[dc][crawl] STOP ${stopReason}`);
      break;
    }

    pageNum += 1;
    console.log(`[dc][crawl] MOVE nextPage=${pageNum}`);
    await movePage(page, pageNum);
  }

  const finalItems = collected.slice(0, amount);
  console.log(
    `[dc][crawl] FINISH total=${finalItems.length} pagesVisited=${pagesVisited} stopReason=${stopReason}`
  );

  const baseOut = process.env.BOT_USER_DATA || process.cwd();
  const safeDir = path.resolve(baseOut, outDir);
  await fs.promises.mkdir(safeDir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outName = fileName || `crawl_${ts}.json`;
  const filePath = path.join(safeDir, outName);

  const payload = {
    filters: { tab: tab ?? null, date: date ?? null, recommend: !!recommend, keyword, amount },
    crawledAt: new Date().toISOString(),
    startUrl: page.url(),
    pagesVisited,
    stopReason,
    count: finalItems.length,
    items: finalItems,
  };

  await fs.promises.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
  return { filePath, items: finalItems, meta: payload };
}

/** ****************************************************************************
 * 댓글 작성
 ******************************************************************************/
async function writeComment(page, text) {
  if (!page) throw new Error("writeComment: page is required");
  if (!text) throw new Error("writeComment: text is required");

  const memoSel = "textarea#comment_memo";
  const submitSel = "button.btn-comment-write";

  await page.waitForSelector(memoSel, { timeout: 20000 });
  await page.focus(memoSel);

  await safeEvaluate(page, (sel) => {
    const el = document.querySelector(sel);
    if (el) el.value = "";
  }, memoSel);

  await page.keyboard.type(String(text), { delay: 20 });

  const beforeUrl = page.url();
  await Promise.allSettled([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => null),
    safeEvaluate(page, (sel) => {
      const btn = document.querySelector(sel);
      if (!btn) return false;
      btn.scrollIntoView({ block: "center", inline: "center" });
      btn.click();
      return true;
    }, submitSel),
  ]);

  if (page.url() === beforeUrl) {
    await page.waitForFunction(
      (sel) => {
        const el = document.querySelector(sel);
        return !el || (el.value || "").trim().length === 0;
      },
      { timeout: 15000 },
      memoSel
    ).catch(() => {});
  }

  return true;
}

module.exports = {
  naverSearchWithGivenInput,
  clickFirstDcinsideResult,
  loginDcinside,

  searchGallary,
  clickFirstGalleryFromResult,

  crawlGallary,
  writeComment,

  toURL,
  toHref,
  setParam,
};