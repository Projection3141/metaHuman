/**
 * platforms/reddit/redditInternals.js
 *
 * =============================================================================
 * Reddit 내부 함수
 * =============================================================================
 *
 * 역할:
 *  - Shadow DOM 접근
 *  - 로그인 폼 입력
 *  - 제목 / 본문 입력
 *  - 글 발행 버튼 클릭
 *  - 댓글 영역 포커스 / 입력 / 발행
 *  - 검색 URL 생성
 *
 * 주의:
 *  - 외부에서 직접 호출하지 말고 redditBot.js를 통해 사용한다.
 * =============================================================================
 */

const { sleep } = require("../../core/helpers");
const {
  safeWaitNetworkIdle,
  safeEvaluate,
  waitForSelectorSafe,
} = require("../../core/navigation");

/** ****************************************************************************
 * 검색 URL 생성
 ******************************************************************************/
function buildSearchUrl(keyword) {
  const q = String(keyword || "")
    .trim()
    .split(/\s+/g)
    .filter(Boolean)
    .join("+");

  return `https://www.reddit.com/search/?q=${q}`;
}

/** ****************************************************************************
 * pickValue → submit URL 변환
 *
 * 예:
 *  - u/Projection3141 -> https://www.reddit.com/user/Projection3141/submit/?type=TEXT
 *  - r/javascript      -> https://www.reddit.com/r/javascript/submit/?type=TEXT
 ******************************************************************************/
