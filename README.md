# SubGPT

SubGPT is a project that hosts a lightweight multi-provider chat workstation. It keeps a rolling inbox of threads and uses `localStorage` for persistence, letting you switch between xAI Grok and OpenAI models without leaving the browser.

## Running

```sh
$ git clone https://github.com/guiprav2/subgpt.git
$ cd subgpt
$ npx serve
```

## Highlights

- Threaded chat interface with quick filters, archives, and tagging helpers.
- Local, privacy-friendly persistence of API keys, model choice, and transcripts.
- Markdown rendering with editing hooks for every log entry.
- Provider-agnostic completion client that supports OpenAI Responses, legacy Chat Completions, and xAI’s Grok endpoint.

## Configuring API Keys & Models

- The UI prompts for OpenAI and/or xAI keys in the left-hand settings column. Keys live only in `localStorage` and are not sent anywhere except the selected provider endpoint when issuing completions.
- Default model: `xai:grok-4-1-fast-non-reasoning`. Change it via the model picker next to the input box.
- Toggle extras like automatic tagging, unary messaging, erotica filtering, and role mapping through the switches rendered in the settings panel.
