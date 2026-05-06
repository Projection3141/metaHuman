/**
 * main.js
 *
 * =============================================================================
 * ELECTRON MAIN PROCESS
 * =============================================================================
 *
 * 역할:
 *  1) Electron BrowserWindow 생성 및 관리
 *  2) preload.js를 통해 renderer와 안전하게 IPC 연결
 *  3) 각 플랫폼 봇을 child process로 실행 및 중지
 *  4) stdout / stderr 로그를 renderer로 실시간 전달
 *  5) 각 봇 상태(idle/running/stopped/error) 관리
 *  6) 실행 이력 및 계정 관리
 *
 * 왜 child process로 실행하나?
 *  - Puppeteer 브라우저 자동화는 프로세스를 분리하는 편이 안정적이다.
 *  - Reddit / Instagram / DCInside가 서로 브라우저/메모리/예외를 독립적으로 처리할 수 있다.
 *  - 기존 run*.js를 큰 수정 없이 재사용할 수 있다.
 *
 * 포함된 함수들:
 *  - getUserDataRoot(): 사용자 데이터 루트 경로 반환
 *  - getHistoryDir(): 이력 저장 디렉터리 경로 반환
 *  - getHistoryFile(): 이력 파일 경로 반환
 *  - getAccountFile(): 계정 파일 경로 반환
 *  - ensureHistoryDir(): 이력 디렉터리 생성 보장
 *  - appendHistory(entry): 이력에 항목 추가
 *  - readHistory(): 이력 읽기
 *  - readAccounts(): 계정 읽기
 *  - writeAccounts(accounts): 계정 쓰기
 *  - addAccount(name, username, password): 계정 추가
 *  - removeAccount(name): 계정 삭제
 *  - getAppResourcePath(...segments): 앱 리소스 경로 반환
 *  - createWindow(): 브라우저 윈도우 생성
 *  - getMainWindow(): 메인 윈도우 가져오기
 *  - sendStatus(key): 상태 전송
 *  - sendLog(payload): 로그 전송
 *  - pushLog(key, level, message): 로그 푸시
 * =============================================================================
 */

require("dotenv").config(); 

const fs = require("fs");
const path = require("path");
const { app, BrowserWindow, ipcMain, utilityProcess, Menu } = require("electron");
const { exec } = require("child_process");

/** ****************************************************************************
 * 앱 이름 고정
 ******************************************************************************/
app.setName("automation-bot");

/** ****************************************************************************
 * 사용자 데이터 루트 경로 반환
 * @returns {string} Electron의 userData 경로
 * 로직: app.getPath("userData")를 사용하여 Electron의 사용자 데이터 디렉터리를 반환
 ******************************************************************************/
function getUserDataRoot() {
  return app.getPath("userData");
}

/** ****************************************************************************
 * 이력 저장 디렉터리 경로 반환
 * @returns {string} 이력 디렉터리 경로
 * 로직: getUserDataRoot()와 path.join을 사용하여 "history" 경로를 구성
 ******************************************************************************/
function getHistoryDir() {
  return path.join(getUserDataRoot(), "history");
}

/** ****************************************************************************
 * 이력 파일 경로 반환
 * @returns {string} 이력 파일 경로
 ******************************************************************************/
function getHistoryFile() {
  return path.join(getHistoryDir(), "history.log");
}

/** ****************************************************************************
 * 계정 저장 경로
 ******************************************************************************/
/** ****************************************************************************
 * 계정 파일 경로 반환
 * @returns {string} 계정 파일 경로
 * 로직: getUserDataRoot()와 path.join을 사용하여 "account.json" 파일 경로를 구성
 ******************************************************************************/
function getAccountFile() {
  return path.join(getUserDataRoot(), "account.json");
}

/** ****************************************************************************
 * 이력 디렉터리 생성 보장
 * 로직: fs.mkdirSync를 사용하여 getHistoryDir() 경로의 디렉터리를 재귀적으로 생성, 에러 발생 시 무시
 ******************************************************************************/
function ensureHistoryDir() {
  try {
    fs.mkdirSync(getHistoryDir(), { recursive: true });
  } catch {
    /** ignore */
  }
}

function appendHistory(entry) {
  try {
    ensureHistoryDir();
    const line = JSON.stringify({
      createdAt: new Date().toISOString(),
      ...entry,
    });
    fs.appendFileSync(getHistoryFile(), line + "\n", "utf8");
  } catch {
    /** ignore */
  }
}

