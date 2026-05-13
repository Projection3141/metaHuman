/**
 * platforms/instagram/instaInternals.js
 *
 * =============================================================================
 * Instagram 내부 함수
 * =============================================================================
 *
 * 역할:
 *  - Create 아이콘 클릭
 *  - role=button div 텍스트 클릭
 *  - file input 업로드
 *  - Lexical caption editor 입력
 *
 * 주의:
 *  - 외부에서는 instaBot.js를 통해서만 사용한다.
 * =============================================================================
 */

const { sleep, assertReadableFile } = require("../../core/helpers");
const { safeEvaluate } = require("../../core/navigation");


const INSTAGRAM_TEXT = {
  create: [
    "새로운 게시물",
    "새 게시물",
    "만들기",
    "create",
    "new post",
    "创建",
    "新帖子",
    "建立",
    "新增貼文",
    "作成",
    "新規投稿",
  ],

  next: [
    "다음",
    "next",
    "下一步",
    "下一个",
    "下一步",
    "下一個",
    "次へ",
  ],

  share: [
    "공유하기",
    "공유",
    "share",
    "分享",
    "シェア",
    "共有",
  ],

  captionPlaceholder: [
    "문구를 입력하세요...",
    "write a caption...",
    "write a caption…",
    "添加说明文字...",
    "撰寫說明文字...",
    "キャプションを入力...",
  ],
};

// function normalizeText(value) {
//   return String(value || "")
//     .replace(/\s+/g, " ")
//     .trim()
//     .toLowerCase();
// }

// function includesAnyText(value, candidates) {
//   const text = normalizeText(value);
//   return candidates.some((candidate) => {
//     const needle = normalizeText(candidate);
//     return text === needle || text.includes(needle);
//   });
// }

/** ****************************************************************************
 * selector 대기
 ******************************************************************************/
async function waitForSelectorOrThrow(page, selector, timeout = 20000) {
  await page.waitForSelector(selector, { timeout });
  return selector;
}

/** ****************************************************************************
 * 현재 열린 Instagram dialog/modal 안에서만 role=button 텍스트 클릭
 *
 * 해결하는 문제:
 *  - 오버레이 밑 피드 게시글의 "공유하기" 버튼을 잘못 클릭하는 문제 방지
 *  - div[role="button"][tabindex="0"] 우선 매칭
 *  - 텍스트는 포함이 아니라 완전 일치만 허용
 ******************************************************************************/
async function clickRoleButtonDivByText(page, texts, timeout = 20000) {
  const targets = (Array.isArray(texts) ? texts : [texts])
    .map((text) => String(text || "").trim())
    .filter(Boolean);

  if (targets.length === 0) {
    throw new Error("clickRoleButtonDivByText: text is required");
  }

  const start = Date.now();

  while (Date.now() - start < timeout) {
    const targetHandle = await page.evaluateHandle((wantedTexts) => {
      const normalize = (value) =>
        String(value || "")
          .replace(/[\u200B-\u200D\uFEFF]/g, "")
          .replace(/\u00A0/g, " ")
          .replace(/\s+/g, " ")
          .trim();

      const isVisible = (el) => {
        if (!el) return false;

        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);

        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity || "1") > 0
        );
      };

      const isDisabled = (el) => {
        return (
          el.disabled === true ||
          String(el.getAttribute?.("aria-disabled") || "").toLowerCase() === "true"
        );
      };

      /**
       * 1) 현재 열린 오버레이/dialog를 우선 scope로 사용
       * - Instagram 게시물 작성 창은 보통 role="dialog" 안에 있음
       * - 여러 dialog가 있으면 마지막 visible dialog가 가장 최근 오버레이일 가능성이 높음
       */
      const dialogs = Array.from(document.querySelectorAll('div[role="dialog"], [role="dialog"]'))
        .filter(isVisible);

      const scope = dialogs.length > 0
        ? dialogs[dialogs.length - 1]
        : document;

      /**
       * 2) tabindex="0" 버튼을 먼저 보고, 없으면 role=button 전체 fallback
       */
      const primaryNodes = Array.from(
        scope.querySelectorAll('div[role="button"][tabindex="0"]')
      );

      const fallbackNodes = Array.from(
        scope.querySelectorAll('div[role="button"]')
      );

      const nodes = [...primaryNodes, ...fallbackNodes]
        .filter((el, index, arr) => arr.indexOf(el) === index)
        .filter((el) => isVisible(el) && !isDisabled(el));

      const hit = nodes.find((el) => {
        const label = normalize(el.textContent || el.innerText || "");

        /**
         * 중요:
         * - "공유하기"가 "첫 사진 공유하기"에 포함되어도 클릭하지 않음
         * - 완전 일치만 허용
         */
        return wantedTexts.some((target) => label === normalize(target));
      });

      if (!hit) return null;

      hit.scrollIntoView({ block: "center", inline: "center" });
      return hit;
    }, targets);

    const element = targetHandle.asElement();

    if (element) {
      const debug = await page.evaluate((el) => ({
        text: String(el.textContent || el.innerText || "").trim(),
        role: el.getAttribute("role") || "",
        tabindex: el.getAttribute("tabindex") || "",
        className: String(el.className || ""),
      }), element);

      console.log("[insta][clickRoleButtonDivByText] clicked:", {
        target: targets,
        ...debug,
      });

      await element.click();

      if (typeof targetHandle.dispose === "function") {
        await targetHandle.dispose();
      }

      return true;
    }

    if (typeof targetHandle.dispose === "function") {
      await targetHandle.dispose();
    }

    await sleep(250);
  }

  throw new Error(`clickRoleButtonDivByText timeout: "${targets.join(" | ")}"`);
}

