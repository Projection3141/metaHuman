// llm/llm.js

/**
 * llm.js v3.3.0
 *
 * -----------------------------------------------------------------------------
 * 역할
 * -----------------------------------------------------------------------------
 *  - OpenAI JSON 전용 모듈
 *  - 입력은 단순하게 받고, 출력은 반드시 JSON 객체만 반환하도록 강제한다.
 *  - 모델명은 app.js 또는 호출하는 상위 모듈에서 넘긴다.
 *  - JSON Schema strict 모드에서 자주 누락되는 required/additionalProperties 를 자동 보정한다.
 *  - Chat Completions API 와 Responses API 를 모두 지원한다.
 *  - 파일, 이미지, 웹검색 기반 JSON 응답을 위한 편의 메서드를 제공한다.
 *
 * -----------------------------------------------------------------------------
 * 설치 및 준비
 * -----------------------------------------------------------------------------
 * 1) openai 패키지 설치
 *
 *    npm install openai
 *
 * 2) 환경변수 설정
 *
 *    OPENAI_API_KEY=sk-...
 *
 * 3) 웹검색 도구 타입을 직접 지정하고 싶을 경우 선택적으로 설정
 *
 *    OPENAI_WEB_SEARCH_TOOL=web_search_preview
 *
 * -----------------------------------------------------------------------------
 * 기본 사용 예시: JSON Schema 기반 일반 질문
 * -----------------------------------------------------------------------------
 *
 * const { createLLM } = require("./llm");
 *
 * const llm = createLLM({
 *   apiKey: process.env.OPENAI_API_KEY,
 *   timeout: 120000,
 * });
 *
 * const schema = {
 *   type: "object",
 *   properties: {
 *     title: {
 *       type: "string",
 *     },
 *     summary: {
 *       type: "string",
 *     },
 *     tags: {
 *       type: "array",
 *       items: {
 *         type: "string",
 *       },
 *     },
 *   },
 * };
 *
 * const result = await llm.askJSON({
 *   model: "gpt-4.1-mini",
 *   user: "Node.js에서 비동기 처리를 설명해줘.",
 *   schema,
 * });
 *
 * console.log(result);
 *
 * // 예상 결과 형태
 * // {
 * //   title: "Node.js 비동기 처리",
 * //   summary: "...",
 * //   tags: ["Node.js", "async", "event loop"]
 * // }
 *
 * -----------------------------------------------------------------------------
 * 웹검색 기반 사용 예시: 최신 정보가 필요한 JSON 응답
 * -----------------------------------------------------------------------------
 *
 * const result = await llm.researchJSON({
 *   model: "gpt-4.1",
 *   user: "현재 OpenAI Responses API의 주요 기능을 요약해줘.",
 *   schema: {
 *     type: "object",
 *     properties: {
 *       summary: {
 *         type: "string",
 *       },
 *       keyFeatures: {
 *         type: "array",
 *         items: {
 *           type: "string",
 *         },
 *       },
 *       caveats: {
 *         type: "array",
 *         items: {
 *           type: "string",
 *         },
 *       },
 *     },
 *   },
 * });
 *
 * console.log(result);
 *
 * -----------------------------------------------------------------------------
 * 이미지/파일 분석 사용 예시
 * -----------------------------------------------------------------------------
 *
 * const result = await llm.analyzeMediaJSON({
 *   model: "gpt-4.1",
 *   user: "첨부한 이미지를 분석해서 주요 내용을 JSON으로 정리해줘.",
 *   mediaItems: [
 *     {
 *       path: "./sample.png",
 *       mime: "image/png",
 *       detail: "high",
 *     },
 *   ],
 *   schema: {
 *     type: "object",
 *     properties: {
 *       description: {
 *         type: "string",
 *       },
 *       objects: {
 *         type: "array",
 *         items: {
 *           type: "string",
 *         },
 *       },
 *       riskLevel: {
 *         type: "string",
 *         enum: ["low", "medium", "high"],
 *       },
 *     },
 *   },
 * });
 *
 * console.log(result);
 *
 * -----------------------------------------------------------------------------
 * 설계 원칙
 * -----------------------------------------------------------------------------
 *  - 이 모듈의 공개 메서드는 가능한 한 JSON 객체만 반환한다.
 *  - 모델 응답에 설명문, 마크다운, 코드블록이 섞이는 상황을 최대한 방지한다.
 *  - 그래도 응답이 코드블록으로 감싸져 오는 예외 상황에 대비해 parseJSONContent 에서
 *    최소한의 정리 후 JSON.parse 를 수행한다.
 *  - strict JSON Schema 를 쓰기 쉽게 하기 위해 required 와 additionalProperties 를 자동 보정한다.
 *  - 네트워크 오류, 일시적 서버 오류, 타임아웃은 requestWithRetry 로 재시도한다.
 * -----------------------------------------------------------------------------
 */