function buildTextSubmitUrlFromPickValue(pickValue) {
  const raw = String(pickValue || "").trim();

  if (!raw) throw new Error("buildTextSubmitUrlFromPickValue: pickValue is required");

  if (raw.startsWith("u/")) {
    const username = raw.replace(/^u\//, "");
    return `https://www.reddit.com/user/${encodeURIComponent(username)}/submit/?type=TEXT`;
  }

  if (raw.startsWith("r/")) {
    const subreddit = raw.replace(/^r\//, "");
    return `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/submit/?type=TEXT`;
  }

  throw new Error('pickValue must start with "u/" or "r/"');
}

/** ****************************************************************************
 * 포커스된 편집기에 텍스트 입력
 ******************************************************************************/
async function replaceFocusedTextByKeyboard(page, text, { delay = 8 } = {}) {
  const value = String(text ?? "");
  const lines = value.split("\n");

  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await sleep(80);

  for (let i = 0; i < lines.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await page.keyboard.type(lines[i], { delay });
    if (i < lines.length - 1) {
      // eslint-disable-next-line no-await-in-loop
      await page.keyboard.press("Enter");
    }
  }

  return true;
}

/** ****************************************************************************
 * 제목 입력
 ******************************************************************************/
async function setTitleFaceplateTextarea(page, title, timeout = 30000) {
  const hostSel = 'faceplate-textarea-input[name="title"]';
  await waitForSelectorSafe(page, hostSel, timeout);

  const res = await safeEvaluate(
    page,
    (sel, val) => {
      const host = document.querySelector(sel);
      if (!host) return { ok: false, reason: "NO_HOST" };

      const root = host.shadowRoot;
      if (!root) return { ok: false, reason: "NO_SHADOW" };

      const el =
        root.querySelector("textarea") ||
        root.querySelector("input") ||
        root.querySelector('[contenteditable="true"]');

      if (!el) return { ok: false, reason: "NO_INNER" };

      if (el.getAttribute?.("contenteditable") === "true") {
        el.focus();
        el.textContent = String(val ?? "");
        el.dispatchEvent(new InputEvent("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true };
      }

      if ("value" in el) {
        el.focus();
        el.value = String(val ?? "");
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true };
      }

      return { ok: false, reason: "UNKNOWN" };
    },
    hostSel,
    String(title ?? ""),
  );

  if (res?.ok) return true;

  await page.click(hostSel);
  await sleep(150);
  await replaceFocusedTextByKeyboard(page, title, { delay: 8 });
  return true;
}

/** ****************************************************************************
 * 본문(Lexical RTE) 입력
 ******************************************************************************/
async function setBodyLexicalRTE(page, body, timeout = 30000) {
  const editorSel =
    'div[slot="rte"][contenteditable="true"][data-lexical-editor="true"][name="body"]';

  await waitForSelectorSafe(page, editorSel, timeout);

  await page.click(editorSel);
  await sleep(150);

  await replaceFocusedTextByKeyboard(page, body, { delay: 6 });
  return true;
}

/** ****************************************************************************
 * 게시 버튼 클릭
 ******************************************************************************/
async function clickSubmitPostButton(page, timeout = 30000) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    // eslint-disable-next-line no-await-in-loop
    const res = await safeEvaluate(page, () => {
      const host = document.querySelector("r-post-form-submit-button#submit-post-button");
      const root = host?.shadowRoot;

      let btn = root?.querySelector("button#inner-post-submit-button");
      if (!btn) btn = document.querySelector("button#inner-post-submit-button");

      if (!btn) return { ok: false, reason: "NOT_FOUND" };

      const ariaDisabled = (btn.getAttribute("aria-disabled") || "").toLowerCase() === "true";
      const disabled = !!btn.disabled;

      if (disabled || ariaDisabled) return { ok: false, reason: "DISABLED" };

      btn.scrollIntoView({ block: "center", inline: "center" });
      btn.click();

      return { ok: true, reason: "CLICKED" };
    },
      { tag: "reddit.clickSubmitPostButton" });

    if (res?.ok) {
      console.log("[reddit][post] submit clicked");
      return true;
    }

    // eslint-disable-next-line no-await-in-loop
    await sleep(250);
  }

  throw new Error("clickSubmitPostButton timeout: submit button not found/clickable");
}

/** ****************************************************************************
 * 댓글 버튼 클릭
 ******************************************************************************/
async function clickCommentsActionButton(page, timeout = 15000) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    console.log("[reddit][comment] trying to click comments button...");

    // eslint-disable-next-line no-await-in-loop
    const res = await safeEvaluate(page, () => {
      const roots = [document];
      const seen = new Set();

      const findButton = () => {
        for (let i = 0; i < roots.length; i += 1) {
          const root = roots[i];
          if (!root || seen.has(root)) continue;
          seen.add(root);

          const btn =
            root.querySelector?.('button[data-post-click-location="comments-button"]') ||
            root.querySelector?.('button[name="comments-action-button"]');

          if (btn) return { btn, root };

          const all = root.querySelectorAll ? root.querySelectorAll("*") : [];
          for (const el of all) {
            if (el && el.shadowRoot) roots.push(el.shadowRoot);
          }
        }
        return { btn: null, root: null };
      };

      const { btn } = findButton();

      if (!btn) {
        return {
          ok: false,
          reason: "NOT_FOUND",
          url: location.href,
          title: document.title,
        };
      }

      const ariaDisabled = (btn.getAttribute("aria-disabled") || "").toLowerCase() === "true";
      const disabled = !!btn.disabled;

      btn.scrollIntoView({ block: "center", inline: "center" });

      if (disabled || ariaDisabled) {
        return {
          ok: false,
          reason: "DISABLED",
          url: location.href,
          title: document.title,
          text: (btn.textContent || "").trim(),
        };
      }

      btn.click();

      return {
        ok: true,
        reason: "CLICKED",
        url: location.href,
        title: document.title,
        text: (btn.textContent || "").trim(),
      };
    },
      { tag: "reddit.clickCommentsActionButton" });

    console.log("[reddit][comment] clickCommentsActionButton result:", res);

    if (res?.ok) return true;

    // eslint-disable-next-line no-await-in-loop
    await sleep(350);
  }

  throw new Error("clickCommentsActionButton timeout");
}

/** ****************************************************************************
 * 댓글 영역 근처로 스크롤
 ******************************************************************************/
async function scrollToCommentsArea(page, { rounds = 8, step = 900 } = {}) {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const moved = await safeEvaluate(page, () => {
      const candidates = [
        "#comment-tree",
        "#comments",
        "[data-testid='comment-tree']",
        "shreddit-comment-tree",
        "[aria-label*='댓글']",
        "[id*='comment']",
      ];

      for (const sel of candidates) {
        const el = document.querySelector(sel);
        if (el) {
          el.scrollIntoView({ block: "start", inline: "nearest" });
          return true;
        }
      }

      return false;
    },
      { tag: "reddit.scrollToCommentsArea.find" });

    // eslint-disable-next-line no-await-in-loop
    await sleep(350);

    if (moved) {
      // eslint-disable-next-line no-await-in-loop
      await safeWaitNetworkIdle(page, 8000);
      // eslint-disable-next-line no-await-in-loop
      await sleep(450);
      return true;
    }

    // eslint-disable-next-line no-await-in-loop
    await safeEvaluate(page, (dy) => window.scrollBy(0, dy), step,
      { tag: "reddit.scrollToCommentsArea.scroll" }
    );

    // eslint-disable-next-line no-await-in-loop
    await sleep(350);
  }

  return false;
}

