# Changelog

## [0.8.0](https://github.com/mati-cloud/daimon/compare/v0.7.0...v0.8.0) (2026-11-19)


### Features

* **ui:** keyboard block navigation in mod+shift mode ([570cbd4](https://github.com/mati-cloud/daimon/commit/570cbd450e9f318039895f0881ef0e6c403a5a8b))

## [0.7.0](https://github.com/mati-cloud/daimon/compare/v0.6.1...v0.7.0) (2026-11-18)


### Features

* "Check for updates" in the command palette ([3bb8399](https://github.com/mati-cloud/daimon/commit/3bb83998d2e210df877e09384889b0e48da60578))
* **linux:** bundle CEF for WebGPU, custom frameless window and sharp TUI zoom ([746fe03](https://github.com/mati-cloud/daimon/commit/746fe0376342d75a43fa5715f33c860d6e9c97c5))
* **linux:** detect compositor blur and gate glass settings until see-through windows take keyboard input ([58bc498](https://github.com/mati-cloud/daimon/commit/58bc498f93f8ba7501c9d59a8fdaef47ee2fff42))
* **ui:** show update progress and failures in the sidebar ([ef9ced7](https://github.com/mati-cloud/daimon/commit/ef9ced7aa61f24293210504b94a361b701a590f2))


### Bug Fixes

* **linux:** disable background blur, compositors offer no per-app blur radius ([3007f70](https://github.com/mati-cloud/daimon/commit/3007f70e6155a00eb5ea139e439bad13d0cb3e10))
* **ui:** fall back to xterm's DOM renderer when WebGPU is missing ([ab66d9d](https://github.com/mati-cloud/daimon/commit/ab66d9d3f47d40db7d7f27ffd4171e9255feffff))

## [0.6.1](https://github.com/mati-cloud/daimon/compare/v0.6.0...v0.6.1) (2026-11-18)


### Bug Fixes

* **daemon:** detach into a new session so a terminal can't kill it ([ded2a4b](https://github.com/mati-cloud/daimon/commit/ded2a4b2bc28e00caaf8f56bf06446bb7888bd88))
* **daemon:** detach into a new session so a terminal can't kill it ([b662f5c](https://github.com/mati-cloud/daimon/commit/b662f5c9fdff45ea66f083de9e0f8be71df9fcb1))

## [0.6.0](https://github.com/mati-cloud/daimon/compare/v0.5.1...v0.6.0) (2026-11-18)


### Features

* auto-update from GitHub releases ([1e30fa6](https://github.com/mati-cloud/daimon/commit/1e30fa64a11aaee32d9438c257f2d71e8ae0a94c))
* auto-update from GitHub releases ([a8d0899](https://github.com/mati-cloud/daimon/commit/a8d08998ac397cb0465223f761a7cea599db1b0e))

## [0.5.1](https://github.com/mati-cloud/daimon/compare/v0.5.0...v0.5.1) (2026-11-18)


### Bug Fixes

* **ui:** strip foreign OSC sequences from plain command output ([8d77abc](https://github.com/mati-cloud/daimon/commit/8d77abcaafff5d0f4f60a909787861cfbd092eb0))
* **ui:** strip foreign OSC sequences from plain command output ([09cafdb](https://github.com/mati-cloud/daimon/commit/09cafdbf96d21601224f738a50ac211547b26d66))

## [0.5.0](https://github.com/mati-cloud/daimon/compare/v0.4.0...v0.5.0) (2026-11-18)


### Features

* 60 FPS + fix flicker on custom TUI-apps on i.e. git integration ([16d2f45](https://github.com/mati-cloud/daimon/commit/16d2f45525c75caf442933aa21cb3da4c1778ca5))
* double-click title bar to zoom/maximize window ([aecd652](https://github.com/mati-cloud/daimon/commit/aecd652d0f3b011921dfe9291631c651e89f600f))
* **git-branches:** custom output for git branch command ([b28cb47](https://github.com/mati-cloud/daimon/commit/b28cb475df7725e3852343e2bce48ce6eab7463b))
* icon ([7b8e137](https://github.com/mati-cloud/daimon/commit/7b8e1373a975f7c7870f43061fb99a308d00823c))
* icons and more ([3a8e6cf](https://github.com/mati-cloud/daimon/commit/3a8e6cf41ff5df2db9daeca635e60b069e85a79b))
* link-preview based on OG ([4555be6](https://github.com/mati-cloud/daimon/commit/4555be66f3dd55f1ccb20bf52f405003f47fbc50))
* move kubernetes and openstack into plugins ([e8742ae](https://github.com/mati-cloud/daimon/commit/e8742ae3135515152c27e2ddad2306354e421f80))
* native titlebar and some fixes ([9321be3](https://github.com/mati-cloud/daimon/commit/9321be3096b97f9bbe27a7a95d15d96dc4331ebe))
* plugin API ([832afd0](https://github.com/mati-cloud/daimon/commit/832afd0c37e85838fd2d480805cbd567012b5ed3))
* see-through window with real desktop blur on Windows ([3c66dec](https://github.com/mati-cloud/daimon/commit/3c66dec1c65bddeafa22d43c02d768db092c39e4))
* ship native installers instead of tarballs ([a214bc6](https://github.com/mati-cloud/daimon/commit/a214bc673882cbf90e03f7ea7dc7a75cb7ef2c94))
* support bash and fish shells ([6d2cfcc](https://github.com/mati-cloud/daimon/commit/6d2cfcc469ea7aba4fee0254794d24839c05c9f9))
* true native macOS window drag via performWindowDragWithEvent: ([3516078](https://github.com/mati-cloud/daimon/commit/35160782d66bda908024552f7c2e2cb20a483f1e))
* **vt-engine:** use wraithterm which leverages GPU-native renderer instead of xterm.js ([05d8f96](https://github.com/mati-cloud/daimon/commit/05d8f96277b065da2a3a539b6c3ddac26a29c0ef))


### Bug Fixes

* based on claude-code all TUI apps resize properly ([d85906e](https://github.com/mati-cloud/daimon/commit/d85906e0bf7fad0e7f0a654f065e7a1a745b4fb4))
* block view for xterm TUI apps ([15b5430](https://github.com/mati-cloud/daimon/commit/15b5430d2190a4c90792428acd6c16d339c948e4))
* **blocks:** keep ANSI colours across lines in command output ([ec91476](https://github.com/mati-cloud/daimon/commit/ec91476206ee0e83c863caec0663e6611ec24de1))
* **daemon:** backpressure for slow clients, 5x faster PTY output path ([2f57544](https://github.com/mati-cloud/daimon/commit/2f575446df57a5c602e7207b7d3bfb84d51c57e5))
* **daemon:** build PATH from OS standards and the login shell ([3678a61](https://github.com/mati-cloud/daimon/commit/3678a61bf654015621b5e5759534a390b3fbb998))
* **daemon:** ship shell integration with release builds ([c11f114](https://github.com/mati-cloud/daimon/commit/c11f1147d460e920fb098bba877944e05b672e98))
* omit unread event_tx-field ([0525fae](https://github.com/mati-cloud/daimon/commit/0525fae7156de7b4c9522a6e76149af2b30c8fe8))
* resolve TUI issue ([dd97630](https://github.com/mati-cloud/daimon/commit/dd976300914f55204ed7f8a193fd8a7be924bb06))
* **ui:** show output of cursor-moving commands like fastfetch as their final screen ([caff42a](https://github.com/mati-cloud/daimon/commit/caff42a93896390abe04a3c7606dfcfa1e647c22))
* **ui:** terminal-like line height, bold-as-bright and no re-highlighting for coloured output ([125ec4f](https://github.com/mati-cloud/daimon/commit/125ec4f719cdeebfc833d08643b1961290304a21))
* use bun as mainproc instead of cottontail ([f116295](https://github.com/mati-cloud/daimon/commit/f1162952c7435306f0b959a63330b1cd0b9d3010))
* **win:** disable Mica system backdrop so the desktop blur shows through ([70eb9c9](https://github.com/mati-cloud/daimon/commit/70eb9c93bc2b26544cb047dd623154d77e2273f9))
* window drag via electrobun-webkit-app-region-drag class ([b068c7e](https://github.com/mati-cloud/daimon/commit/b068c7e605762d2d8759b11c5efec8a034601172))


### Performance

* **cli:** faster precmd hook (no git outside repos, no Windows PATH lookups on WSL) ([d7c6005](https://github.com/mati-cloud/daimon/commit/d7c60057950266ec9cd426947e5c8952d3e53db7))
* **daemon:** merge queued output per client; add perf + slow-client tests ([f398dde](https://github.com/mati-cloud/daimon/commit/f398dde4958dca8753490e45cde23fec25999f96))
* **ui:** ~2x faster coloured output parsing ([7e999a2](https://github.com/mati-cloud/daimon/commit/7e999a2884d55cd511f463001e238227e0aa9798))
* **ui:** cut memory of big outputs ~70% ([139467a](https://github.com/mati-cloud/daimon/commit/139467acf584af5f01a26a9542d55446aab58c38))
* **ui:** finish blocks on the live view and swap in full output from the worker ([fb9d6d6](https://github.com/mati-cloud/daimon/commit/fb9d6d6d57d556bf5916ddfd2155e271d4d59970))
* **ui:** incremental output parsing, no full re-parse when a block ends ([71c92d9](https://github.com/mati-cloud/daimon/commit/71c92d917c273ffef4c33605a2822b966583e509))
* **ui:** memoize BlockView so only changed blocks re-render ([cd6602e](https://github.com/mati-cloud/daimon/commit/cd6602e5072d3d303bbc93443a254572a2b2c907))
* **ui:** parse output in a Web Worker, convert coloured lines lazily ([00049c8](https://github.com/mati-cloud/daimon/commit/00049c8acce91f35083442f62015d276cc2c96e3))
* **ui:** virtualize ANSI output, cap block output, bench mode, resync on reconnect ([ad93476](https://github.com/mati-cloud/daimon/commit/ad93476bf0deb142a48953b57cd7c7106240a9d0))

## [0.4.0](https://github.com/mati-cloud/daimon/compare/v0.3.0...v0.4.0) (2026-11-17)


### Features

* support bash and fish shells

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