const fs = require("fs");
const OpenAI = require("openai");

/**
 * 깊은 복사
 *
 * 사용 목적:
 *  - JSON Schema 객체를 직접 수정하지 않고 복사본을 만든 뒤 보정하기 위해 사용한다.
 *  - strictifySchema 내부에서 원본 schema 변형을 방지한다.
 *
 * 주의사항:
 *  - JSON.stringify / JSON.parse 기반이므로 함수, Date, undefined, Map, Set 등은 보존되지 않는다.
 *  - 이 모듈에서는 JSON Schema 같은 순수 JSON 객체를 다루므로 충분하다.
 *
 * @param {*} value 복사할 값
 * @returns {*} JSON 직렬화 가능한 깊은 복사본
 */
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * 순수 객체 여부 검사
 *
 * 사용 목적:
 *  - 배열이 아닌 일반 객체인지 확인한다.
 *  - JSON Schema 의 properties, $defs, definitions 등이 객체인지 검사할 때 사용한다.
 *
 * 예시:
 *
 * isPlainObject({ a: 1 }); // true
 * isPlainObject([]);       // false
 * isPlainObject(null);     // false
 *
 * @param {*} value 검사할 값
 * @returns {boolean} 배열이 아닌 일반 객체이면 true
 */
function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * object 스키마 엄격화
 *
 * 사용 목적:
 *  - OpenAI json_schema strict 모드에서 object 타입 스키마가 안정적으로 동작하도록 보정한다.
 *  - required 가 없으면 properties 의 모든 키를 required 로 자동 지정한다.
 *  - additionalProperties 가 없으면 false 로 자동 지정한다.
 *  - 배열 items, anyOf, oneOf, allOf, $defs, definitions 도 재귀적으로 보정한다.
 *
 * 예시 입력:
 *
 * const schema = {
 *   type: "object",
 *   properties: {
 *     title: {
 *       type: "string",
 *     },
 *     count: {
 *       type: "number",
 *     },
 *   },
 * };
 *
 * const strictSchema = strictifySchema(schema);
 *
 * 예시 출력:
 *
 * {
 *   type: "object",
 *   properties: {
 *     title: {
 *       type: "string",
 *     },
 *     count: {
 *       type: "number",
 *     },
 *   },
 *   required: ["title", "count"],
 *   additionalProperties: false
 * }
 *
 * 주의사항:
 *  - required 를 직접 지정한 경우에는 기존 값을 유지한다.
 *  - additionalProperties 를 직접 지정한 경우에도 기존 값을 유지한다.
 *  - 원본 객체는 직접 수정하지 않고 복사본을 반환한다.
 *
 * @param {object|array} schema JSON Schema 또는 스키마 배열
 * @returns {object|array} strict 모드에 맞게 보정된 스키마
 */
function strictifySchema(schema) {
  if (!schema || typeof schema !== "object") {
    return schema;
  }

  if (Array.isArray(schema)) {
    return schema.map(strictifySchema);
  }

  const next = clone(schema);

  if (next.type === "object") {
    next.properties = isPlainObject(next.properties) ? next.properties : {};

    for (const key of Object.keys(next.properties)) {
      next.properties[key] = strictifySchema(next.properties[key]);
    }

    if (!Array.isArray(next.required)) {
      next.required = Object.keys(next.properties);
    }

    if (next.additionalProperties === undefined) {
      next.additionalProperties = false;
    }
  }

  if (next.type === "array" && next.items) {
    next.items = strictifySchema(next.items);
  }

  for (const key of ["anyOf", "oneOf", "allOf"]) {
    if (Array.isArray(next[key])) {
      next[key] = next[key].map(strictifySchema);
    }
  }

  for (const key of ["$defs", "definitions"]) {
    if (isPlainObject(next[key])) {
      for (const defKey of Object.keys(next[key])) {
        next[key][defKey] = strictifySchema(next[key][defKey]);
      }
    }
  }

  return next;
}

/**
 * json_schema 포맷 정규화
 *
 * 사용 목적:
 *  - 호출자가 순수 JSON Schema 만 넘겨도 OpenAI json_schema 포맷으로 변환한다.
 *  - 호출자가 이미 { name, strict, schema } 형태로 넘긴 경우에도 안전하게 정규화한다.
 *
 * 지원 입력 형태 1: 순수 JSON Schema
 *
 * normalizeSchema({
 *   type: "object",
 *   properties: {
 *     answer: {
 *       type: "string",
 *     },
 *   },
 * });
 *
 * 지원 입력 형태 2: OpenAI json_schema 래퍼 형태
 *
 * normalizeSchema({
 *   name: "my_response",
 *   strict: true,
 *   schema: {
 *     type: "object",
 *     properties: {
 *       answer: {
 *         type: "string",
 *       },
 *     },
 *   },
 * });
 *
 * 반환 형태:
 *
 * {
 *   name: "response",
 *   strict: true,
 *   schema: { ...strictifySchema 결과... }
 * }
 *
 * @param {object} input JSON Schema 또는 { name, strict, schema } 객체
 * @returns {{ name: string, strict: boolean, schema: object }} 정규화된 스키마 포맷
 */