/** ****************************************************************************
 * 댓글 editor 엄격 탐색
 ******************************************************************************/
async function focusCommentEditorDeepStrict(page, { timeout = 25000 } = {}) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    // eslint-disable-next-line no-await-in-loop
    const res = await safeEvaluate(page, () => {
      const roots = [document];
      const seen = new Set();

      const pushShadowRoots = (root) => {
        if (!root?.querySelectorAll) return;
        const all = root.querySelectorAll("*");
        for (const el of all) {
          if (el && el.shadowRoot) roots.push(el.shadowRoot);
        }
      };

      const matchEditor = (el) => {
        if (!el) return false;

        const role = (el.getAttribute?.("role") || "").toLowerCase();
        const ce = el.getAttribute?.("contenteditable");
        if (role !== "textbox") return false;
        if (ce !== "" && ce !== "true") return false;

        const ariaPh = (el.getAttribute?.("aria-placeholder") || "").trim();
        const ariaLabel = (el.getAttribute?.("aria-label") || "").trim();

        const editorTextCandidates = [
          /** Korean */
          "대화에 참여",
          "댓글 추가",
          "댓글 작성",
          "콘텐츠 작성",
          "댓글",
          "입력",

          /** English */
          "join the conversation",
          "add a comment",
          "write a comment",
          "create content",
          "comment",
          "content",
          "input",

          /** Chinese Simplified / Traditional */
          "加入对话",
          "加入對話",
          "添加评论",
          "新增留言",
          "发表评论",
          "發表評論",
          "评论",
          "評論",
          "留言",
          "输入",
          "輸入",

          /** Japanese */
          "会話に参加",
          "コメントを追加",
          "コメントする",
          "コンテンツを作成",
          "コメント",
          "入力",
        ];

        /**
         * 영어는 대소문자 영향을 받기 때문에 lower 비교한다.
         * 한/중/일은 lowerCase 영향이 거의 없어서 그대로 동작한다.
         */
        const haystacks = [
          ariaPh,
          ariaLabel,
        ].map((value) => String(value || "").toLowerCase());

        return editorTextCandidates.some((candidate) => {
          const needle = String(candidate || "").toLowerCase();

          return haystacks.some((haystack) => haystack.includes(needle));
        });
      };

      const hostCandidates = Array.from(
        document.querySelectorAll(
          "shreddit-simple-composer, shreddit-comment-composer, shreddit-composer",
        ),
      );

      for (const host of hostCandidates) {
        const root = host.shadowRoot;
        if (!root) continue;

        const editor =
          root.querySelector('div[role="textbox"][contenteditable="true"]') ||
          root.querySelector('div[role="textbox"][contenteditable]');

        if (matchEditor(editor)) {
          try {
            editor.scrollIntoView({ block: "center", inline: "center" });
          } catch {
            /** ignore */
          }
          try {
            editor.focus();
          } catch {
            /** ignore */
          }
          try {
            editor.click();
          } catch {
            /** ignore */
          }
          return {
            ok: true,
            via: "HOST_SHADOW",
            ariaPlaceholder: editor.getAttribute("aria-placeholder") || "",
            ariaLabel: editor.getAttribute("aria-label") || "",
          };
        }
      }

      for (let i = 0; i < roots.length; i += 1) {
        const root = roots[i];
        if (!root || seen.has(root)) continue;
        seen.add(root);

        const editors = root.querySelectorAll
          ? root.querySelectorAll(
            'div[role="textbox"][contenteditable], div[role="textbox"][contenteditable="true"]',
          )
          : [];

        for (const ed of editors) {
          if (!matchEditor(ed)) continue;

          try {
            ed.scrollIntoView({ block: "center", inline: "center" });
          } catch {
            /** ignore */
          }
          try {
            ed.focus();
          } catch {
            /** ignore */
          }
          try {
            ed.click();
          } catch {
            /** ignore */
          }

          return {
            ok: true,
            via: "DEEP_BFS",
            ariaPlaceholder: ed.getAttribute("aria-placeholder") || "",
            ariaLabel: ed.getAttribute("aria-label") || "",
          };
        }

        pushShadowRoots(root);
      }

      return { ok: false, reason: "NO_EDITOR", url: location.href, title: document.title };
    },
      { tag: "reddit.focusCommentEditorDeepStrict" });

    if (res?.ok) {
      console.log("[reddit][comment] editor focused:", res);
      return true;
    }

    // eslint-disable-next-line no-await-in-loop
    await safeEvaluate(page, () => window.scrollBy(0, 700));
    // eslint-disable-next-line no-await-in-loop
    await sleep(350);
  }

  throw new Error("focusCommentEditorDeepStrict timeout: comment editor not found");
}

