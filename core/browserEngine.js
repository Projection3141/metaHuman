/**
 * core/browserEngine.js
 * 공통 브라우저 엔진
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const puppeteerExtra = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

const { ensureDir } = require("./helpers");
const { gotoUrlSafe, waitForSelectorSafe } = require("./navigation");

function attachFrameLifecycleDebug(page, opts = {}) {
  const tag = opts.tag || page.__botMeta?.tag || "page";
  const logFrame = (event, frame) => {
    const url = typeof frame?.url === "function" ? frame.url() : "";
    const name = typeof frame?.name === "function" ? frame.name() : "";
    console.log(`[bot][${tag}][${event}] name=${name} url=${url}`);
  };

  page.on("frameattached", (frame) => logFrame("frameattached", frame));
  page.on("framenavigated", (frame) => logFrame("framenavigated", frame));
  page.on("framedetached", (frame) => logFrame("framedetached", frame));

  if (opts.cdp && page.target && typeof page.target === "function") {
    page
      .target()
      .createCDPSession()
      .then((client) => {
        client.send("Page.enable").catch(() => { });
        client.on("Page.frameAttached", (payload) => {
          console.log(`[bot][${tag}:cdp] frameAttached id=${payload.frameId}`);
        });
        client.on("Page.frameNavigated", (payload) => {
          console.log(`[bot][${tag}:cdp] frameNavigated id=${payload.frame.id} url=${payload.frame.url}`);
        });
        client.on("Page.frameDetached", (payload) => {
          console.log(`[bot][${tag}:cdp] frameDetached id=${payload.frameId}`);
        });
      })
      .catch(() => { });
  }
}

puppeteerExtra.use(StealthPlugin());

/** ****************************************************************************
 * 공통 경로 유틸
 ******************************************************************************/
function firstExisting(paths) {
  for (const p of paths) {
    if (!p) continue;
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /** ignore */
    }
  }
  return null;
}

function getReadableAppPath(...segments) {
  const rel = path.join(...segments);

  const candidates = [
    /** 개발 환경 app root */
    process.env.BOT_APP_ROOT ? path.join(process.env.BOT_APP_ROOT, rel) : null,

    /** 패키징 후 unpacked */
    process.env.BOT_RESOURCES_PATH
      ? path.join(process.env.BOT_RESOURCES_PATH, "app.asar.unpacked", rel)
      : null,

    /** 패키징 후 asar */
    process.env.BOT_RESOURCES_PATH
      ? path.join(process.env.BOT_RESOURCES_PATH, "app.asar", rel)
      : null,

    /** 현재 파일 기준 개발 fallback */
    path.resolve(__dirname, "..", rel),
  ];

  return firstExisting(candidates) || candidates.find(Boolean);
}

/** ****************************************************************************
 * profiles.json 로드
 ******************************************************************************/
const DEFAULT_PROFILE_FILE = getReadableAppPath("profiles.json");

const PROFILE_STORE = {
  filePath: DEFAULT_PROFILE_FILE,
  loadedAt: 0,
  defaultKey: "kr",
  globals: {},
  profiles: {},
};

function loadProfiles(filePath = DEFAULT_PROFILE_FILE) {
  const abs = path.isAbsolute(filePath)
    ? filePath
    : getReadableAppPath(filePath);

  if (!abs || !fs.existsSync(abs)) {
    console.warn("[browserEngine] profiles.json not found, using defaults:", abs);

    PROFILE_STORE.filePath = abs || "";
    PROFILE_STORE.loadedAt = Date.now();
    PROFILE_STORE.defaultKey = "kr";
    PROFILE_STORE.globals = {};
    PROFILE_STORE.profiles = {};
    return;
  }

  const txt = fs.readFileSync(abs, "utf8");
  const parsed = JSON.parse(txt);

  PROFILE_STORE.filePath = abs;
  PROFILE_STORE.loadedAt = Date.now();
  PROFILE_STORE.defaultKey = typeof parsed?.default === "string" ? parsed.default : "kr";
  PROFILE_STORE.globals =
    parsed?.globals && typeof parsed.globals === "object" ? parsed.globals : {};
  PROFILE_STORE.profiles =
    parsed?.profiles && typeof parsed.profiles === "object" ? parsed.profiles : {};
}