function normalizeSchema(input) {
  if (!input || typeof input !== "object") {
    throw new Error("schema 는 객체여야 합니다.");
  }

  if (!input.schema) {
    return {
      name: "response",
      strict: true,
      schema: strictifySchema(input),
    };
  }

  return {
    name: input.name || "response",
    strict: input.strict !== undefined ? input.strict : true,
    schema: strictifySchema(input.schema),
  };
}

/**
 * 모델 응답 JSON 파싱
 *
 * 사용 목적:
 *  - 모델 응답 문자열을 JSON 객체로 파싱한다.
 *  - 원칙적으로 response_format 이 JSON 만 보장하지만,
 *    SDK/모델/호출 방식 차이로 코드블록이 포함될 가능성에 대비한다.
 *
 * 처리 방식:
 *  - 앞뒤 공백 제거
 *  - ```json ... ``` 또는 ``` ... ``` 형태의 코드블록만 제거
 *  - JSON.parse 수행
 *  - 파싱 결과가 배열이나 원시값이면 오류 처리
 *
 * 예시:
 *
 * parseJSONContent('{"answer":"ok"}');
 *
 * parseJSONContent(`
 *   ```json
 *   {"answer":"ok"}
 *   ```
 * `);
 *
 * 반환:
 *
 * {
 *   answer: "ok"
 * }
 *
 * @param {string} content 모델 응답 문자열
 * @returns {object} 파싱된 JSON 객체
 */
function parseJSONContent(content) {
  const raw = String(content || "").trim();

  if (!raw) {
    throw new Error("응답 본문이 비어 있습니다.");
  }

  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const parsed = JSON.parse(cleaned);

  if (!isPlainObject(parsed)) {
    throw new Error("JSON 객체가 아닌 응답입니다.");
  }

  return parsed;
}

/**
 * 지정한 시간만큼 대기한다.
 *
 * 사용 목적:
 *  - requestWithRetry 에서 재시도 전 지연 시간을 주기 위해 사용한다.
 *
 * @param {number} ms 대기 시간 밀리초
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 재시도 가능한 OpenAI 오류인지 판단한다.
 *
 * 재시도 대상으로 보는 경우:
 *  - APIConnectionTimeoutError
 *  - timeout, ECONNRESET, ETIMEDOUT, socket hang up, fetch failed 등 네트워크성 오류
 *  - HTTP status 500 이상 서버 오류
 *
 * 재시도하지 않는 경우:
 *  - 인증 오류
 *  - 잘못된 요청
 *  - 스키마 오류
 *  - 권한 오류
 *  - 모델명 오류
 *
 * @param {Error|object} error OpenAI SDK 또는 네트워크 오류 객체
 * @returns {boolean} 재시도 가능하면 true
 */
function isRetryableOpenAIError(error) {
  const message = String(error?.message || "");
  const name = String(error?.name || "");
  const code = String(error?.code || "");
  const status = Number(error?.status || 0);

  return (
    name === "APIConnectionTimeoutError" ||
    /timed out|timeout|ECONNRESET|ETIMEDOUT|socket hang up|fetch failed|connection/i.test(
      message,
    ) ||
    /ETIMEDOUT|ECONNRESET/.test(code) ||
    status >= 500
  );
}

/**
 * OpenAI 요청 재시도 래퍼
 *
 * 사용 목적:
 *  - OpenAI API 호출 중 일시적인 네트워크 문제나 서버 오류가 발생했을 때 자동 재시도한다.
 *
 * 예시:
 *
 * const response = await requestWithRetry(
 *   () => client.chat.completions.create(payload),
 *   {
 *     retries: 2,
 *     baseDelayMs: 1500,
 *   },
 * );
 *
 * 동작:
 *  - 최초 요청 1회 수행
 *  - 실패 시 isRetryableOpenAIError 로 재시도 가능 여부 판단
 *  - 재시도 가능하면 baseDelayMs * attempt 만큼 대기 후 재요청
 *  - 모든 시도가 실패하면 마지막 오류를 throw
 *
 * @param {Function} task 실행할 비동기 작업 함수
 * @param {object} options 재시도 옵션
 * @param {number} options.retries 재시도 횟수
 * @param {number} options.baseDelayMs 기본 지연 시간
 * @returns {Promise<*>} task 성공 결과
 */
