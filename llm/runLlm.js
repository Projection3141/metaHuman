// llm/runLlm.js

require("dotenv").config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

const { createLLM } = require("./llm");

const llm = OPENAI_API_KEY
  ? createLLM({ apiKey: OPENAI_API_KEY })
  : null;

const MODEL = "gpt-5.5";

const DEFAULT_RECOMMEND_LINK = "http://monio.co.kr/";

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["comment"],
  properties: {
    comment: {
      type: "string",
    },
  },
};

/**
 * 언어 코드를 LLM 지시문용 언어명으로 변환한다.
 */
function getLanguagePromptName(language) {
  if (language === "ko") return "Korean";
  if (language === "zh") return "Chinese";
  if (language === "ja") return "Japanese";
  return "English";
}

/**
 * LLM 사용 가능 상태를 검증한다.
 */
function assertLlmReady() {
  if (!llm) {
    throw new Error("runLlm: OPENAI_API_KEY is required");
  }
}

/**
 * 공통 링크 추천 댓글 생성 함수
 *
 * 주의:
 *  - 이 함수는 export하지 않는다.
 *  - Reddit / Thread / Instagram 등 플랫폼별 함수가 이 함수를 감싸서 사용한다.
 */
async function createPlatformCommentRecommendingLink({
  platformName,
  communityLabel,
  communityValue,
  title,
  link = DEFAULT_RECOMMEND_LINK,
  language = "en",
} = {}) {
  assertLlmReady();

  if (!platformName) {
    throw new Error("createPlatformCommentRecommendingLink: platformName is required");
  }

  if (!title) {
    throw new Error("createPlatformCommentRecommendingLink: title is required");
  }

  if (!link) {
    throw new Error("createPlatformCommentRecommendingLink: link is required");
  }

  const languageName = getLanguagePromptName(language);

  const userLines = [
    `Platform: ${platformName}`,
    communityLabel && communityValue ? `${communityLabel}: ${communityValue}` : "",
    `Post title: ${title}`,
    `Recommended link: ${link}`,
    `Comment language: ${languageName}`,
  ].filter(Boolean);

  const result = await llm.askJSON({
    model: MODEL,
    developer: [
      `너는 ${platformName}의 일반 유저이다.`,
      "반드시 JSON 스키마만 지킨다.",
      `comment 값은 반드시 ${languageName}로 작성한다.`,
      `comment는 자연스러운 ${platformName} 댓글처럼 작성한다.`,
      "comment에는 반드시 제공된 링크를 1회 포함한다.",
      "게시글 제목과 링크 추천 내용을 자연스럽게 연결한다.",
      "광고처럼 과하게 쓰지 말고, 짧고 캐주얼하게 작성한다.",
      "허위 주장, 과장 표현, 스팸성 문구를 쓰지 않는다.",
      "comment는 50 words 이하로 작성한다.",
    ].join("\n"),
    user: userLines.join("\n"),
    schema,
  });

  const comment = String(result?.comment || "").trim();

  if (!comment) {
    throw new Error("createPlatformCommentRecommendingLink: empty comment generated");
  }

  /**
   * LLM이 링크를 누락했을 때 안전 보정한다.
   */
  if (!comment.includes(link)) {
    return `${comment}\n\n${link}`;
  }

  return comment;
}

/**
 * Reddit 게시글 title 기반 링크 추천 댓글 생성
 *
 * export 대상:
 *  - 외부에서는 플랫폼별 함수만 사용한다.
 */
async function createRedditCommentRecommendingLink({
  subreddit = "",
  title,
  link = DEFAULT_RECOMMEND_LINK,
  language = "en",
} = {}) {
  return createPlatformCommentRecommendingLink({
    platformName: "Reddit",
    communityLabel: "Subreddit",
    communityValue: subreddit,
    title,
    link,
    language,
  });
}

async function createThreadCommentRecommendingLink({
  postText,
  link = DEFAULT_RECOMMEND_LINK,
  language = "en",
} = {}) {
  return createPlatformCommentRecommendingLink({
    platformName: "Threads",
    communityLabel: "",
    communityValue: "",
    title: postText,
    link,
    language,
  });
}

module.exports = {
  createRedditCommentRecommendingLink,
  createThreadCommentRecommendingLink,
};