/** ****************************************************************************
 * 댓글 텍스트 입력
 ******************************************************************************/
async function setCommentTextByKeyboard(page, text) {
  return replaceFocusedTextByKeyboard(page, text, { delay: 8 });
}

/** ****************************************************************************
 * 댓글 등록 버튼 클릭
 ******************************************************************************/
async function clickCommentSubmitButtonDeep(page, timeout = 20000) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    // eslint-disable-next-line no-await-in-loop
    const res = await safeEvaluate(page, () => {
      const roots = [document];
      const seen = new Set();

      const pushShadowRoots = (root) => {
        if (!root?.querySelectorAll) return;

        const all = root.querySelectorAll("*");

        for (const el of all) {
          if (el && el.shadowRoot) {
            roots.push(el.shadowRoot);
          }
        }
      };

      const isClickable = (btn) => {
        const ariaDisabled =
          (btn.getAttribute?.("aria-disabled") || "").toLowerCase() === "true";

        const disabled = !!btn.disabled;

        return !(disabled || ariaDisabled);
      };

      /**
       * Reddit 댓글 등록 버튼 언어 후보.
       *
       * ko:
       *  - 댓글
       *  - 댓글 달기
       *  - 게시
       *
       * en:
       *  - comment
       *  - post
       *  - reply
       *
       * zh:
       *  - 评论
       *  - 評論
       *  - 发表评论
       *  - 發表評論
       *  - 回复
       *  - 回覆
       *
       * ja:
       *  - コメント
       *  - 返信
       *  - 投稿
       */
      const submitTextCandidates = [
        /** Korean */
        "댓글",
        "댓글 달기",
        "게시",

        /** English */
        "comment",
        "post",
        "reply",

        /** Chinese Simplified / Traditional */
        "评论",
        "評論",
        "发表评论",
        "發表評論",
        "回复",
        "回覆",

        /** Japanese */
        "コメント",
        "返信",
        "投稿",
      ];

      const matchesSubmitText = (value) => {
        const text = String(value || "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();

        return submitTextCandidates.some((candidate) =>
          text.includes(String(candidate).toLowerCase())
        );
      };

      for (let i = 0; i < roots.length; i += 1) {
        const root = roots[i];

        if (!root || seen.has(root)) continue;
        seen.add(root);

        const btns = root.querySelectorAll
          ? Array.from(root.querySelectorAll("button"))
          : [];

        const hit = btns.find((btn) => {
          const text = String(btn.textContent || "").trim();
          const ariaLabel = String(btn.getAttribute?.("aria-label") || "").trim();

          return (
            matchesSubmitText(text) ||
            matchesSubmitText(ariaLabel)
          );
        });

        if (hit && isClickable(hit)) {
          try {
            hit.scrollIntoView({
              block: "center",
              inline: "center",
            });
          } catch {
            /** ignore */
          }

          hit.click();

          return {
            ok: true,
            via: "DEEP_BFS",
            text: String(hit.textContent || "").trim(),
            ariaLabel: String(hit.getAttribute?.("aria-label") || "").trim(),
          };
        }

        pushShadowRoots(root);
      }

      return {
        ok: false,
        reason: "NO_SUBMIT",
      };
    },
      { tag: "reddit.clickCommentSubmitButtonDeep" });

    if (res?.ok) {
      console.log("[reddit][comment] submit clicked:", res);
      return true;
    }

    // eslint-disable-next-line no-await-in-loop
    await sleep(250);
  }

  throw new Error(
    "clickCommentSubmitButtonDeep timeout: submit button not found/clickable"
  );
}

module.exports = {
  buildSearchUrl,
  buildTextSubmitUrlFromPickValue,

  setTitleFaceplateTextarea,
  setBodyLexicalRTE,
  clickSubmitPostButton,

  clickCommentsActionButton,
  scrollToCommentsArea,
  focusCommentEditorDeepStrict,
  setCommentTextByKeyboard,
  clickCommentSubmitButtonDeep,
};