async function requestWithRetry(task, options = {}) {
  const retries = Math.max(0, Number(options.retries ?? 2));
  const baseDelayMs = Math.max(300, Number(options.baseDelayMs ?? 1200));
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;

      if (!isRetryableOpenAIError(error) || attempt >= retries) {
        throw error;
      }

      await sleep(baseDelayMs * (attempt + 1));
    }
  }

  throw lastError || new Error("OpenAI 요청 실패");
}

/**
 * Responses API 텍스트 추출
 *
 * 사용 목적:
 *  - Responses API 응답 객체에서 최종 텍스트만 추출한다.
 *  - SDK 버전에 따라 response.output_text 가 있거나,
 *    response.output[].content[] 안에 output_text 가 있을 수 있으므로 둘 다 지원한다.
 *
 * 예시:
 *
 * const response = await client.responses.create(payload);
 * const text = extractResponseText(response);
 *
 * @param {object} response Responses API 응답 객체
 * @returns {string} 추출된 응답 텍스트
 */
function extractResponseText(response) {
  if (response?.output_text) {
    return String(response.output_text).trim();
  }

  const chunks = [];

  for (const item of response?.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) {
        chunks.push(content.text);
      }
    }
  }

  return chunks.join("\n").trim();
}

/**
 * Responses API 용 JSON Schema 포맷 생성
 *
 * 사용 목적:
 *  - Responses API 의 text.format 에 들어갈 json_schema 포맷을 만든다.
 *  - 내부적으로 normalizeSchema 를 호출해 strict schema 로 보정한다.
 *
 * 반환 예시:
 *
 * {
 *   type: "json_schema",
 *   name: "response",
 *   strict: true,
 *   schema: {
 *     type: "object",
 *     properties: { ... },
 *     required: [ ... ],
 *     additionalProperties: false
 *   }
 * }
 *
 * @param {object} schema JSON Schema 또는 { name, strict, schema }
 * @returns {object} Responses API text.format 값
 */
function buildResponseTextFormat(schema) {
  const finalSchema = normalizeSchema(schema);

  return {
    type: "json_schema",
    name: finalSchema.name,
    strict: finalSchema.strict,
    schema: finalSchema.schema,
  };
}

/**
 * 파일/이미지 입력 콘텐츠 생성
 *
 * 사용 목적:
 *  - Responses API 에 전달할 input content 배열을 생성한다.
 *  - 이미지 파일은 base64 data URL 로 변환해 input_image 로 넣는다.
 *  - 이미지가 아닌 파일은 OpenAI Files API 로 업로드한 뒤 input_file 로 넣는다.
 *
 * mediaItems 형식:
 *
 * [
 *   {
 *     path: "./image.png",
 *     mime: "image/png",
 *     detail: "high"
 *   },
 *   {
 *     path: "./document.pdf",
 *     mime: "application/pdf",
 *     name: "document.pdf"
 *   }
 * ]
 *
 * 이미지 처리:
 *  - mime 이 image/ 로 시작하면 fs.readFileSync 로 읽어서 base64 인코딩한다.
 *  - detail 값이 없으면 "high" 를 기본값으로 사용한다.
 *
 * 일반 파일 처리:
 *  - client.files.create 로 업로드한다.
 *  - purpose 는 "user_data" 로 지정한다.
 *
 * 주의사항:
 *  - path 가 없거나 실제 파일이 존재하지 않으면 해당 item 은 무시한다.
 *  - 대용량 파일은 OpenAI API 제한에 걸릴 수 있다.
 *
 * @param {OpenAI} client OpenAI SDK 클라이언트
 * @param {Array<object>} mediaItems 파일/이미지 목록
 * @returns {Promise<Array<object>>} Responses API input content 배열 일부
 */
async function buildResponseMediaContent(client, mediaItems = []) {
  const content = [];

  for (const item of mediaItems) {
    if (!item || !item.path || !fs.existsSync(item.path)) {
      continue;
    }

    const mime = String(item.mime || "").toLowerCase();
    const name = item.name || item.filename || item.path;

    if (mime.startsWith("image/")) {
      const base64 = fs.readFileSync(item.path).toString("base64");

      content.push({
        type: "input_image",
        image_url: "data:" + mime + ";base64," + base64,
        detail: item.detail || "high",
      });

      continue;
    }

    const uploaded = await client.files.create({
      file: fs.createReadStream(item.path),
      purpose: "user_data",
    });

    content.push({
      type: "input_file",
      file_id: uploaded.id,
    });
  }

  return content;
}

/**
 * LLM 서비스
 *
 * 사용 목적:
 *  - OpenAI 클라이언트를 감싸서 JSON 응답 전용 메서드를 제공한다.
 *  - 일반 JSON 요청, 도구 기반 JSON 요청, 파일/이미지 분석, 웹검색 연구 요청을 담당한다.
 *
 * 생성 예시:
 *
 * const llm = new LLMService({
 *   apiKey: process.env.OPENAI_API_KEY,
 *   timeout: 120000,
 * });
 *
 * 또는:
 *
 * const { createLLM } = require("./llm");
 *
 * const llm = createLLM({
 *   apiKey: process.env.OPENAI_API_KEY,
 * });
 */
