# Changelog

## [0.14.5](https://github.com/mati-cloud/daimon/compare/v0.14.4...v0.14.5) (2026-11-25)


### Bug Fixes

* **ui:** add word-break styling to virtual lines ([380ca48](https://github.com/mati-cloud/daimon/commit/380ca480ec735d2d5ccfb9079856f4c029d93797))

## [0.14.4](https://github.com/mati-cloud/daimon/compare/v0.14.3...v0.14.4) (2026-11-24)


### Bug Fixes

* **ui:** skip key-value label lines in table detection ([5111a99](https://github.com/mati-cloud/daimon/commit/5111a9928bb6fd34dfe61973ff4c5096ea249097))

## [0.14.3](https://github.com/mati-cloud/daimon/compare/v0.14.2...v0.14.3) (2026-11-24)


### Bug Fixes

* **ui:** hide block-ring pseudo-element during capture ([f8bba36](https://github.com/mati-cloud/daimon/commit/f8bba361795648e95ceb94f186e7ebc5321a385d))
* **ui:** prevent history dropdown on complete commands ([dbbc182](https://github.com/mati-cloud/daimon/commit/dbbc182d4256bb48a7ab222705fbf0812413db18))

## [0.14.2](https://github.com/mati-cloud/daimon/compare/v0.14.1...v0.14.2) (2026-11-23)


### Bug Fixes

* **ui,daemon,shell:** handle alt-screen apps and kitty keyboard protocol ([62504da](https://github.com/mati-cloud/daimon/commit/62504daaee9ebe26caaa799dc30f4d370077d249))

## [0.14.1](https://github.com/mati-cloud/daimon/compare/v0.14.0...v0.14.1) (2026-11-23)


### Bug Fixes

* **shell:** skip sigint cleanup when alt-screen app is active ([e336391](https://github.com/mati-cloud/daimon/commit/e336391944ea21c59944cb0ce0045f1c3a7c4b8e))

## [0.14.0](https://github.com/mati-cloud/daimon/compare/v0.13.0...v0.14.0) (2026-11-23)


### ⚠ BREAKING CHANGES

* **rpc:** request() now returns payload only (null on transport failure); callers needing the ok flag use requestEnvelope()

### Features

* **ui,daemon,app:** switch to UNIX socket auth and HTTP asset server ([cd6c17a](https://github.com/mati-cloud/daimon/commit/cd6c17ae6d697304a3d6f644b80eb717616d79eb))


### Bug Fixes

* **rpc:** distinguish daemon unreachable from null response ([05835fc](https://github.com/mati-cloud/daimon/commit/05835fc26d8794490b211d12bc965e592febb029))

## [0.13.0](https://github.com/mati-cloud/daimon/compare/v0.12.0...v0.13.0) (2026-11-23)


### Features

* **ui,plugins,git:** register plugin settings panels and display author email in logs ([5fb2a73](https://github.com/mati-cloud/daimon/commit/5fb2a73fbae4a63c6a7b8f8ff4cff974fa6bb099))

## [0.12.0](https://github.com/mati-cloud/daimon/compare/v0.11.0...v0.12.0) (2026-11-23)


### Features

* bulk actions for multi-block selection in block mode ([a7c1cc6](https://github.com/mati-cloud/daimon/commit/a7c1cc6ef131cae1333bc8f75032bcbf699a746a))
* **complete:** support dynamic subcommands from completer commands ([c7dd376](https://github.com/mati-cloud/daimon/commit/c7dd376822c94500b683211b7b6bb43738fb23f8))
* editable keymaps with live conflict detection and blocking banner ([c04aba5](https://github.com/mati-cloud/daimon/commit/c04aba58707573c5965cbd2c2488c3551af14c98))
* implement userland-controlled specs for autocompletion-engine ([149ae46](https://github.com/mati-cloud/daimon/commit/149ae46753e4df0b2106b39ed4a83bd0eee1e720))
* keymap capture overlay covers full modal including sidebar ([28e8fcd](https://github.com/mati-cloud/daimon/commit/28e8fcde1040a3430bbf7d722b99177a81305d21))
* keymap capture overlay with key visualization, suppress globals when any modal open ([82381c7](https://github.com/mati-cloud/daimon/commit/82381c777bc97dd13ed2b48b263e577d65e5cb89))
* keymap registry with conflict detection and Keymaps settings tab ([df97a7c](https://github.com/mati-cloud/daimon/commit/df97a7c8a0f46fb202bf1eae38c4f87b6264f5f3))
* per-block find bar, block pinning, multi-block selection in super-shift mode ([451b058](https://github.com/mati-cloud/daimon/commit/451b05867c3ac44787c7c242a3e52d2178105905))
* **plugins:** expose onCommandStart with command text ([41d4fd3](https://github.com/mati-cloud/daimon/commit/41d4fd34fc16a4539fc6cf52dd091689429a4a4b))
* redesign keymap capture overlay with premium full-panel UI ([4454af4](https://github.com/mati-cloud/daimon/commit/4454af4f825ab20cdcab363d38ba13802c051596))
* **shell:** spawn new tabs in the active tab's directory ([2405e70](https://github.com/mati-cloud/daimon/commit/2405e70b9887b1a24c5cc9d8c5e467ae1da7c781))
* show live zoom level badge while magnifying ([9f20d9a](https://github.com/mati-cloud/daimon/commit/9f20d9ae8529fc9f1e0335be978796e91457b001))
* suppress OS shortcuts during keymap capture via CGEventTap ([6b96010](https://github.com/mati-cloud/daimon/commit/6b960102409d22cb3ffdcebe63720226bab72ae3))
* **ui:** add block screenshot to clipboard with ⌘⇧S ([167d664](https://github.com/mati-cloud/daimon/commit/167d664a1076dccdf99a0a586b264330a975adca))
* **ui:** screenshot whole terminal with ⌘⇧S when no block selected ([f6cbda6](https://github.com/mati-cloud/daimon/commit/f6cbda6243a338c4adbc85f43faaf7aef86bf583))
* **ui:** show git status line counts next to file name ([a0b9527](https://github.com/mati-cloud/daimon/commit/a0b95272a5ec9eff53836853f727f4dbcecb9caf))
* warn on OS-intercepted combos in keymap capture overlay ([bba1123](https://github.com/mati-cloud/daimon/commit/bba1123da9d4252d4323ebd9445737d850c9bc51))


### Bug Fixes

* allow key events through keyLock when target has data-key-lock-allow ([2e1c85a](https://github.com/mati-cloud/daimon/commit/2e1c85a9dca6aefd0ab96f98ec6097252c2a75af))
* block plugin keybindings during keymap capture via setKeyLock ([5cac067](https://github.com/mati-cloud/daimon/commit/5cac067aec55d0c1c0b99d7d5547a67b0a6a957e))
* cancel sleep/commands immediately on single Ctrl+C ([45bf08c](https://github.com/mati-cloud/daimon/commit/45bf08cb1c4375bdaa6901f1c9e57cb8b0a23909))
* cap composer textarea at 6 lines, scroll on overflow ([a6d6d42](https://github.com/mati-cloud/daimon/commit/a6d6d42e23d8daab7b298d67d31d346e6a654ecd))
* **complete:** accumulate parent flags during subcommand tree walk and complete flag values ([dd2e780](https://github.com/mati-cloud/daimon/commit/dd2e780cf1d99135db266dc894611e9721b5aefd))
* defer AX permission request until window is visible ([f3fe9e6](https://github.com/mati-cloud/daimon/commit/f3fe9e671b0bb42701043ac65bf1e7b3c2dcb77f))
* key capture uses document capture phase + tabIndex focus so keys always register ([4a9fd70](https://github.com/mati-cloud/daimon/commit/4a9fd70a7edc0cb4a28d3ac1d7a3fd96c088e406))
* modal non-dismissable during keymap capture, only Cancel exits ([c577d8d](https://github.com/mati-cloud/daimon/commit/c577d8dd74f2cdb439ad0b4f5066620dc95e4e3a))
* **notifications:** ask for permission on the first user gesture ([86a6d83](https://github.com/mati-cloud/daimon/commit/86a6d830507ef3c38671bfe795d6143dfa60d922))
* pass HOME to plugin exec so tools like kubectl find ~/.kube/config ([b842fb4](https://github.com/mati-cloud/daimon/commit/b842fb45782b06c1210de45b9fcc9c798bd4c8e3))
* resolve keymap bindings, extend plugin API ([8926144](https://github.com/mati-cloud/daimon/commit/892614473902c889f7ca603ef50c4732af76e22b))
* **shell:** cancel block 600ms after Ctrl+C output when precmd is suppressed by zsh ([32ab050](https://github.com/mati-cloud/daimon/commit/32ab050342e621333fac9941b44f97b83818921b))
* **shell:** drop at most one startup prompt in onContext, allow post-command resolve without commandStarted ([f5fbf4e](https://github.com/mati-cloud/daimon/commit/f5fbf4ec4a7a21e447d37ff9b2fde2a6445f5b7d))
* **shell:** move sigint cleanup timer above commandStarted gate ([fcd4368](https://github.com/mati-cloud/daimon/commit/fcd4368f528df13600a2be4757e0fa95f6b1644f))
* **shell:** pass cancelled:true from sigint timer, drop startup prompts via recentInterrupt guard ([45fa53c](https://github.com/mati-cloud/daimon/commit/45fa53ca862a39096ec2476bd412daa6ce1124c9))
* **shell:** resolve block immediately on SIGINT exit (zsh suppresses precmd after Ctrl+C) ([e32973f](https://github.com/mati-cloud/daimon/commit/e32973f36f876839e0f896edf963b3e8806c5f38))
* **tui:** only trust alt-screen/mouse sequences for zero-output TUI detection ([64355c1](https://github.com/mati-cloud/daimon/commit/64355c1aae173362f6cff7a257bc7be90b7e985c))
* **tui:** prevent false TUI detection on Ctrl+C prompt redraw ([a440fe0](https://github.com/mati-cloud/daimon/commit/a440fe020a853f06cf5a45254cfacf19e86ebf42))
* **tui:** restore keyboard focus after xterm drag-select, suppress shell echo, always patch deps on dev start ([85ba107](https://github.com/mati-cloud/daimon/commit/85ba107d1b3bc759da4ca5ea32276fa62947ef38))
* **tui:** suppress TUI detection 1s after Ctrl+C, drop bracketed-paste from TUI signals ([db880cf](https://github.com/mati-cloud/daimon/commit/db880cf2ab5f7f1d0e95ae3103e6262f8fea1e32))
* **ui:** fix screenshot truncation and remove block copy icon ([86ec9d3](https://github.com/mati-cloud/daimon/commit/86ec9d3fb3447030818032d368428518f895b1f2))
* **ui:** remove broken css var fallback for terminal font size ([9d4bb6d](https://github.com/mati-cloud/daimon/commit/9d4bb6d1b752efd0b0bc4ae96ada4833fa3f7a2f))
* **ui:** run multi-line input as one block per line ([a1a5c49](https://github.com/mati-cloud/daimon/commit/a1a5c497ad3e41ec2eeceed6b84282e806b48432))
* **ui:** smooth header block transitions and preserve state during scroll ([2def642](https://github.com/mati-cloud/daimon/commit/2def642a038a6efe475deb7f3f1ac271199fb2c5))
* use CFStringCreateWithCString for run loop mode instead of broken global symbol read ([bec51f7](https://github.com/mati-cloud/daimon/commit/bec51f7055211eb7331baf5e17e0d707034fe0a4))
* use pure-C dylib callback to avoid JSCallback deadlock on main CFRunLoop ([d72d24f](https://github.com/mati-cloud/daimon/commit/d72d24fd1030ea6f911b8002d80854b19a680ecb))

## [0.11.0](https://github.com/mati-cloud/daimon/compare/v0.10.0...v0.11.0) (2026-11-20)


### Features

* **app:** close a session when its shell exits ([509337a](https://github.com/mati-cloud/daimon/commit/509337a00a830a50942fc5fcb17351d0870a57ab))
* **app:** set a minimum window size ([6435dc4](https://github.com/mati-cloud/daimon/commit/6435dc49040ee578d3ece5279f8bc17fc091b629))
* **complete:** complete ~, hidden and remote ssh paths ([d893fb4](https://github.com/mati-cloud/daimon/commit/d893fb4656a5436b4052b3f8b85bafe12b55cd83))
* **composer:** shell-like path completion and Home/End keys ([fb228b7](https://github.com/mati-cloud/daimon/commit/fb228b7a955e8cd09f46de5367b897f8226de849))
* **landing:** show and reopen SSH places as user@host:/path ([8c24a0e](https://github.com/mati-cloud/daimon/commit/8c24a0edcb47541150b6808c06373a6715683ab4))
* **magnify:** pinch zoom and modifier-drag pan on all platforms ([bdbb8a7](https://github.com/mati-cloud/daimon/commit/bdbb8a7710e29375ee936616d69789f4ab956a87))
* **plugins:** require admin approval before loading plugins ([6028bfc](https://github.com/mati-cloud/daimon/commit/6028bfc8d3a3a1032e2dd83f803f664e1c0b3fbe))
* **security:** restrict daemon websocket to app origin and add CSP ([64de87f](https://github.com/mati-cloud/daimon/commit/64de87f01c0967a6e5f850fd5bdd0d8a38cd3482))
* **ssh:** daimonify bash and zsh remotes and show ssh status ([a0e2208](https://github.com/mati-cloud/daimon/commit/a0e22083857bba672354ead363206aaa3992c4f0))
* **tui:** route keys, clipboard, title and bell through full-screen programs ([e324673](https://github.com/mati-cloud/daimon/commit/e324673b767e19bc9d30d4c6b14e9c895c6498fa))
* **tui:** ship Noto symbol, math and emoji fallback fonts ([9a98fb0](https://github.com/mati-cloud/daimon/commit/9a98fb01c5581d40cb3f0fa2a922b576f208a610))
* **ui:** make the sidebar resizable ([a2eb376](https://github.com/mati-cloud/daimon/commit/a2eb3765bb9b7650c294eff66fcfb32e0d57272c))
* **ui:** theme toasts to match the app ([dc7b83c](https://github.com/mati-cloud/daimon/commit/dc7b83c97d29fa2847689ac6d36a97b89a5fa2f3))


### Bug Fixes

* **daemon:** drop shell output printed after the prompt mark ([01460c4](https://github.com/mati-cloud/daimon/commit/01460c497b533f13fc6e383a8451a4fc0a10c666))
* **daemon:** restrict daemon info folder permissions ([6809c98](https://github.com/mati-cloud/daimon/commit/6809c98632b246cd31bd20c1ac16dba05ea3f2c3))
* **parse:** strip every CSI sequence from block output ([910c340](https://github.com/mati-cloud/daimon/commit/910c340fcb6192f05844417334d4cab5978bd027))
* **plugins:** load plugins from a pre-approval daemon instead of crashing ([f80267a](https://github.com/mati-cloud/daimon/commit/f80267ad213520829949713f73e7e477957e0859))
* **security:** harden daemon, link previews, history and logs ([30009fa](https://github.com/mati-cloud/daimon/commit/30009faad1757f729dbea603cf848673f11e1811))
* **security:** proxy remote images, prune hourly, guard deceptive links ([8351b37](https://github.com/mati-cloud/daimon/commit/8351b3755d103a930978c27e75d971b5fee88f37))
* **ssh:** wait for a raw tty before daimonifying and leave ssh mode on exit ([1f8690e](https://github.com/mati-cloud/daimon/commit/1f8690e077873257d8200b09fb01cfb12978e362))
* **ui:** use the runtime home folder for ~ paths ([9dc141b](https://github.com/mati-cloud/daimon/commit/9dc141b062b8f3ad24e51c010069cc51a0d223b7))

## [0.10.0](https://github.com/mati-cloud/daimon/compare/v0.9.0...v0.10.0) (2026-11-19)


### Features

* **plugins:** add onCommandComplete event ([4cf71dd](https://github.com/mati-cloud/daimon/commit/4cf71dd2ea4517fd3d69760b63416f3190af8ea8))


### Bug Fixes

* **tui:** exact-chord keydown dispatch, drop capture phase to restore Cmd+V paste ([a0893d6](https://github.com/mati-cloud/daimon/commit/a0893d66dbcd1685a76aeef1e5ca01dd6a8f126c))

## [0.9.0](https://github.com/mati-cloud/daimon/compare/v0.8.0...v0.9.0) (2026-11-19)


### Features

* "Check for updates" in the command palette ([3bb8399](https://github.com/mati-cloud/daimon/commit/3bb83998d2e210df877e09384889b0e48da60578))
* 60 FPS + fix flicker on custom TUI-apps on i.e. git integration ([16d2f45](https://github.com/mati-cloud/daimon/commit/16d2f45525c75caf442933aa21cb3da4c1778ca5))
* auto-update from GitHub releases ([0a480db](https://github.com/mati-cloud/daimon/commit/0a480dbd95fff7a7e6ab5ade19e16582ed264d3f))
* auto-update from GitHub releases ([aeb0441](https://github.com/mati-cloud/daimon/commit/aeb04419775a66d280ace7d5b411fcaa431469ad))
* double-click title bar to zoom/maximize window ([aecd652](https://github.com/mati-cloud/daimon/commit/aecd652d0f3b011921dfe9291631c651e89f600f))
* **git-branches:** custom output for git branch command ([b28cb47](https://github.com/mati-cloud/daimon/commit/b28cb475df7725e3852343e2bce48ce6eab7463b))
* icon ([7b8e137](https://github.com/mati-cloud/daimon/commit/7b8e1373a975f7c7870f43061fb99a308d00823c))
* icons and more ([f08a8bd](https://github.com/mati-cloud/daimon/commit/f08a8bda86946ada1c0a9bb3d0e2b3ee7be92a76))
* link-preview based on OG ([991ea8e](https://github.com/mati-cloud/daimon/commit/991ea8ecb89ea16fd1c8f2ad653766b38cb604bf))
* **linux:** bundle CEF for WebGPU, custom frameless window and sharp TUI zoom ([746fe03](https://github.com/mati-cloud/daimon/commit/746fe0376342d75a43fa5715f33c860d6e9c97c5))
* **linux:** detect compositor blur and gate glass settings until see-through windows take keyboard input ([58bc498](https://github.com/mati-cloud/daimon/commit/58bc498f93f8ba7501c9d59a8fdaef47ee2fff42))
* move kubernetes and openstack into plugins ([499262c](https://github.com/mati-cloud/daimon/commit/499262c431d0f9be4e11a908fc01b07f4e0e07b3))
* native titlebar and some fixes ([9321be3](https://github.com/mati-cloud/daimon/commit/9321be3096b97f9bbe27a7a95d15d96dc4331ebe))
* plugin API ([e0f497a](https://github.com/mati-cloud/daimon/commit/e0f497a92ef1533a0fd6d9ecd97c3a8178ea7bcd))
* see-through window with real desktop blur on Windows ([3c66dec](https://github.com/mati-cloud/daimon/commit/3c66dec1c65bddeafa22d43c02d768db092c39e4))
* ship native installers instead of tarballs ([36a815b](https://github.com/mati-cloud/daimon/commit/36a815b271e981e58deed112208ba64b946cb7a7))
* support bash and fish shells ([d449def](https://github.com/mati-cloud/daimon/commit/d449def789474db3a373c9a762c16a63826dbf7b))
* true native macOS window drag via performWindowDragWithEvent: ([3516078](https://github.com/mati-cloud/daimon/commit/35160782d66bda908024552f7c2e2cb20a483f1e))
* **ui:** keyboard block navigation in mod+shift mode ([570cbd4](https://github.com/mati-cloud/daimon/commit/570cbd450e9f318039895f0881ef0e6c403a5a8b))
* **ui:** show update progress and failures in the sidebar ([ef9ced7](https://github.com/mati-cloud/daimon/commit/ef9ced7aa61f24293210504b94a361b701a590f2))
* **vt-engine:** use wraithterm which leverages GPU-native renderer instead of xterm.js ([05d8f96](https://github.com/mati-cloud/daimon/commit/05d8f96277b065da2a3a539b6c3ddac26a29c0ef))


### Bug Fixes

* based on claude-code all TUI apps resize properly ([d85906e](https://github.com/mati-cloud/daimon/commit/d85906e0bf7fad0e7f0a654f065e7a1a745b4fb4))
* block view for xterm TUI apps ([15b5430](https://github.com/mati-cloud/daimon/commit/15b5430d2190a4c90792428acd6c16d339c948e4))
* **blocks:** keep ANSI colours across lines in command output ([4a74d50](https://github.com/mati-cloud/daimon/commit/4a74d50b0ac29798c9dee4bb9791dad7d3121c99))
* **daemon:** backpressure for slow clients, 5x faster PTY output path ([be6bfc2](https://github.com/mati-cloud/daimon/commit/be6bfc2447e068256b01a76d5df0ed8ff3a3c0af))
* **daemon:** build PATH from OS standards and the login shell ([939b03c](https://github.com/mati-cloud/daimon/commit/939b03cc7d6fd4d898ead6e85042a3e173a756da))
* **daemon:** detach into a new session so a terminal can't kill it ([9ed8f33](https://github.com/mati-cloud/daimon/commit/9ed8f33af6eac62098ec6364f4b81df835b103b1))
* **daemon:** detach into a new session so a terminal can't kill it ([9907421](https://github.com/mati-cloud/daimon/commit/9907421ce40629c82179df05dbbabc3c5ead0ce4))
* **daemon:** ship shell integration with release builds ([f0fd4eb](https://github.com/mati-cloud/daimon/commit/f0fd4ebd09f43e0695bd34df03028bf0def7621a))
* **linux:** disable background blur, compositors offer no per-app blur radius ([3007f70](https://github.com/mati-cloud/daimon/commit/3007f70e6155a00eb5ea139e439bad13d0cb3e10))
* omit unread event_tx-field ([191e8d0](https://github.com/mati-cloud/daimon/commit/191e8d0fe985d83f5945a4317604a181e799cf0f))
* resolve TUI issue ([d21c940](https://github.com/mati-cloud/daimon/commit/d21c940ab3d2cd209729005925cf539416a13678))
* **tui:** forward paste events to active terminal with bracketed-paste support ([f55e117](https://github.com/mati-cloud/daimon/commit/f55e117a00976ee5d3d6aa36ab234989d72ef5be))
* **ui:** fall back to xterm's DOM renderer when WebGPU is missing ([ab66d9d](https://github.com/mati-cloud/daimon/commit/ab66d9d3f47d40db7d7f27ffd4171e9255feffff))
* **ui:** show output of cursor-moving commands like fastfetch as their final screen ([c994bcc](https://github.com/mati-cloud/daimon/commit/c994bcc6b9c8bf18861e57cc9c2df9345818be5e))
* **ui:** strip foreign OSC sequences from plain command output ([c4debc3](https://github.com/mati-cloud/daimon/commit/c4debc396c47d00d70dc112c2ec8cdc58930945b))
* **ui:** strip foreign OSC sequences from plain command output ([1358b0e](https://github.com/mati-cloud/daimon/commit/1358b0e452fd3b3304647ccea3021091fe2584e5))
* **ui:** terminal-like line height, bold-as-bright and no re-highlighting for coloured output ([f64ceef](https://github.com/mati-cloud/daimon/commit/f64ceefcee2e7e67d18e72e26d1e7c20d3e12a9e))
* use bun as mainproc instead of cottontail ([f116295](https://github.com/mati-cloud/daimon/commit/f1162952c7435306f0b959a63330b1cd0b9d3010))
* **win:** disable Mica system backdrop so the desktop blur shows through ([658c263](https://github.com/mati-cloud/daimon/commit/658c263d1b10372ba4217a28f3d53ffb5b8da136))
* window drag via electrobun-webkit-app-region-drag class ([b068c7e](https://github.com/mati-cloud/daimon/commit/b068c7e605762d2d8759b11c5efec8a034601172))


### Performance

* **cli:** faster precmd hook (no git outside repos, no Windows PATH lookups on WSL) ([b678a4e](https://github.com/mati-cloud/daimon/commit/b678a4e9991c07c24d68a4f1e2820324abb093a9))
* **daemon:** merge queued output per client; add perf + slow-client tests ([6081ac6](https://github.com/mati-cloud/daimon/commit/6081ac691be77ae992d50d505137b1921bda005f))
* **ui:** ~2x faster coloured output parsing ([7bcb493](https://github.com/mati-cloud/daimon/commit/7bcb493f1cfdfbd969e849374e7c752d9d07a2ac))
* **ui:** cut memory of big outputs ~70% ([6df203c](https://github.com/mati-cloud/daimon/commit/6df203c343c07d4ba3fd500f23921e7098dbfdbc))
* **ui:** finish blocks on the live view and swap in full output from the worker ([75baba8](https://github.com/mati-cloud/daimon/commit/75baba8ea12e2fa5fc65c21ab29edc1de1643991))
* **ui:** incremental output parsing, no full re-parse when a block ends ([852bb51](https://github.com/mati-cloud/daimon/commit/852bb511216c36d9fa7485623faad7f3c3b3cc22))
* **ui:** memoize BlockView so only changed blocks re-render ([f70063c](https://github.com/mati-cloud/daimon/commit/f70063ce4d018116e9ce3911c78cea753d52d78e))
* **ui:** parse output in a Web Worker, convert coloured lines lazily ([3bddbc5](https://github.com/mati-cloud/daimon/commit/3bddbc5fb39b2c2449aa33b7caf090d0884df299))
* **ui:** virtualize ANSI output, cap block output, bench mode, resync on reconnect ([9b70539](https://github.com/mati-cloud/daimon/commit/9b70539d0d4d60f3abfa40ae251e30d0955d97f8))

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
