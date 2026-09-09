/**
 * A local mock OpenRouter Chat Completions server for MagicBlock `llm_oracle`.
 *
 * `llm_oracle` talks to OpenRouter through `chatgpt_rs`, which POSTs to
 * `OPENROUTER_API_URL` (default `https://openrouter.ai/api/v1/chat/completions`)
 * and deserializes an OpenAI-compatible body:
 *
 *   `{ id, created, model, usage:{prompt_tokens,completion_tokens,total_tokens},
 *      choices:[{ message:{ role:"assistant", content }, finish_reason, index }] }`
 *
 * CI never hits the live API: the vendor script patches `llm_oracle` so
 * `OPENROUTER_API_URL` can point here. `setOption(N)` makes `content` the
 * JSON Kassandra's GPT callback parses (`{"option_index": N}`).
 *
 * NOT imported by the default `pnpm test` suite (lives under `test/surfpool/`).
 */
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { type AddressInfo } from "node:net";

export interface CapturedOpenRouterRequest {
  model?: string;
  messages?: unknown;
  max_tokens?: number;
}

export class MockOpenRouter {
  private optionIndex = 0;
  readonly requests: CapturedOpenRouterRequest[] = [];

  private constructor(
    private readonly server: Server,
    /** Base URL (`http://127.0.0.1:<port>`) — append `/api/v1/chat/completions`. */
    readonly baseUrl: string,
  ) {}

  /** Full chatgpt_rs `api_url` to hand `llm_oracle` via `OPENROUTER_API_URL`. */
  get completionsUrl(): string {
    return `${this.baseUrl}/api/v1/chat/completions`;
  }

  static async start(): Promise<MockOpenRouter> {
    let mock: MockOpenRouter;
    const server = createServer((req, res) => {
      mock.handle(req, res).catch((e) => {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: String(e) }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    mock = new MockOpenRouter(server, `http://127.0.0.1:${port}`);
    return mock;
  }

  setOption(optionIndex: number): void {
    this.optionIndex = optionIndex;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = req.url ?? "";
    if (req.method !== "POST" || !path.includes("chat/completions")) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: { message: `not found: ${path}` } }));
      return;
    }

    const body = await readBody(req);
    let parsed: CapturedOpenRouterRequest = {};
    try {
      parsed = JSON.parse(body) as CapturedOpenRouterRequest;
    } catch {
      // llm_oracle always sends JSON; leave empty on parse failure.
    }
    this.requests.push(parsed);

    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        id: "chatcmpl-mock-0001",
        object: "chat.completion",
        created: 1,
        model: parsed.model ?? "openrouter/free",
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: JSON.stringify({ option_index: this.optionIndex }),
            },
          },
        ],
      }),
    );
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve, reject) =>
      this.server.close((err) => (err ? reject(err) : resolve())),
    );
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