function getGlobals() {
  return { ...PROFILE_STORE.globals };
}

function getLocaleProfile(localeProfileKey) {
  const key = localeProfileKey || PROFILE_STORE.defaultKey;
  return PROFILE_STORE.profiles[key] || PROFILE_STORE.profiles[PROFILE_STORE.defaultKey] || {};
}

loadProfiles();

/** ****************************************************************************
 * 캐시
 ******************************************************************************/
const MAX_BROWSERS = 4;
const BROWSER_CACHE = new Map();
const TEMP_BROWSERS = new Set();
const PROFILE_PROMOTIONS = new WeakMap();

/** ****************************************************************************
 * 기본값
 ******************************************************************************/
function pickDefaultsFromGlobals() {
  const g = getGlobals();

  return {
    headless: typeof g.headless === "boolean" ? g.headless : false,
    width: Number.isFinite(g.width) ? g.width : 1280,
    height: Number.isFinite(g.height) ? g.height : 1300,
    baseChromeArgs: Array.isArray(g.baseChromeArgs) ? g.baseChromeArgs : [],
    ui: g.ui && typeof g.ui === "object" ? g.ui : {},
    mobile: g.mobile && typeof g.mobile === "object" ? g.mobile : {},
  };
}

function baseChromeArgs({ width, height, extraArgs = [] }) {
  const d = pickDefaultsFromGlobals();

  return [
    `--window-size=${width},${height}`,
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-features=IsolateOrigins,site-per-process",
    "--disable-site-isolation-trials",
    ...d.baseChromeArgs,
    ...extraArgs,
  ];
}

/** ****************************************************************************
 * userDataDir
 ******************************************************************************/
function getProfilesBaseDir() {
  /** child process에서 main이 주입한 경로를 최우선 사용 */
  const userDataRoot =
    process.env.BOT_USER_DATA ||
    path.join(os.homedir(), ".automation-bot");

  const base = path.join(userDataRoot, "puppeteer_profiles");
  ensureDir(base);
  return base;
}

function getSafeStorageKey(storageKey = "default") {
  /**
   * 폴더명으로 안전하게 사용할 수 있게 정리한다.
   */
  return String(storageKey).replace(/[^\w\-]+/g, "_");
}

function normalizeUserDataDirMode(mode) {
  /**
   * persistent:
   *  - 기존 로그인 유지
   *
   * temp:
   *  - 새 로그인 1회 사용
   *
   * promote:
   *  - 새 로그인 후 persistent로 저장
   */
  if (mode === "temp") return "temp";
  if (mode === "promote") return "promote";
  return "persistent";
}

function getPersistentUserDataDir(storageKey = "default") {
  const base = getProfilesBaseDir();
  const safeKey = getSafeStorageKey(storageKey);
  return path.join(base, safeKey);
}

