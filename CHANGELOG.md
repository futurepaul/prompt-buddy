# Change Log

All notable changes to the "prompt-buddy" extension will be documented in this file.

## [0.1.5]

### Changed
- Cursor doesn't show the intellisense lightbulb, so now when you're in a .pbmd file there's a "Prompt Buddy" guy in the bottom status bar to see the available commands.
- (You can still use the command palette to add files / copy the prompt, this is just for discovery).
- Be smarter about adding files to the context vs creating a new context block.
- Change the version number arbitrarily.

## [0.0.4]

### Changed
- Removed webview editor in favor of code actions in the regular editor
- Removed notes feature to focus on file context
- Renamed `<pb-context>` tag to just `<context>` for simplicity
- Added proper language detection for code blocks

## [0.0.3]

### Added
- Added the ability to select multiple files
- Follows `.gitignore` by default
- Sorts files by modification time (most recent first)

### Changed
- Added the ability to disable auto-open preview

## [0.0.2]

### Added
- Added the app icon

## [0.0.1]

### Added
- Initial release of Prompt Buddy