class LLMService {
  /**
   * 생성자
   *
   * 사용 목적:
   *  - OpenAI SDK 클라이언트를 초기화한다.
   *
   * options:
   *  - apiKey: OpenAI API 키. 필수.
   *  - timeout: 요청 타임아웃 밀리초. 기본값 120000.
   *
   * 예시:
   *
   * const llm = new LLMService({
   *   apiKey: process.env.OPENAI_API_KEY,
   *   timeout: 180000,
   * });
   *
   * @param {object} options 초기화 옵션
   * @param {string} options.apiKey OpenAI API 키
   * @param {number} options.timeout 요청 타임아웃 밀리초
   */
  constructor({ apiKey, timeout = 120000 }) {
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY 가 필요합니다.");
    }

    this.client = new OpenAI({ apiKey, timeout });
  }

  /**
   * JSON 요청
   *
   * 사용 목적:
   *  - Chat Completions API 를 사용해 JSON Schema 에 맞는 객체를 반환받는다.
   *  - 가장 기본적인 JSON 전용 질의 메서드다.
   *
   * 적합한 상황:
   *  - 웹검색이 필요 없는 일반 텍스트 질의
   *  - 파일/이미지 입력이 필요 없는 구조화 추출
   *  - 상위 app.js 에서 모델명을 직접 지정하는 구조
   *
   * 입력 옵션:
   *  - model: 사용할 OpenAI 모델명. 필수.
   *  - developer: developer 메시지. 생략 시 JSON 전용 기본 지시문 사용.
   *  - user: 사용자 요청 문자열.
   *  - schema: JSON Schema 또는 { name, strict, schema } 형태.
   *  - messages: 추가 대화 메시지 배열.
   *  - temperature: 모델 온도. 필요할 때만 지정.
   *  - maxCompletionTokens: 최대 응답 토큰 수.
   *
   * 기본 예시:
   *
   * const result = await llm.askJSON({
   *   model: "gpt-4.1-mini",
   *   user: "아래 문장에서 이름과 직업을 추출해줘: 홍길동은 백엔드 개발자입니다.",
   *   schema: {
   *     type: "object",
   *     properties: {
   *       name: {
   *         type: "string",
   *       },
   *       job: {
   *         type: "string",
   *       },
   *     },
   *   },
   * });
   *
   * console.log(result);
   *
   * // 예상 결과:
   * // {
   * //   name: "홍길동",
   * //   job: "백엔드 개발자"
   * // }
   *
   * 추가 messages 사용 예시:
   *
   * const result = await llm.askJSON({
   *   model: "gpt-4.1-mini",
   *   developer: "너는 상품 리뷰 분석기다.",
   *   messages: [
   *     {
   *       role: "user",
   *       content: "이전 리뷰 기준은 긍정/중립/부정 세 가지다.",
   *     },
   *   ],
   *   user: "배송은 느렸지만 제품 품질은 좋았어.",
   *   schema: {
   *     type: "object",
   *     properties: {
   *       sentiment: {
   *         type: "string",
   *         enum: ["positive", "neutral", "negative"],
   *       },
   *       reason: {
   *         type: "string",
   *       },
   *     },
   *   },
   * });
   *
   * 오류 처리:
   *  - model 이 없으면 오류
   *  - 모델이 refusal 을 반환하면 오류
   *  - finish_reason 이 length 면 토큰 제한 오류
   *  - JSON 파싱에 실패하면 파싱 실패 오류
   *
   * @param {object} options JSON 요청 옵션
   * @returns {Promise<object>} JSON Schema 에 맞게 파싱된 객체
   */
  async askJSON({
    model,
    developer,
    user,
    schema,
    messages = [],
    temperature,
    maxCompletionTokens,
  }) {
    if (!model) {
      throw new Error("model 이 필요합니다.");
    }

    const finalSchema = normalizeSchema(schema);

    const finalMessages = [
      {
        role: "developer",
        content: [
          developer || "너는 JSON 응답 전용 assistant 다.",
          "반드시 JSON 스키마와 정확히 일치하는 JSON 객체만 반환한다.",
          "설명문, 마크다운, 코드블록, 부가 텍스트를 절대 넣지 않는다.",
          "확신이 낮으면 필드를 비우지 말고 스키마가 허용하는 가장 보수적인 값을 넣는다.",
        ].join("\n"),
      },
      ...messages.filter(
        (item) => item && item.role && item.content !== undefined,
      ),
      {
        role: "user",
        content: String(user || ""),
      },
    ];

    const payload = {
      model,
      messages: finalMessages,
      response_format: {
        type: "json_schema",
        json_schema: finalSchema,
      },
    };

    if (temperature !== undefined) {
      payload.temperature = temperature;
    }

    if (maxCompletionTokens !== undefined) {
      payload.max_completion_tokens = maxCompletionTokens;
    }

    const response = await requestWithRetry(
      () => this.client.chat.completions.create(payload),
      { retries: 2, baseDelayMs: 1500 },
    );

    const choice = response?.choices?.[0];
    const refusal = choice?.message?.refusal;
    const content = choice?.message?.content;

    if (refusal) {
      throw new Error(`모델이 요청을 거절했습니다: ${refusal}`);
    }

    if (choice?.finish_reason === "length") {
      throw new Error(
        "모델 응답이 토큰 제한으로 잘렸습니다. maxCompletionTokens 를 늘려주세요.",
      );
    }

    try {
      return parseJSONContent(content);
    } catch (error) {
      throw new Error(`JSON 파싱 실패: ${error.message}`);
    }
  }

  /**
   * Responses API 기반 JSON 요청
   *
   * 사용 목적:
   *  - Responses API 를 사용해 JSON Schema 에 맞는 객체를 반환받는다.
   *  - 웹검색, 파일 입력, 이미지 입력이 필요한 작업에 사용한다.
   *
   * 적합한 상황:
   *  - enableWebSearch 로 최신 정보 검색이 필요한 경우
   *  - mediaItems 로 이미지나 PDF 같은 파일을 함께 분석해야 하는 경우
   *  - reasoningEffort, maxOutputTokens 등 Responses API 옵션을 사용하고 싶은 경우
   *
   * 기본 예시:
   *
   * const result = await llm.askJSONWithTools({
   *   model: "gpt-4.1",
   *   user: "첨부 파일의 핵심 내용을 JSON으로 요약해줘.",
   *   mediaItems: [
   *     {
   *       path: "./report.pdf",
   *       mime: "application/pdf",
   *       name: "report.pdf",
   *     },
   *   ],
   *   schema: {
   *     type: "object",
   *     properties: {
   *       summary: {
   *         type: "string",
   *       },
   *       keyPoints: {
   *         type: "array",
   *         items: {
   *           type: "string",
   *         },
   *       },
   *     },
   *   },
   * });
   *
   * 웹검색 예시:
   *
   * const result = await llm.askJSONWithTools({
   *   model: "gpt-4.1",
   *   user: "현재 Node.js LTS 버전과 주요 변경점을 알려줘.",
   *   enableWebSearch: true,
   *   schema: {
   *     type: "object",
   *     properties: {
   *       currentLTS: {
   *         type: "string",
   *       },
   *       highlights: {
   *         type: "array",
   *         items: {
   *           type: "string",
   *         },
   *       },
   *     },
   *   },
   * });
   *
   * 이미지 분석 예시:
   *
   * const result = await llm.askJSONWithTools({
   *   model: "gpt-4.1",
   *   user: "이미지에 보이는 UI 문제를 분석해줘.",
   *   mediaItems: [
   *     {
   *       path: "./screenshot.png",
   *       mime: "image/png",
   *       detail: "high",
   *     },
   *   ],
   *   schema: {
   *     type: "object",
   *     properties: {
   *       issues: {
   *         type: "array",
   *         items: {
   *           type: "string",
   *         },
   *       },
   *       recommendation: {
   *         type: "string",
   *       },
   *     },
   *   },
   * });
   *
   * 주요 옵션:
   *  - enableWebSearch: true 이면 Responses API tools 에 웹검색 도구를 추가한다.
   *  - webSearchToolType: 기본값은 process.env.OPENAI_WEB_SEARCH_TOOL 또는 "web_search_preview".
   *  - reasoningEffort: 모델이 지원하는 경우 reasoning effort 를 설정한다.
   *  - maxOutputTokens: Responses API 의 max_output_tokens 로 전달한다.
   *
   * 주의사항:
   *  - 현재 설치된 openai 패키지가 responses.create 를 지원해야 한다.
   *  - 파일 업로드가 필요한 경우 API 권한과 파일 크기 제한을 확인해야 한다.
   *  - 반환 텍스트는 extractResponseText 로 추출한 뒤 parseJSONContent 로 검증한다.
   *
   * @param {object} options Responses API JSON 요청 옵션
   * @returns {Promise<object>} JSON Schema 에 맞게 파싱된 객체
   */
  async askJSONWithTools({
    model,
    developer,
    user,
    schema,
    mediaItems = [],
    enableWebSearch = false,
    reasoningEffort,
    maxOutputTokens,
    webSearchToolType = process.env.OPENAI_WEB_SEARCH_TOOL ||
      "web_search_preview",
  }) {
    if (!model) {
      throw new Error("model 이 필요합니다.");
    }

    if (!this.client.responses?.create) {
      throw new Error(
        "현재 openai 패키지가 Responses API 를 지원하지 않습니다. openai 패키지를 최신 버전으로 업데이트하세요.",
      );
    }

    const content = [
      {
        type: "input_text",
        text: String(user || ""),
      },
      ...(await buildResponseMediaContent(this.client, mediaItems)),
    ];

    const tools = [];

    if (enableWebSearch) {
      tools.push({ type: webSearchToolType });
    }

    const payload = {
      model,
      instructions: [
        developer || "너는 JSON 응답 전용 assistant 다.",
        "반드시 지정된 JSON Schema 로만 응답한다.",
        "근거가 필요한 경우 현재 요청에서 검색하거나 제공받은 파일/이미지 내용만 사용한다.",
      ].join("\n"),
      input: [
        {
          role: "user",
          content,
        },
      ],
      text: {
        format: buildResponseTextFormat(schema),
      },
    };

    if (tools.length) {
      payload.tools = tools;
    }

    if (reasoningEffort) {
      payload.reasoning = { effort: reasoningEffort };
    }

    if (maxOutputTokens !== undefined) {
      payload.max_output_tokens = maxOutputTokens;
    }

    const response = await requestWithRetry(
      () => this.client.responses.create(payload),
      { retries: 2, baseDelayMs: 1500 },
    );

    const text = extractResponseText(response);

    try {
      return parseJSONContent(text);
    } catch (error) {
      throw new Error("Responses JSON 파싱 실패: " + error.message);
    }
  }

  /**
   * 파일/이미지 요약 전용 편의 함수
   *
   * 사용 목적:
   *  - askJSONWithTools 를 파일/이미지 분석 용도로 간단히 호출하기 위한 래퍼다.
   *  - enableWebSearch 는 false 로 고정된다.
   *  - 기본 maxOutputTokens 는 1800 이다.
   *
   * 적합한 상황:
   *  - 이미지 설명 생성
   *  - PDF 내용 요약
   *  - 첨부 자료에서 구조화된 정보 추출
   *
   * 예시:
   *
   * const result = await llm.analyzeMediaJSON({
   *   model: "gpt-4.1",
   *   user: "첨부한 영수증 이미지에서 결제 정보를 추출해줘.",
   *   mediaItems: [
   *     {
   *       path: "./receipt.jpg",
   *       mime: "image/jpeg",
   *       detail: "high",
   *     },
   *   ],
   *   schema: {
   *     type: "object",
   *     properties: {
   *       storeName: {
   *         type: "string",
   *       },
   *       totalAmount: {
   *         type: "number",
   *       },
   *       purchasedAt: {
   *         type: "string",
   *       },
   *       items: {
   *         type: "array",
   *         items: {
   *           type: "object",
   *           properties: {
   *             name: {
   *               type: "string",
   *             },
   *             price: {
   *               type: "number",
   *             },
   *           },
   *         },
   *       },
   *     },
   *   },
   * });
   *
   * console.log(result);
   *
   * @param {object} options 파일/이미지 분석 옵션
   * @returns {Promise<object>} JSON Schema 에 맞게 파싱된 객체
   */
  async analyzeMediaJSON({
    model,
    developer,
    user,
    schema,
    mediaItems = [],
    maxOutputTokens = 1800,
  }) {
    return this.askJSONWithTools({
      model,
      developer,
      user,
      schema,
      mediaItems,
      enableWebSearch: false,
      maxOutputTokens,
    });
  }

  /**
   * 웹검색 기반 연구/근거 응답 전용 편의 함수
   *
   * 사용 목적:
   *  - askJSONWithTools 를 웹검색 기반 조사 용도로 간단히 호출하기 위한 래퍼다.
   *  - enableWebSearch 는 true 로 고정된다.
   *  - 기본 reasoningEffort 는 "medium" 이다.
   *  - 기본 maxOutputTokens 는 2600 이다.
   *
   * 적합한 상황:
   *  - 최신 라이브러리 버전 확인
   *  - 현재 정책, 가격, 제품 정보 조사
   *  - 최신 문서나 공식 정보 기반 요약
   *  - 근거가 필요한 리서치형 응답
   *
   * 예시:
   *
   * const result = await llm.researchJSON({
   *   model: "gpt-4.1",
   *   user: "현재 Next.js 최신 버전의 주요 기능을 조사해서 정리해줘.",
   *   schema: {
   *     type: "object",
   *     properties: {
   *       latestVersion: {
   *         type: "string",
   *       },
   *       features: {
   *         type: "array",
   *         items: {
   *           type: "string",
   *         },
   *       },
   *       notes: {
   *         type: "array",
   *         items: {
   *           type: "string",
   *         },
   *       },
   *     },
   *   },
   * });
   *
   * console.log(result);
   *
   * 파일과 웹검색을 함께 쓰는 예시:
   *
   * const result = await llm.researchJSON({
   *   model: "gpt-4.1",
   *   user: "첨부한 기획안과 현재 시장 정보를 비교해서 보완점을 정리해줘.",
   *   mediaItems: [
   *     {
   *       path: "./proposal.pdf",
   *       mime: "application/pdf",
   *       name: "proposal.pdf",
   *     },
   *   ],
   *   schema: {
   *     type: "object",
   *     properties: {
   *       marketSummary: {
   *         type: "string",
   *       },
   *       gaps: {
   *         type: "array",
   *         items: {
   *           type: "string",
   *         },
   *       },
   *       recommendations: {
   *         type: "array",
   *         items: {
   *           type: "string",
   *         },
   *       },
   *     },
   *   },
   * });
   *
   * 주의사항:
   *  - 검색 결과 품질은 모델과 웹검색 도구 지원 상태에 영향을 받는다.
   *  - 스키마에 출처 URL 필드를 추가하면 상위 애플리케이션에서 근거 관리가 쉬워진다.
   *
   * @param {object} options 웹검색 기반 연구 옵션
   * @returns {Promise<object>} JSON Schema 에 맞게 파싱된 객체
   */
  async researchJSON({
    model,
    developer,
    user,
    schema,
    mediaItems = [],
    reasoningEffort = "medium",
    maxOutputTokens = 2600,
  }) {
    return this.askJSONWithTools({
      model,
      developer,
      user,
      schema,
      mediaItems,
      enableWebSearch: true,
      reasoningEffort,
      maxOutputTokens,
    });
  }

  /**
   * 기존 스타일 호환 메서드
   *
   * 사용 목적:
   *  - 이전 코드에서 generateString(model, content, offer, responseFormat) 형태로 호출하던 방식을 유지한다.
   *  - 내부적으로는 askJSON 을 호출한다.
   *
   * 매개변수 매핑:
   *  - model          -> askJSON.model
   *  - content        -> askJSON.developer
   *  - offer          -> askJSON.user
   *  - responseFormat -> askJSON.schema
   *
   * 예시:
   *
   * const result = await llm.generateString(
   *   "gpt-4.1-mini",
   *   "너는 상품명 정규화 assistant 다.",
   *   "애플 아이폰 15 프로 256기가 블루",
   *   {
   *     type: "object",
   *     properties: {
   *       brand: {
   *         type: "string",
   *       },
   *       product: {
   *         type: "string",
   *       },
   *       storage: {
   *         type: "string",
   *       },
   *       color: {
   *         type: "string",
   *       },
   *     },
   *   },
   * );
   *
   * console.log(result);
   *
   * @param {string} model 모델명
   * @param {string} content developer 지시문
   * @param {string} offer 사용자 입력
   * @param {object} responseFormat JSON Schema
   * @returns {Promise<object>} JSON Schema 에 맞게 파싱된 객체
   */
  async generateString(model, content, offer, responseFormat) {
    return this.askJSON({
      model,
      developer: content,
      user: offer,
      schema: responseFormat,
    });
  }
}