function getPromoteUserDataDir(storageKey = "default") {
  const base = getProfilesBaseDir();
  const safeKey = getSafeStorageKey(storageKey);
  return path.join(base, `${safeKey}__promote`);
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function removeDirSafe(dir) {
  try {
    fs.rmSync(dir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  } catch {
    /** ignore */
  }
}

function moveDirSafe(sourceDir, targetDir) {
  /**
   * 기존 persistent 프로필을 삭제하고 promote 프로필을 이동한다.
   */
  removeDirSafe(targetDir);

  try {
    fs.renameSync(sourceDir, targetDir);
    return;
  } catch {
    /**
     * Windows에서 rename이 실패하는 경우를 대비한 fallback.
     */
    fs.cpSync(sourceDir, targetDir, {
      recursive: true,
      force: true,
    });

    removeDirSafe(sourceDir);
  }
}

function resolveUserDataDir(storageKey = "default", mode = "persistent") {
  const normalizedMode = normalizeUserDataDirMode(mode);
  const base = getProfilesBaseDir();
  const safeKey = String(storageKey).replace(/[^\w\-]+/g, "_");

  if (normalizedMode === "temp") {
    const dir = path.join(
      base,
      `${safeKey}__tmp__${Date.now()}__${Math.random().toString(16).slice(2)}`
    );
    ensureDir(dir);
    return dir;
  }

  if (normalizedMode === "promote") {
    const dir = getPromoteUserDataDir(storageKey);

    removeDirSafe(dir);
    ensureDir(dir);

    return dir;
  }

  /**
   * 기존 로그인 유지:
   * - storageKey 기준 고정 프로필 사용
   */
  const dir = getPersistentUserDataDir(storageKey);

  ensureDir(dir);
  return dir;
}

/** ****************************************************************************
 * page 컨텍스트 적용
 ******************************************************************************/
async function applyPageContext(page, opts = {}) {
  const {
    viewport,
    acceptLanguage,
    timezone,
    userAgent,
    tag = "page",
    useMobile = false,
  } = opts;

  if (acceptLanguage) {
    try {
      await page.setExtraHTTPHeaders({ "Accept-Language": acceptLanguage });
    } catch { }
  }

  if (viewport) {
    try {
      await page.setViewport(viewport);
    } catch { }
  }

  if (timezone) {
    try {
      await page.emulateTimezone(timezone);
    } catch { }
  }

  if (userAgent) {
    try {
      await page.setUserAgent(String(userAgent));
    } catch { }
  }

  attachFrameLifecycleDebug(page, { tag, cdp: opts.debugLifecycleCdp });
  page.on("error", (err) => console.log(`[bot][${tag}:error]`, err?.message || err));
  page.on("pageerror", (err) => console.log(`[bot][${tag}:pageerror]`, err?.message || err));

  page.__botMeta = {
    viewport,
    extraHTTPHeaders: acceptLanguage ? { "Accept-Language": acceptLanguage } : {},
    timezone,
    tag,
    useMobile,
    userAgent,
  };

  return page;
}

/** ****************************************************************************
 * LRU
 ******************************************************************************/
function touchLRU(key) {
  const entry = BROWSER_CACHE.get(key);
  if (!entry) return;
  entry.lastUsedAt = Date.now();
  BROWSER_CACHE.delete(key);
  BROWSER_CACHE.set(key, entry);
}

async function evictKey(key) {
  const entry = BROWSER_CACHE.get(key);
  if (!entry) return;

  BROWSER_CACHE.delete(key);

  try {
    await entry.browser.close();
  } catch { }
}

async function enforceMaxBrowsers() {
  while (BROWSER_CACHE.size > MAX_BROWSERS) {
    const lruKey = BROWSER_CACHE.keys().next().value;
    await evictKey(lruKey);
  }
}

/** ****************************************************************************
 * browser disconnect 정리
 ******************************************************************************/
function attachBrowserDisconnectCleanup(
  browser,
  {
    storageKey,
    isTemp = false,
    isPromote = false,
  } = {},
) {
  if (!browser || typeof browser.on !== "function") return;

  browser.on("disconnected", () => {
    try {
      if (isPromote) {
        TEMP_BROWSERS.delete(browser);

        console.log("[browserEngine] promote browser disconnected", {
          storageKey,
        });

        return;
      }

      if (isTemp) {
        TEMP_BROWSERS.delete(browser);
        return;
      }

      const entry = BROWSER_CACHE.get(storageKey);
      if (entry?.browser === browser) {
        BROWSER_CACHE.delete(storageKey);
      }
    } catch (error) {
      console.log("[browserEngine] disconnect cleanup failed", {
        storageKey,
        message: error?.message || String(error),
      });
    }
  });
}

/** ****************************************************************************
 * browser 획득
 ******************************************************************************/
async function getBrowser(opts = {}) {
  const d = pickDefaultsFromGlobals();
  const localeProfile = getLocaleProfile(opts.localeProfileKey);

  const {
    storageKey = "default",
    localeProfileKey,
    headless = d.headless,
    width = d.width,
    height = d.height,
    userDataDirMode = "persistent", // "persistent" or "temp"
    launchArgs = [],
  } = opts;

  const normalizedUserDataDirMode = normalizeUserDataDirMode(userDataDirMode);

  if (normalizedUserDataDirMode === "persistent") {
    const cached = BROWSER_CACHE.get(storageKey);

    if (cached?.browser?.isConnected?.()) {
      touchLRU(storageKey);
      return {
        browser: cached.browser,
        userDataDir: cached.userDataDir,
        storageKey,
        localeProfile,
        isTemp: false,
        isPromote: false,
      };
    }

    if (cached) {
      BROWSER_CACHE.delete(storageKey);
    }
  }

  const userDataDir = resolveUserDataDir(storageKey, normalizedUserDataDirMode);

  const args = baseChromeArgs({
    width,
    height,
    extraArgs: [
      ...(Array.isArray(localeProfile.chromeArgs) ? localeProfile.chromeArgs : []),
      ...(Array.isArray(launchArgs) ? launchArgs : []),
    ],
  });

  const browser = await puppeteerExtra.launch({
    headless,
    userDataDir,
    args,
    defaultViewport: d.ui?.defaultViewportNull ? null : { width, height },
  });

  if (normalizedUserDataDirMode === "persistent") {
    BROWSER_CACHE.set(storageKey, {
      browser,
      userDataDir,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    });

    attachBrowserDisconnectCleanup(browser, {
      storageKey,
      isTemp: false,
      isPromote: false,
      userDataDir,
    });

    await enforceMaxBrowsers();
  } else {
    TEMP_BROWSERS.add(browser);

    if (normalizedUserDataDirMode === "promote") {
      PROFILE_PROMOTIONS.set(browser, {
        storageKey,
        userDataDir,
        armed: false,
      });
    }

    attachBrowserDisconnectCleanup(browser, {
      storageKey,
      isTemp: normalizedUserDataDirMode === "temp",
      isPromote: normalizedUserDataDirMode === "promote",
      userDataDir,
    });
  }

  return {
    browser,
    userDataDir,
    storageKey,
    localeProfile,
    isTemp: normalizedUserDataDirMode === "temp",
    isPromote: normalizedUserDataDirMode === "promote",
  };
}

/** ****************************************************************************
 * openPage
 *
 * 중요:
 *  - storageKey: 세션/프로필 폴더 이름
 *  - localeProfileKey: profiles.json 내부의 kr/en/jp 같은 키
 *  - useMobile: 이 페이지에 모바일 에뮬레이션 적용 여부
 ******************************************************************************/
async function openPage(opts = {}) {
  const d = pickDefaultsFromGlobals();

  const {
    url,
    storageKey = "default",
    localeProfileKey,
    headless = d.headless,
    viewport = { width: d.width, height: d.height },
    userDataDirMode = "persistent",
    tag = "page",
    useMobile = false,
    launchArgs = [],
  } = opts;

  if (!url) throw new Error("openPage: url is required");

  const { browser, userDataDir, localeProfile, isTemp, isPromote } = await getBrowser({
    storageKey,
    localeProfileKey,
    headless,
    width: viewport.width,
    height: viewport.height,
    userDataDirMode,
    launchArgs,
  });

  let page = await browser.newPage();

  let finalViewport = viewport;
  let finalUserAgent = null;

  if (useMobile && d.mobile?.enabled) {
    finalViewport = d.mobile.viewport || viewport;
    finalUserAgent = d.mobile.userAgent || null;
  }

  page = await applyPageContext(page, {
    viewport: finalViewport,
    acceptLanguage: localeProfile.acceptLanguage,
    timezone: localeProfile.timezone,
    userAgent: finalUserAgent,
    tag,
    useMobile,
  });

  page = await gotoUrlSafe(page, url, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
    tag: `${tag}:goto`,
  });

  await waitForSelectorSafe(page, "body", 25000);

  return {
    browser,
    page,
    userDataDir,
    storageKey,
    localeProfileKey: localeProfileKey || PROFILE_STORE.defaultKey,
    isTemp,
    isPromote,
  };
}

async function closeProfile(storageKey) {
  const entry = BROWSER_CACHE.get(storageKey);
  if (!entry) return;

  BROWSER_CACHE.delete(storageKey);

  try {
    await entry.browser.close();
  } catch { }
}

function armProfilePromotion(browser) {
  /**
   * promote 모드 브라우저만 저장 대상으로 표시한다.
   * 로그인 성공이 확인된 뒤에만 호출해야 한다.
   */
  const promotion = PROFILE_PROMOTIONS.get(browser);

  if (!promotion) {
    return false;
  }

  promotion.armed = true;
  PROFILE_PROMOTIONS.set(browser, promotion);

  console.log("[browserEngine] profile promotion armed", {
    storageKey: promotion.storageKey,
    userDataDir: promotion.userDataDir,
  });

  return true;
}

/**
 * promote 프로필을 persistent 프로필로 확정 저장한다.
 *
 * 역할:
 *  - "새 로그인 후 유지" 모드에서 로그인 성공한 프로필을 기존 로그인 유지 프로필로 교체한다.
 *
 * 중요:
 *  - 반드시 browser.close() 이후에 폴더를 이동한다.
 *  - Windows에서는 Chrome 종료 직후 파일 lock이 늦게 풀릴 수 있으므로 짧게 대기한다.
 */
async function finalizeProfilePromotion(browser) {
  if (!browser) {
    return false;
  }

  const promotion = PROFILE_PROMOTIONS.get(browser);

  /**
   * promote 대상 브라우저가 아니면 아무것도 하지 않는다.
   */
  if (!promotion) {
    return false;
  }

  /**
   * 로그인 성공 전에 종료된 경우 기존 persistent 계정을 유지한다.
   */
  if (!promotion.armed) {
    PROFILE_PROMOTIONS.delete(browser);
    TEMP_BROWSERS.delete(browser);

    try {
      if (browser.isConnected?.()) {
        await browser.close();
      }
    } catch {
      /** ignore */
    }

    removeDirSafe(promotion.userDataDir);

    console.log("[browserEngine][profilePromotion] 로그인 성공 전 종료되어 새 로그인 프로필 폐기", {
      storageKey: promotion.storageKey,
      userDataDir: promotion.userDataDir,
    });

    return false;
  }

  const { storageKey, userDataDir } = promotion;
  const persistentDir = getPersistentUserDataDir(storageKey);

  PROFILE_PROMOTIONS.delete(browser);
  TEMP_BROWSERS.delete(browser);

  /**
   * 같은 storageKey의 persistent 브라우저가 캐시에 있으면 먼저 닫는다.
   */
  await closeProfile(storageKey);

  /**
   * promote 브라우저를 명시적으로 닫는다.
   */
  try {
    if (browser.isConnected?.()) {
      await browser.close();
    }
  } catch {
    /** ignore */
  }

  /**
   * Chrome 프로필 파일 lock 해제 대기.
   */
  await waitMs(1000);

  /**
   * promote 프로필을 persistent 프로필로 교체한다.
   */
  moveDirSafe(userDataDir, persistentDir);

  console.log("[browserEngine][profilePromotion] 로그인 유지 계정이 새 로그인 계정으로 변경됨", {
    storageKey,
    from: userDataDir,
    to: persistentDir,
  });

  return true;
}

async function closeAll() {
  for (const key of Array.from(BROWSER_CACHE.keys())) {
    await closeProfile(key);
  }

  for (const browser of Array.from(TEMP_BROWSERS)) {
    try {
      await browser.close();
    } catch { }
    TEMP_BROWSERS.delete(browser);
  }
}

module.exports = {
  loadProfiles,
  getGlobals,
  getLocaleProfile,
  getBrowser,
  openPage,
  closeProfile,
  closeAll,
  armProfilePromotion,
  finalizeProfilePromotion,
};