// test/fixtures.ts
// Synthetic conversation data for tests — no real exports.

export interface Citation {
  title?: string;
  url: string;
  start_index: number;
  end_index: number;
}

export interface MessageBlock {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: Array<{ text?: string }>;
  is_error?: boolean;
  display_content?: { content: unknown[] };
  citations?: Citation[];
}

export interface Message {
  uuid: string;
  sender: "human" | "assistant";
  content: MessageBlock[];
  created_at: string;
  attachments?: Array<{ file_name?: string; file_size?: number }>;
  files?: Array<{
    file_uuid?: string;
    file_kind?: string;
    file_name?: string;
    preview_url?: string;
    preview_asset?: { url?: string };
  }>;
}

export interface ConversationData {
  uuid: string;
  name: string;
  model: string;
  created_at: string;
  updated_at: string;
  chat_messages: Message[];
}

/** Minimal conversation: 1 human + 1 assistant text message */
export function makeMinimalConversation(
  overrides: Partial<ConversationData> = {}
): ConversationData {
  return {
    uuid: "conv-001",
    name: "Test Conversation",
    model: "claude-opus-4-6",
    created_at: "2026-01-15T10:00:00Z",
    updated_at: "2026-01-15T10:05:00Z",
    chat_messages: [
      {
        uuid: "msg-001",
        sender: "human",
        content: [{ type: "text", text: "Hello Claude" }],
        created_at: "2026-01-15T10:00:00Z",
      },
      {
        uuid: "msg-002",
        sender: "assistant",
        content: [{ type: "text", text: "Hello! How can I help you today?" }],
        created_at: "2026-01-15T10:00:30Z",
      },
    ],
    ...overrides,
  };
}

/** Conversation with thinking blocks across multiple assistant messages */
export function makeConversationWithThinking(): ConversationData {
  return makeMinimalConversation({
    chat_messages: [
      {
        uuid: "msg-001",
        sender: "human",
        content: [{ type: "text", text: "What is 2+2?" }],
        created_at: "2026-01-15T10:00:00Z",
      },
      {
        uuid: "msg-002",
        sender: "assistant",
        content: [
          { type: "thinking", thinking: "Let me calculate this.\n2+2=4" },
          { type: "thinking", thinking: "Double checking: yes, 4." },
          { type: "text", text: "The answer is 4." },
        ],
        created_at: "2026-01-15T10:00:30Z",
      },
    ],
  });
}

/** Conversation with tool_use and tool_result blocks */
export function makeConversationWithTools(): ConversationData {
  return makeMinimalConversation({
    chat_messages: [
      {
        uuid: "msg-001",
        sender: "human",
        content: [{ type: "text", text: "Search for something" }],
        created_at: "2026-01-15T10:00:00Z",
      },
      {
        uuid: "msg-002",
        sender: "assistant",
        content: [
          {
            type: "tool_use",
            name: "web_search",
            input: { query: "test query" },
          },
          {
            type: "tool_result",
            content: [{ text: "Found 3 results" }],
            is_error: false,
          },
          { type: "text", text: "Here is what I found." },
          {
            type: "tool_use",
            name: "web_fetch",
            input: { url: "https://example.com" },
          },
          {
            type: "tool_result",
            content: [{ text: "OK" }],
            is_error: false,
          },
          { type: "text", text: "I fetched the page." },
        ],
        created_at: "2026-01-15T10:00:30Z",
      },
    ],
  });
}

/** Conversation with artifact create + update */
export function makeConversationWithArtifacts(): ConversationData {
  return makeMinimalConversation({
    chat_messages: [
      {
        uuid: "msg-001",
        sender: "human",
        content: [{ type: "text", text: "Write me a script" }],
        created_at: "2026-01-15T10:00:00Z",
      },
      {
        uuid: "msg-002",
        sender: "assistant",
        content: [
          { type: "text", text: "Here is the script:" },
          {
            type: "tool_use",
            name: "artifacts",
            input: {
              id: "art-001",
              command: "create",
              title: "My Script",
              type: "text/x-python",
              content: 'print("hello world")\nprint("goodbye")',
            },
          },
        ],
        created_at: "2026-01-15T10:00:30Z",
      },
      {
        uuid: "msg-003",
        sender: "human",
        content: [{ type: "text", text: "Change hello to hi" }],
        created_at: "2026-01-15T10:01:00Z",
      },
      {
        uuid: "msg-004",
        sender: "assistant",
        content: [
          { type: "text", text: "Updated:" },
          {
            type: "tool_use",
            name: "artifacts",
            input: {
              id: "art-001",
              command: "update",
              old_str: "hello world",
              new_str: "hi world",
            },
          },
        ],
        created_at: "2026-01-15T10:01:30Z",
      },
    ],
  });
}

