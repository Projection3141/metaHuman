/**
 * core/browserEngine.js
 * 공통 브라우저 엔진
 */

const fs = require("fs");
const path = require("path");
const puppeteerExtra = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

const { ensureDir } = require("./helpers");
const { gotoUrlSafe, waitForSelectorSafe, safeWaitForFunction } = require("./navigation");

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

function resolveUserDataDir(storageKey = "default", mode = "persistent") {
  const base = getProfilesBaseDir();
  const safeKey = String(storageKey).replace(/[^\w\-]+/g, "_");

  if (mode === "temp") {
    const dir = path.join(
      base,
      `${safeKey}__tmp__${Date.now()}__${Math.random().toString(16).slice(2)}`
    );
    ensureDir(dir);
    return dir;
  }

  const dir = path.join(base, safeKey);
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

  page.on("framedetached", () => console.log(`[bot][${tag}] framedetached`));
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
    userDataDirMode = "persistent",
    launchArgs = [],
  } = opts;

  if (userDataDirMode === "persistent") {
    const cached = BROWSER_CACHE.get(storageKey);
    if (cached?.browser?.isConnected?.()) {
      touchLRU(storageKey);
      return {
        browser: cached.browser,
        userDataDir: cached.userDataDir,
        storageKey,
        localeProfile,
        isTemp: false,
      };
    }
  }

  const userDataDir = resolveUserDataDir(storageKey, userDataDirMode);

  const args = baseChromeArgs({
    width,
    height,
    extraArgs: [
      ...(Array.isArray(localeProfile.chromeArgs) ? localeProfile.chromeArgs : []),
      ...(Array.isArray(launchArgs) ? launchArgs : []),
    ],
  });

  const browser = await puppeteerExtra.launch({
    headless, // true : 브라우저 창 숨김, false : 브라우저 창 표시
    userDataDir,
    args,
    defaultViewport: d.ui?.defaultViewportNull ? null : { width, height },
  });

  if (userDataDirMode === "persistent") {
    BROWSER_CACHE.set(storageKey, {
      browser,
      userDataDir,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    });
    await enforceMaxBrowsers();
  } else {
    TEMP_BROWSERS.add(browser);
  }

  return {
    browser,
    userDataDir,
    storageKey,
    localeProfile,
    isTemp: userDataDirMode === "temp",
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

  const { browser, userDataDir, localeProfile, isTemp } = await getBrowser({
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

  await applyPageContext(page, {
    viewport: finalViewport,
    acceptLanguage: localeProfile.acceptLanguage,
    timezone: localeProfile.timezone,
    userAgent: finalUserAgent,
    tag,
    useMobile,
  });

  await gotoUrlSafe(page, url, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  page = await safeWaitForFunction(
    page,
    () => document.body && document.body.children.length > 0,
    { tag: "pageReady" }
  );

  await waitForSelectorSafe(page, "body", 25000).catch(async () => {
    await waitForSelectorSafe(page, "html", 25000);
  });

  return {
    browser,
    page,
    userDataDir,
    storageKey,
    localeProfileKey: localeProfileKey || PROFILE_STORE.defaultKey,
    isTemp,
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
};