/** ****************************************************************************
 * Create 아이콘 클릭
 *
 * 우선순위:
 *  1) svg[aria-label="Create"]
 *  2) svg[aria-label="New post"]
 *  3) 텍스트 create / new post / 만들기 / 새 게시물
 ******************************************************************************/
async function clickCreateByIcon(page, timeout = 30000) {
  const start = Date.now();
  const texts = ["create", "new post", "만들기", "새로운 게시물", "새 게시물"];

  while (Date.now() - start < timeout) {
    const svgHandle = await page.$(
      INSTAGRAM_TEXT.create
        .map((text) => `svg[aria-label="${text}"]`)
        .join(", ")
    );
    
    if (svgHandle) {
      console.log("[clickCreateByIcon] found svg icon for Create:");
      const clickableHandle = await page.evaluateHandle(
        (el) => el.closest('a[role="link"], button, div[role="button"]') || el,
        svgHandle
      );
      const clickableEl = clickableHandle.asElement();
      if (clickableEl) {
        await clickableEl.click();
        if (typeof clickableEl.dispose === "function") await clickableEl.dispose();
        if (typeof svgHandle.dispose === "function") await svgHandle.dispose();
        return true;
      }
      if (typeof clickableHandle.dispose === "function") await clickableHandle.dispose();
      if (typeof svgHandle.dispose === "function") await svgHandle.dispose();
    }

    const handles = await page.$$('a[role="link"], div[role="button"], button');
    for (const handle of handles) {
      const text = String(
        await page.evaluate((el) => (el.textContent || "").trim().toLowerCase(), handle)
      ).trim();
      if (texts.some((key) => text === key || text.includes(key))) {
        await handle.click();
        if (typeof handle.dispose === "function") await handle.dispose();
        return true;
      }
      if (typeof handle.dispose === "function") await handle.dispose();
    }

    await sleep(250);
  }

  throw new Error("clickCreateByIcon timeout: Create icon not found");
}

/** ****************************************************************************
 * file input 업로드
 ******************************************************************************/
async function uploadImageFile(page, imagePath, timeout = 30000) {
  const absPath = await assertReadableFile(imagePath);

  await waitForSelectorOrThrow(page, 'input[type="file"]', timeout);
  const input = await page.waitForSelector('input[type="file"]', { timeout });
  if (!input) throw new Error("uploadImageFile: file input handle not found");

  await input.uploadFile(absPath);
  if (typeof input.dispose === "function") {
    await input.dispose();
  }

  await sleep(900);

  return absPath;
}

