# Changelog

## [0.3.0](https://github.com/mati-cloud/daimon/compare/v0.2.0...v0.3.0) (2026-11-17)


### Features

* ship native installers instead of tarballs


### Bug Fixes

* **daemon:** ship shell integration with release builds

## [0.2.0](https://github.com/mati-cloud/daimon/compare/v0.1.0...v0.2.0) (2026-11-17)


### Features

* 60 FPS + fix flicker on custom TUI-apps on i.e. git integration
* double-click title bar to zoom/maximize window
* **git-branches:** custom output for git branch command
* icon
* icons and more
* link-preview based on OG
* native titlebar and some fixes
* plugin API
* see-through window with real desktop blur on Windows
* true native macOS window drag via performWindowDragWithEvent:
* **vt-engine:** use wraithterm which leverages GPU-native renderer instead of xterm.js


### Bug Fixes

* based on claude-code all TUI apps resize properly
* block view for xterm TUI apps
* **blocks:** keep ANSI colours across lines in command output
* **daemon:** backpressure for slow clients, 5x faster PTY output path
* omit unread event_tx-field
* resolve TUI issue
* **ui:** show output of cursor-moving commands like fastfetch as their final screen
* **ui:** terminal-like line height, bold-as-bright and no re-highlighting for coloured output
* use bun as mainproc instead of cottontail
* **win:** disable Mica system backdrop so the desktop blur shows through
* window drag via electrobun-webkit-app-region-drag class


### Performance

* **cli:** faster precmd hook (no git outside repos, no Windows PATH lookups on WSL)
* **daemon:** merge queued output per client; add perf + slow-client tests
* **ui:** ~2x faster coloured output parsing
* **ui:** cut memory of big outputs ~70%
* **ui:** finish blocks on the live view and swap in full output from the worker
* **ui:** incremental output parsing, no full re-parse when a block ends
* **ui:** memoize BlockView so only changed blocks re-render
* **ui:** parse output in a Web Worker, convert coloured lines lazily
* **ui:** virtualize ANSI output, cap block output, bench mode, resync on reconnect