/**
 * LLMService 팩토리
 *
 * 사용 목적:
 *  - new LLMService(...) 를 직접 호출하지 않고 간단히 서비스 인스턴스를 생성한다.
 *  - 상위 app.js 에서 의존성 주입 형태로 사용하기 좋다.
 *
 * 예시:
 *
 * const { createLLM } = require("./llm");
 *
 * const llm = createLLM({
 *   apiKey: process.env.OPENAI_API_KEY,
 *   timeout: 120000,
 * });
 *
 * const result = await llm.askJSON({
 *   model: "gpt-4.1-mini",
 *   user: "JSON으로만 답해줘.",
 *   schema: {
 *     type: "object",
 *     properties: {
 *       ok: {
 *         type: "boolean",
 *       },
 *     },
 *   },
 * });
 *
 * @param {object} options LLMService 생성 옵션
 * @returns {LLMService} LLMService 인스턴스
 */
function createLLM(options) {
  return new LLMService(options);
}

/**
 * 모듈 내보내기
 *
 * 외부에서 사용 가능한 항목:
 *  - createLLM: 가장 일반적인 서비스 생성 함수
 *  - LLMService: 직접 인스턴스를 만들고 싶을 때 사용하는 클래스
 *  - strictifySchema: JSON Schema strict 보정 함수
 *  - normalizeSchema: OpenAI json_schema 포맷 정규화 함수
 *  - parseJSONContent: 모델 응답 JSON 파싱 함수
 *  - extractResponseText: Responses API 응답 텍스트 추출 함수
 *
 * 일반 사용:
 *
 * const { createLLM } = require("./llm");
 *
 * 테스트나 유틸리티 사용:
 *
 * const {
 *   strictifySchema,
 *   normalizeSchema,
 *   parseJSONContent,
 * } = require("./llm");
 */
module.exports = {
  createLLM,
  LLMService,
  strictifySchema,
  normalizeSchema,
  parseJSONContent,
  extractResponseText,
};