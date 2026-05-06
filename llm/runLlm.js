// llm/runLlm.js

require("dotenv").config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

const { createLLM } = require("./llm");

const llm = OPENAI_API_KEY
    ? createLLM({ apiKey: OPENAI_API_KEY, })
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
 * 검색된 Reddit 게시글 title을 기반으로 링크 추천 댓글 생성
 *
 * 입력:
 *  - subreddit: 검색된 서브레딧
 *  - title: 검색된 게시글 title
 *  - link: 댓글에 포함할 추천 링크
 *
 * 출력:
 *  - comment string
 */
async function createCommentRecommendingLink({
  subreddit = "Trickcal",
  title,
  link = DEFAULT_RECOMMEND_LINK,
} = {}) {
  if (!llm) {
    throw new Error("createCommentRecommendingLink: OPENAI_API_KEY is required");
  }

  if (!title) {
    throw new Error("createCommentRecommendingLink: title is required");
  }

  const result = await llm.askJSON({
    model: MODEL,
    developer: [
      "너는 레딧의 일반 유저이다.",
      "반드시 JSON 스키마만 지킨다.",
      "comment 값은 영어로 작성한다.",
      "comment는 자연스러운 Reddit 댓글처럼 작성한다.",
      "comment에는 반드시 제공된 링크를 1회 포함한다.",
      "게시글 제목과 링크 추천 내용을 자연스럽게 연결한다.",
      "광고처럼 과하게 쓰지 말고, 짧고 캐주얼하게 작성한다.",
      "허위 주장, 과장 표현, 스팸성 문구를 쓰지 않는다.",
      "comment는 50 words 이하로 작성한다.",
    ].join("\n"),
    user: [
      `Subreddit: ${subreddit}`,
      `Post title: ${title}`,
      `Recommended link: ${link}`,
    ].join("\n"),
    schema,
  });

  const comment = String(result?.comment || "").trim();

  if (!comment) {
    throw new Error("createCommentRecommendingLink: empty comment generated");
  }

  /**
   * LLM이 링크를 누락했을 때 안전 보정
   */
  if (!comment.includes(link)) {
    return `${comment}\n\n${link}`;
  }

  return comment;
}

module.exports = {
  createCommentRecommendingLink,
};