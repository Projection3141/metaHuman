/**
 * core/helpers.js
 *
 * =============================================================================
 * 공통 유틸 모음
 * =============================================================================
 *
 * 역할:
 *  1) sleep
 *  2) 디렉터리 생성
 *  3) 절대경로 변환
 *  4) 파일 읽기 가능 여부 확인
 *  5) 일반 DOM 클릭
 *  6) 일반 input / textarea 값 입력
 *
 * 주의:
 *  - Shadow DOM 전용 제어는 각 플랫폼 internals 파일에서 처리한다.
 *  - 여기서는 공통으로 재사용 가능한 가장 기본 유틸만 둔다.
 * =============================================================================
 */

const fs = require("fs");
const path = require("path");
const { safeEvaluate } = require("./navigation");

/** ****************************************************************************
 * 시간 지연
 ******************************************************************************/
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** ****************************************************************************
 * 디렉터리 보장
 ******************************************************************************/
function ensureDir(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch {
    /** ignore */
  }
}

/** ****************************************************************************
 * 존재하는 첫 경로 반환
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

/** ****************************************************************************
 * 읽기용 앱 리소스 경로 해석
 ******************************************************************************/
function resolveReadablePath(targetPath, { baseDir } = {}) {
  if (!targetPath) {
    throw new Error("resolveReadablePath: targetPath is required");
  }

  if (path.isAbsolute(targetPath)) {
    return targetPath;
  }

  const normalized = String(targetPath).replace(/^[/\\]+/, "");

  const candidates = [
    baseDir ? path.resolve(baseDir, normalized) : null,
    process.env.BOT_APP_ROOT ? path.resolve(process.env.BOT_APP_ROOT, normalized) : null,
    process.env.BOT_RESOURCES_PATH
      ? path.join(process.env.BOT_RESOURCES_PATH, "app.asar.unpacked", normalized)
      : null,
    process.env.BOT_RESOURCES_PATH
      ? path.join(process.env.BOT_RESOURCES_PATH, "app.asar", normalized)
      : null,
    path.resolve(process.cwd(), normalized),
  ];

  return firstExisting(candidates) || candidates.find(Boolean);
}

/** ****************************************************************************
 * 파일 읽기 가능 여부 확인
 ******************************************************************************/
async function assertReadableFile(targetPath, opts = {}) {
  const abs = resolveReadablePath(targetPath, opts);

  await fs.promises.access(abs, fs.constants.R_OK).catch(() => {
    throw new Error(`File not readable: ${abs}`);
  });

  return abs;
}

/** ****************************************************************************
 * 일반 DOM 클릭
 *
 * 설명:
 *  - querySelector로 요소를 찾고
 *  - 보이는 위치로 스크롤한 뒤
 *  - click()을 호출한다.
 *
 * 용도:
 *  - DCInside 같은 일반 DOM 기반 사이트
 ******************************************************************************/
async function domClick(page, selector) {
  if (!page) throw new Error("domClick: page is required");
  if (!selector) throw new Error("domClick: selector is required");

  const ok = await safeEvaluate(page, (sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;

    try {
      el.scrollIntoView({ block: "center", inline: "center" });
    } catch {
      /** ignore */
    }

    const clickable = el instanceof HTMLElement ? el : el.parentElement;
    clickable?.click?.();
    return true;
  }, selector);

  if (!ok) {
    throw new Error(`domClick failed: ${selector}`);
  }
  return true;
}

/** ****************************************************************************
 * 일반 input/textarea 값 입력
 *
 * 설명:
 *  - selector 대기
 *  - focus
 *  - 기존값 비우기
 *  - keyboard.type으로 입력
 *
 * 용도:
 *  - 일반 입력 필드
 ******************************************************************************/
async function setValue(page, selector, value, { timeout = 20000, delay = 25 } = {}) {
  if (!page) throw new Error("setValue: page is required");
  if (!selector) throw new Error("setValue: selector is required");

  await page.waitForSelector(selector, { timeout });
  await page.focus(selector);

  await safeEvaluate(page, (sel) => {
    const el = document.querySelector(sel);
    if (!el) return;

    if ("value" in el) {
      el.value = "";
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, selector);

  await page.keyboard.type(String(value ?? ""), { delay });

  return true;
}

module.exports = {
  sleep,
  ensureDir,
  resolveReadablePath,
  assertReadableFile,
  domClick,
  setValue,
};