/** Conversation where the artifact is rewritten with a fresh full-content version */
export function makeConversationWithArtifactRewrite(): ConversationData {
  return makeMinimalConversation({
    chat_messages: [
      {
        uuid: "msg-001",
        sender: "human",
        content: [{ type: "text", text: "Write me a script" }],
        created_at: "2026-01-15T10:00:00Z",
      },
      {
        uuid: "msg-002",
        sender: "assistant",
        content: [
          {
            type: "tool_use",
            name: "artifacts",
            input: {
              id: "art-001",
              command: "create",
              title: "My Script",
              type: "text/x-python",
              content: 'print("v1 original")',
            },
          },
        ],
        created_at: "2026-01-15T10:00:30Z",
      },
      {
        uuid: "msg-003",
        sender: "human",
        content: [{ type: "text", text: "Rewrite it from scratch" }],
        created_at: "2026-01-15T10:01:00Z",
      },
      {
        uuid: "msg-004",
        sender: "assistant",
        content: [
          {
            type: "tool_use",
            name: "artifacts",
            input: {
              id: "art-001",
              command: "rewrite",
              content: 'print("v2 fully rewritten")\nprint("with new line")',
            },
          },
        ],
        created_at: "2026-01-15T10:01:30Z",
      },
    ],
  });
}

/** Conversation where create_file replaces an existing artifact */
export function makeConversationWithCreateFileUpdate(): ConversationData {
  return makeMinimalConversation({
    chat_messages: [
      {
        uuid: "msg-001",
        sender: "human",
        content: [{ type: "text", text: "Write me a guide" }],
        created_at: "2026-01-15T10:00:00Z",
      },
      {
        uuid: "msg-002",
        sender: "assistant",
        content: [
          { type: "text", text: "Here is the guide:" },
          {
            type: "tool_use",
            name: "artifacts",
            input: {
              id: "art-001",
              command: "create",
              title: "My Guide",
              type: "text/markdown",
              content: "# My Guide\n\nOriginal content v1",
            },
          },
        ],
        created_at: "2026-01-15T10:00:30Z",
      },
      {
        uuid: "msg-003",
        sender: "human",
        content: [{ type: "text", text: "Expand the guide" }],
        created_at: "2026-01-15T10:01:00Z",
      },
      {
        uuid: "msg-004",
        sender: "assistant",
        content: [
          { type: "text", text: "Let me recreate the full guide." },
          {
            type: "tool_use",
            name: "create_file",
            input: {
              path: "/mnt/user-data/outputs/my-guide.md",
              file_text: "# My Guide\n\nExpanded content v2 with more details",
              description: "Full updated guide",
            },
          },
          {
            type: "tool_result",
            content: [{ text: "File created successfully" }],
          },
          {
            type: "tool_use",
            name: "present_files",
            input: {
              filepaths: ["/mnt/user-data/outputs/my-guide.md"],
            },
          },
          {
            type: "tool_result",
            content: [{ text: "ok" }],
          },
          { type: "text", text: "Here is the updated guide." },
        ],
        created_at: "2026-01-15T10:01:30Z",
      },
    ],
  });
}

/** Conversation where create_file is a standalone artifact (no prior artifacts tool) */
export function makeConversationWithStandaloneCreateFile(): ConversationData {
  return makeMinimalConversation({
    chat_messages: [
      {
        uuid: "msg-001",
        sender: "human",
        content: [{ type: "text", text: "Make a script" }],
        created_at: "2026-01-15T10:00:00Z",
      },
      {
        uuid: "msg-002",
        sender: "assistant",
        content: [
          { type: "text", text: "Here you go:" },
          {
            type: "tool_use",
            name: "create_file",
            input: {
              path: "/mnt/user-data/outputs/helper.py",
              file_text: "#!/usr/bin/env python3\nprint('hello')\n",
              description: "Helper script",
            },
          },
          {
            type: "tool_result",
            content: [{ text: "File created" }],
          },
        ],
        created_at: "2026-01-15T10:00:30Z",
      },
    ],
  });
}

/** Conversation with attachments on human message */
export function makeConversationWithAttachments(): ConversationData {
  return makeMinimalConversation({
    chat_messages: [
      {
        uuid: "msg-001",
        sender: "human",
        content: [{ type: "text", text: "Look at this file" }],
        created_at: "2026-01-15T10:00:00Z",
        attachments: [
          { file_name: "data.csv", file_size: 2048 },
          { file_name: "notes.txt", file_size: 512 },
        ],
      },
      {
        uuid: "msg-002",
        sender: "assistant",
        content: [{ type: "text", text: "I see two files." }],
        created_at: "2026-01-15T10:00:30Z",
      },
    ],
  });
}