function readHistory() {
  try {
    ensureHistoryDir();

    const historyFile = getHistoryFile();
    if (!fs.existsSync(historyFile)) return [];

    const raw = fs.readFileSync(historyFile, "utf8");

    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return { raw: line };
        }
      });
  } catch {
    return [];
  }
}

/** ****************************************************************************
 * 앱 리소스 / 스크립트 경로
 ******************************************************************************/
function getAppResourcePath(...segments) {
  if (app.isPackaged) {
    const unpackedPath = path.join(process.resourcesPath, "app.asar.unpacked", ...segments);
    if (fs.existsSync(unpackedPath)) return unpackedPath;

    const asarPath = path.join(process.resourcesPath, "app.asar", ...segments);
    if (fs.existsSync(asarPath)) return asarPath;
  }

  return path.join(__dirname, ...segments);
}

/** ****************************************************************************
 * 봇 정의
 *
 * key:
 *  - 내부 식별자
 *
 * label:
 *  - UI 표시용 이름
 *
 * runnerPath:
 *  - 실제 실행할 Node runner 파일
 ******************************************************************************/
const BOT_DEFS = {
  reddit: {
    key: "reddit",
    label: "Reddit",
    runnerPath: getAppResourcePath("platforms", "reddit", "runReddit.js"),
  },
  instagram: {
    key: "instagram",
    label: "Instagram",
    runnerPath: getAppResourcePath("platforms", "instagram", "runInstagram.js"),
  },
  dc: {
    key: "dc",
    label: "DCInside",
    runnerPath: getAppResourcePath("platforms", "dcinside", "runDcinside.js"),
  },
  thread: {
    key: "thread",
    label: "Thread",
    runnerPath: getAppResourcePath("platforms", "thread", "runThread.js"),
  },
};

/** ****************************************************************************
 * 상태 저장소
 *
 * status:
 *  - idle
 *  - running
 *  - stopped
 *  - error
 ******************************************************************************/
const BOT_STATE = Object.fromEntries(
  Object.keys(BOT_DEFS).map((key) => [
    key,
    {
      key,
      label: BOT_DEFS[key].label,
      status: "idle",
      pid: null,
      startedAt: null,
      exitCode: null,
      lastError: "",
    },
  ]),
);

/** ****************************************************************************
 * 실행 중인 child process 저장
 ******************************************************************************/
const RUNNING = new Map();

/** ****************************************************************************
 * BrowserWindow 생성
 *
 * 보안 설정:
 *  - contextIsolation: true
 *  - nodeIntegration: false
 *  - preload만 노출
 ******************************************************************************/
