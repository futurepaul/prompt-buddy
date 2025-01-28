# Prompt Buddy

A VS Code extension for creating and managing prompt templates. Prompt Buddy helps you work with `.pbmd` files, which are markdown files with special tags for including file contents.

https://github.com/user-attachments/assets/2fc6ea91-2bc1-4b3b-b61f-89c5b1e41ced

## Usage

Create a `.pbmd` file and use the `<context>` tag to list files you want to include in your prompt (one per line).

Example:
```
Here's my prompt:

<context>
src/main.ts
config/settings.json
</context>

More prompt text here...
```

## Commands

- **Add Files to Context**: Opens a file picker to add files to your context (available when cursor is in a `<context>` tag)
- **Copy as Prompt**: Processes the prompt file (including all referenced file contents) and copies it to clipboard