async function findCaptionEditorHandle(page, timeout = 30000) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const handle = await page.evaluateHandle((placeholders) => {
      const editors = Array.from(
        document.querySelectorAll('div[role="textbox"][data-lexical-editor="true"]')
      );

      return editors.find((el) => {
        const ariaPlaceholder = el.getAttribute("aria-placeholder") || "";
        const ariaLabel = el.getAttribute("aria-label") || "";
        const text = `${ariaPlaceholder} ${ariaLabel}`.toLowerCase();

        return placeholders.some((candidate) =>
          text.includes(String(candidate).toLowerCase())
        );
      }) || null;
    }, INSTAGRAM_TEXT.captionPlaceholder);

    const el = handle.asElement();
    if (el) return el;

    if (typeof handle.dispose === "function") await handle.dispose();
    await sleep(250);
  }

  throw new Error("findCaptionEditorHandle timeout");
}

/** ****************************************************************************
 * Lexical caption 입력
 *
 * 변경점:
 *  - 고정 selector 제거
 *  - findCaptionEditorHandle()로 다국어 caption editor 탐색
 *  - 호출부는 그대로 typeCaptionLexical(page, caption)
 ******************************************************************************/
async function typeCaptionLexical(page, caption) {
  if (!page) throw new Error("typeCaptionLexical: page is required");

  const text = String(caption || "");

  /** 1) 다국어 caption editor 탐색 */
  const editorHandle = await findCaptionEditorHandle(page, 30000);

  try {
    /** **************************************************************
     * 2) editor 클릭/포커스
     * - page.focus(selector)는 제거
     * - findCaptionEditorHandle()로 잡은 정확한 handle만 사용
     *************************************************************** */
    await editorHandle.evaluate((el) => {
      el.scrollIntoView({ block: "center", inline: "center" });
    });

    await editorHandle.click();

    await editorHandle.evaluate((el) => {
      el.focus?.();
    });

    /** **************************************************************
     * 3) 기존 내용 제거
     *************************************************************** */
    await page.keyboard.down("Control");
    await page.keyboard.press("KeyA");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");

    /** **************************************************************
     * 4) 키보드 입력
     *************************************************************** */
    await page.keyboard.type(text, { delay: 15 });

    /** **************************************************************
     * 5) 입력 검증
     *************************************************************** */
    const ok = await page
      .waitForFunction(
        (expected) => {
          const editors = Array.from(
            document.querySelectorAll(
              'div[role="textbox"][data-lexical-editor="true"]'
            )
          );

          return editors.some((root) => {
            const span = root.querySelector('span[data-lexical-text="true"]');
            const got = (span?.textContent || root.textContent || "").trim();

            return got.includes(String(expected || "").trim());
          });
        },
        { timeout: 6000 },
        text
      )
      .then(() => true)
      .catch(() => false);

    if (ok) return true;

    /** **************************************************************
     * 6) fallback 전 다시 전체 삭제
     * - keyboard.type 일부만 들어간 상태에서 paste되면 중복될 수 있음
     *************************************************************** */
    await editorHandle.click();

    await page.keyboard.down("Control");
    await page.keyboard.press("KeyA");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");

    /** **************************************************************
     * 7) fallback: paste 이벤트로 Lexical에 입력
     *************************************************************** */
    await editorHandle.evaluate((el, value) => {
      el.scrollIntoView({ block: "center", inline: "center" });
      el.click();
      el.focus?.();

      const dt = new DataTransfer();
      dt.setData("text/plain", String(value || ""));

      const evt = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: dt,
      });

      el.dispatchEvent(evt);
    }, text);

    /** **************************************************************
     * 8) 최종 검증
     *************************************************************** */
    await page.waitForFunction(
      (expected) => {
        const editors = Array.from(
          document.querySelectorAll(
            'div[role="textbox"][data-lexical-editor="true"]'
          )
        );

        return editors.some((root) => {
          const span = root.querySelector('span[data-lexical-text="true"]');
          const got = (span?.textContent || root.textContent || "").trim();

          return got.includes(String(expected || "").trim());
        });
      },
      { timeout: 8000 },
      text
    );

    return true;
  } finally {
    /** **************************************************************
     * 9) handle 정리
     *************************************************************** */
    if (typeof editorHandle.dispose === "function") {
      await editorHandle.dispose();
    }
  }
}

module.exports = {
  waitForSelectorOrThrow,
  clickRoleButtonDivByText,
  clickCreateByIcon,
  uploadImageFile,
  typeCaptionLexical,
};