function createWindow() {

  Menu.setApplicationMenu(null);

  const win = new BrowserWindow({
    width: 1280,
    height: 1200,
    minWidth: 1100,
    minHeight: 960,
    autoHideMenuBar: true,
    backgroundColor: "#0f172a",
    webPreferences: {
      preload: path.resolve(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.loadFile(path.resolve(__dirname, "renderer", "index.html"));
  return win;
}

/** ****************************************************************************
 * 현재 메인 윈도우 가져오기
 ******************************************************************************/
function getMainWindow() {
  const wins = BrowserWindow.getAllWindows();
  return wins.length > 0 ? wins[0] : null;
}

/** ****************************************************************************
 * renderer로 상태 전송
 ******************************************************************************/
function sendStatus(key) {
  const win = getMainWindow();
  if (!win) return;

  win.webContents.send("bot:status", {
    ...BOT_STATE[key],
  });
}

/** ****************************************************************************
 * renderer로 로그 전송
 ******************************************************************************/
function sendLog(payload) {
  const win = getMainWindow();
  if (!win) return;

  win.webContents.send("bot:log", payload);
}

/** ****************************************************************************
 * 로그 공통 포맷 전송
 ******************************************************************************/
function pushLog(key, level, message) {
  sendLog({
    key,
    level,
    message: String(message ?? ""),
    ts: new Date().toISOString(),
  });
}

/** ****************************************************************************
 * 상태 부분 업데이트
 ******************************************************************************/
function patchBotState(key, patch) {
  BOT_STATE[key] = {
    ...BOT_STATE[key],
    ...patch,
  };
  sendStatus(key);
}

/** ****************************************************************************
 * runner 로그 -> UI 상태 변환
 ******************************************************************************/
function inferRuntimeStatusFromLog(key, message) {
  const msg = String(message || "");

  /** ------------------------------------------------------------------------
   * Reddit
   * ---------------------------------------------------------------------- */
  if (key === "reddit") {
    if (msg.includes("[runReddit] waiting for manual login")) {
      return "waiting_login";
    }

    if (
      msg.includes("[runReddit] login detected") ||
      msg.includes("[runReddit] comment job starting")
    ) {
      return "running";
    }

    if (
      msg.includes("[runReddit] no comment job config, standby after login") ||
      msg.includes("[runReddit] entering post-run-standby")
    ) {
      return "standby";
    }
  }

  /** ------------------------------------------------------------------------
   * Thread
   * ---------------------------------------------------------------------- */
  if (key === "thread") {
    if (msg.includes("[runThread] waiting for manual login")) {
      return "waiting_login";
    }

    if (
      msg.includes("[runThread] login detected") ||
      msg.includes("[runThread] comment job starting")
    ) {
      return "running";
    }

    if (
      msg.includes("[runThread] no comment job config, standby after login") ||
      msg.includes("[runThread] comment job completed") ||
      msg.includes("[runThread] entering post-run-standby")
    ) {
      return "standby";
    }
  }

  return null;
}

function applyRuntimeStatusFromLog(key, message) {
  const nextStatus = inferRuntimeStatusFromLog(key, message);
  if (!nextStatus) return;

  if (BOT_STATE[key]?.status !== nextStatus) {
    patchBotState(key, { status: nextStatus });
  }
}

/** ****************************************************************************
 * 종료 이벤트 1회 대기
 *
 * utilityProcess: exit 중심
 ******************************************************************************/
function waitForChildExit(child, timeoutMs = 5000) {
  return new Promise((resolve) => {
    if (!child) {
      resolve({ code: null, signal: null, timedOut: false });
      return;
    }

    let settled = false;

    /** 종료 처리 공통 */
    function done(result) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    }

    /** 이벤트 해제 */
    function cleanup() {
      clearTimeout(timer);

      try { child.off?.("exit", onExit); } catch {}
      try { child.off?.("error", onError); } catch {}

      /** EventEmitter 호환성 */
      try { child.removeListener?.("exit", onExit); } catch {}
      try { child.removeListener?.("error", onError); } catch {}
    }

    /** utilityProcess / child_process 공통 */
    function onExit(code, signal) {
      done({ code, signal, timedOut: false, event: "exit" });
    }

    /** spawn/kill 실패 */
    function onError(err) {
      done({
        code: null,
        signal: null,
        timedOut: false,
        event: "error",
        error: String(err?.message || err || ""),
      });
    }

    const timer = setTimeout(() => {
      done({ code: null, signal: null, timedOut: true, event: "timeout" });
    }, timeoutMs);

    try { child.once?.("exit", onExit); } catch {}
    try { child.once?.("error", onError); } catch {}
  });
}

/** ****************************************************************************
 * Windows / Unix 계열 프로세스 트리 종료
 *
 *  1) 종료 신호/명령을 보냄
 *  2) 실제 종료 이벤트까지 기다림
 *  3) timeout이면 실패로 간주
 * 
 * 설명:
 *  - Puppeteer/Chrome는 자식 프로세스를 여러 개 띄운다.
 *  - 단순 child.kill()만으로는 일부가 남을 수 있다.
 *  - 그래서 Windows에서는 taskkill /T /F 사용
 *  - Unix 계열에서는 기본 kill 후 필요하면 강제 종료
 ******************************************************************************/
async function killProcessTree(child, timeoutMs = 5000) {
  if (!child) {
    return { ok: true, alreadyStopped: true };
  }

  /** pid 없으면 이미 종료됐을 가능성 큼 */
  const pid = child.pid;
  if (!pid) {
    const exitInfo = await waitForChildExit(child, 300);
    return {
      ok: !exitInfo.timedOut,
      alreadyStopped: true,
      ...exitInfo,
    };
  }

  /** Windows */
  if (process.platform === "win32") {
    exec(`taskkill /pid ${pid} /T /F`);
    const exitInfo = await waitForChildExit(child, timeoutMs);

    return {
      ok: !exitInfo.timedOut,
      ...exitInfo,
    };
  }

  /** POSIX 1차: graceful */
  try {
    child.kill("SIGTERM");
  } catch {
    /** ignore */
  }

  let exitInfo = await waitForChildExit(child, 1500);
  if (!exitInfo.timedOut) {
    return { ok: true, ...exitInfo };
  }

  /** POSIX 2차: force */
  try {
    child.kill("SIGKILL");
  } catch {
    /** ignore */
  }

  exitInfo = await waitForChildExit(child, timeoutMs);
  return {
    ok: !exitInfo.timedOut,
    ...exitInfo,
  };
}

/** ****************************************************************************
 * 종료 후 상태 반영 공통
 *
 * utilityProcess는 exit 이벤트로 처리
 ******************************************************************************/
function finalizeBotState(key, code, requestedStop) {
  BOT_STATE[key] = {
    ...BOT_STATE[key],
    status: requestedStop ? "stopped" : code === 0 ? "stopped" : "error",
    pid: null,
    exitCode: Number.isInteger(code) ? code : null,
    lastError:
      requestedStop || code === 0
        ? ""
        : `Process exited with code ${Number.isInteger(code) ? code : "unknown"}`,
  };

  sendStatus(key);
  pushLog(
    key,
    requestedStop || code === 0 ? "system" : "error",
    `[main] ${key} exited (code=${Number.isInteger(code) ? code : "unknown"})`,
  );

  RUNNING.delete(key);
}

/** ****************************************************************************
 * 시작부 종료 이벤트 등록
 *
 * 중요:
 *  - utilityProcess는 exit 사용
 ******************************************************************************/
function bindChildLifecycle(key, child) {
  let finalized = false;

  function finalizeOnce(code) {
    if (finalized) return;
    finalized = true;

    const runtime = RUNNING.get(key);
    const requestedStop = !!runtime?.requestedStop;

    finalizeBotState(key, code, requestedStop);
  }

  /** utilityProcess / child_process 공통 */
  child.on("exit", (code) => {
    finalizeOnce(code);
  });

  child.on("error", (err) => {
    if (finalized) return;

    BOT_STATE[key] = {
      ...BOT_STATE[key],
      status: "error",
      pid: null,
      lastError: String(err?.message || err || ""),
    };

    sendStatus(key);
    pushLog(key, "error", `[main] failed to start ${key}: ${err?.message || err}`);
    RUNNING.delete(key);
    finalized = true;
  });
}

/** ****************************************************************************
 * child process stdout/stderr 연결
 *
 * 단계:
 *  1) line buffer로 stdout/stderr 분리
 *  2) UI 로그 전송
 *  3) 특정 로그 패턴이면 상태 갱신
 ******************************************************************************/
function attachChildLogStream(key, child) {
  function bindStream(stream, level) {
    if (!stream) return;

    let buffer = "";

    stream.on("data", (buf) => {
      buffer += buf.toString("utf8");

      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";

      for (const line of lines) {
        const text = String(line || "");
        if (!text.trim()) continue;

        pushLog(key, level, text);
        applyRuntimeStatusFromLog(key, text);
      }
    });

    stream.on("end", () => {
      const text = String(buffer || "");
      if (!text.trim()) return;

      pushLog(key, level, text);
      applyRuntimeStatusFromLog(key, text);
      buffer = "";
    });
  }

  bindStream(child.stdout, "info");
  bindStream(child.stderr, "error");
}

/** ****************************************************************************
 * 봇 시작
 *
 * 단계:
 *  1) 이미 실행 중인지 확인
 *  2) runnerPath 확인
 *  3) node runnerPath 로 child process 실행
 *  4) 상태 running 반영
 *  5) 종료 시 status를 stopped/error로 반영
 ******************************************************************************/
async function startBot(key, options = {}) {
  const def = BOT_DEFS[key];
  if (!def) {
    return { ok: false, error: `Unknown bot: ${key}` };
  }

  if (!fs.existsSync(def.runnerPath)) {
    return { ok: false, error: `Runner not found: ${def.runnerPath}` };
  }

  const current = RUNNING.get(key);

  /** utilityProcess까지 고려하면 killed 대신 pid 확인이 더 안전 */
  if (current?.child?.pid) {
    return { ok: false, error: `${key} is already running` };
  }

  const env = {
    ...process.env,
    /* ELECTRON_RUN_AS_NODE: "1", */
    BOT_HEADLESS: options.headless ? "1" : "0",
    BOT_USER_DATA: getUserDataRoot(),
    BOT_APP_ROOT: app.getAppPath(),
    BOT_RESOURCES_PATH: process.resourcesPath,
    BOT_APP_NAME: app.getName(),
  };

  /** ------------------------------------------------------------------------
   * Reddit 옵션
   * ---------------------------------------------------------------------- */
  if (key === "reddit" && options.redditConfig) {
    const cfg = options.redditConfig;
    if (cfg.subreddit) env.REDDIT_TARGET_SUBREDDIT = cfg.subreddit;
    if (cfg.keyword) env.REDDIT_TARGET_KEYWORD = cfg.keyword;
    if (cfg.dateRange) env.REDDIT_TARGET_DATE_RANGE = cfg.dateRange;
    if (typeof cfg.commentCount !== "undefined") {
      env.REDDIT_TARGET_COMMENT_COUNT = String(cfg.commentCount);
    }
    if (cfg.recommendLink) env.REDDIT_RECOMMEND_LINK = cfg.recommendLink;
  }

  /** ------------------------------------------------------------------------
   * Thread 옵션
   * ---------------------------------------------------------------------- */
  if (key === "thread" && options.threadConfig) {
    const cfg = options.threadConfig;

    if (cfg.keyword) env.THREAD_TARGET_KEYWORD = cfg.keyword;
    if (cfg.dateRange) env.THREAD_TARGET_DATE_RANGE = cfg.dateRange;
    if (cfg.commentText) env.THREAD_TARGET_COMMENT_TEXT = cfg.commentText;
    if (cfg.searchOption) env.THREAD_SEARCH_OPTION = cfg.searchOption;

    if (typeof cfg.commentCount !== "undefined") {
      env.THREAD_TARGET_COMMENT_COUNT = String(cfg.commentCount);
    }

    if (typeof cfg.exploreMinutes !== "undefined") {
      env.THREAD_TARGET_EXPLORE_MINUTES = String(cfg.exploreMinutes);
    }
  }

  const child = utilityProcess.fork(def.runnerPath, [], {
    cwd: getUserDataRoot(),
    env,
    stdio: "pipe",
  });

  RUNNING.set(key, {
    child,
    requestedStop: false,
  });

  BOT_STATE[key] = {
    ...BOT_STATE[key],
    status: "starting",
    pid: child.pid || null,
    startedAt: new Date().toISOString(),
    exitCode: null,
    lastError: "",
  };

  sendStatus(key);
  pushLog(key, "system", `[main] started ${key} (pid=${child.pid || "n/a"})`);

  attachChildLogStream(key, child);
  bindChildLifecycle(key, child);

  return { ok: true };
}

/** ****************************************************************************
 * 봇 중지
 *
 * 핵심:
 *  1) requestedStop 설정
 *  2) stopping 상태 즉시 반영
 *  3) 실제 종료 이벤트까지 기다림
 *  4) timeout이면 강제로 error 처리
 ******************************************************************************/
async function stopBot(key) {
  const runtime = RUNNING.get(key);
  if (!runtime?.child) {
    return { ok: false, error: `${key} is not running` };
  }

  runtime.requestedStop = true;

  /** UI 즉시 반영 */
  BOT_STATE[key] = {
    ...BOT_STATE[key],
    status: "stopping",
  };
  sendStatus(key);

  pushLog(key, "system", `[main] stopping ${key}...`);

  const result = await killProcessTree(runtime.child, 5000);

  /** 종료 이벤트가 끝내 안 오면 여기서 정리 */
  if (!result.ok) {
    BOT_STATE[key] = {
      ...BOT_STATE[key],
      status: "error",
      pid: null,
      lastError: "Stop timeout: process did not emit exit/close",
    };

    sendStatus(key);
    pushLog(key, "error", `[main] stop timeout for ${key}`);
    RUNNING.delete(key);

    return { ok: false, error: "Process stop timeout" };
  }

  return { ok: true };
}

/** ****************************************************************************
 * 전체 상태 조회
 ******************************************************************************/
function listBots() {
  return Object.keys(BOT_DEFS).map((key) => ({
    ...BOT_STATE[key],
  }));
}

/** ****************************************************************************
 * IPC 등록
 ******************************************************************************/
function registerIpc() {
  ipcMain.handle("bot:list", async () => {
    return listBots();
  });

  ipcMain.handle("bot:start", async (_event, key, options = {}) => {
    return startBot(key, options);
  });

  ipcMain.handle("bot:stop", async (_event, key) => {
    return stopBot(key);
  });

  ipcMain.handle("bot:getHistory", async () => {
    return readHistory();
  });

  ipcMain.handle("account:list", async () => {
    return readAccounts();
  });

  ipcMain.handle("account:add", async (_event, name, username, password) => {
    return addAccount(name, username, password);
  });

  ipcMain.handle("account:remove", async (_event, name) => {
    return removeAccount(name);
  });
}

/** ****************************************************************************
 * 앱 라이프사이클
 ******************************************************************************/
app.whenReady().then(() => {
  createWindow();
  registerIpc();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("before-quit", async () => {
  /** 앱 종료 시 실행 중인 봇들 모두 정리 */
  const keys = Array.from(RUNNING.keys());

  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    // eslint-disable-next-line no-await-in-loop
    await stopBot(key).catch(() => { });
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});