/** Conversation with image files (preview_url) */
export function makeConversationWithImages(): ConversationData {
  return makeMinimalConversation({
    chat_messages: [
      {
        uuid: "msg-001",
        sender: "human",
        content: [{ type: "text", text: "What is in this image?" }],
        created_at: "2026-01-15T10:00:00Z",
        files: [
          {
            file_uuid: "img-001",
            file_kind: "image",
            file_name: "screenshot.png",
            preview_url: "/files/img-001/preview",
          },
        ],
      },
      {
        uuid: "msg-002",
        sender: "assistant",
        content: [{ type: "text", text: "I see a screenshot." }],
        created_at: "2026-01-15T10:00:30Z",
      },
    ],
  });
}

/** Conversation with image using preview_asset.url fallback */
export function makeConversationWithPreviewAsset(): ConversationData {
  return makeMinimalConversation({
    chat_messages: [
      {
        uuid: "msg-001",
        sender: "human",
        content: [{ type: "text", text: "Another image" }],
        created_at: "2026-01-15T10:00:00Z",
        files: [
          {
            file_uuid: "img-002",
            file_kind: "image",
            file_name: "photo.jpg",
            preview_asset: { url: "https://cdn.example.com/photo.jpg" },
          },
        ],
      },
      {
        uuid: "msg-002",
        sender: "assistant",
        content: [{ type: "text", text: "Nice photo." }],
        created_at: "2026-01-15T10:00:30Z",
      },
    ],
  });
}

/** Conversation with error tool result and display_content */
export function makeConversationWithToolErrors(): ConversationData {
  return makeMinimalConversation({
    chat_messages: [
      {
        uuid: "msg-001",
        sender: "human",
        content: [{ type: "text", text: "Do something" }],
        created_at: "2026-01-15T10:00:00Z",
      },
      {
        uuid: "msg-002",
        sender: "assistant",
        content: [
          {
            type: "tool_use",
            name: "conversation_search",
            input: { query: "test" },
          },
          {
            type: "tool_result",
            content: [],
            is_error: true,
          },
          { type: "text", text: "That failed, let me try again." },
        ],
        created_at: "2026-01-15T10:00:30Z",
      },
    ],
  });
}

/** Conversation with HTML-sensitive content in tool results */
export function makeConversationWithHtmlInTools(): ConversationData {
  return makeMinimalConversation({
    chat_messages: [
      {
        uuid: "msg-001",
        sender: "human",
        content: [{ type: "text", text: "Search" }],
        created_at: "2026-01-15T10:00:00Z",
      },
      {
        uuid: "msg-002",
        sender: "assistant",
        content: [
          {
            type: "tool_use",
            name: "web_search",
            input: { query: "test" },
          },
          {
            type: "tool_result",
            content: [{ text: "<div>result</div>" }],
            is_error: false,
          },
          { type: "text", text: "Done." },
        ],
        created_at: "2026-01-15T10:00:30Z",
      },
    ],
  });
}

/** Conversation with citations (web search results referenced inline) */
export function makeConversationWithCitations(): ConversationData {
  return makeMinimalConversation({
    chat_messages: [
      {
        uuid: "msg-001",
        sender: "human",
        content: [{ type: "text", text: "Research calendar apps" }],
        created_at: "2026-01-15T10:00:00Z",
      },
      {
        uuid: "msg-002",
        sender: "assistant",
        content: [
          {
            type: "text",
            text: "Acme is a calendar app. It has a scheduling feature for time management. Users report good integration with note-taking apps.",
            citations: [
              {
                title: "Scheduling Guide | Acme",
                url: "https://example.com/guides/scheduling",
                start_index: 24,
                end_index: 72,
              },
              {
                title: "Note-taking Integration | Acme",
                url: "https://example.com/integrations/notes",
                start_index: 73,
                end_index: 125,
              },
            ],
          },
          {
            type: "text",
            text: "Acme also has an API for developers.",
            citations: [
              {
                title: "Acme API Docs",
                url: "https://docs.example.com/",
                start_index: 0,
                end_index: 36,
              },
            ],
          },
        ],
        created_at: "2026-01-15T10:00:30Z",
      },
    ],
  });
}

/** Conversation with duplicate citation URLs (should deduplicate in links section) */
export function makeConversationWithDuplicateCitations(): ConversationData {
  return makeMinimalConversation({
    chat_messages: [
      {
        uuid: "msg-001",
        sender: "human",
        content: [{ type: "text", text: "Tell me about widgets" }],
        created_at: "2026-01-15T10:00:00Z",
      },
      {
        uuid: "msg-002",
        sender: "assistant",
        content: [
          {
            type: "text",
            text: "Acme has widgets. Widgets help with planning.",
            citations: [
              {
                title: "Widget Guide | Acme",
                url: "https://example.com/guides/widgets",
                start_index: 0,
                end_index: 17,
              },
              {
                title: "Widget Guide | Acme",
                url: "https://example.com/guides/widgets",
                start_index: 18,
                end_index: 45,
              },
            ],
          },
        ],
        created_at: "2026-01-15T10:00:30Z",
      },
    ],
  });
}
