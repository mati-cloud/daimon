# daimon shell integration — the daemon points ZDOTDIR here so zsh loads our hooks.
# zsh reads every startup file from ZDOTDIR, so each one here runs the user's own copy
# from their real ZDOTDIR (DAIMON_USER_ZDOTDIR, else $HOME) and then points ZDOTDIR back
# here for the next file. Sourced at top level, not in a function, so the user's
# `typeset`s stay global. Without these, ~/.zshenv and ~/.zprofile (where Homebrew puts
# `brew shellenv`) never run and PATH misses everything they add.
_daimon_zdotdir="$ZDOTDIR"
ZDOTDIR="${DAIMON_USER_ZDOTDIR:-$HOME}"
[[ -f "$ZDOTDIR/.zshenv" ]] && source "$ZDOTDIR/.zshenv"
# The user's .zshenv may move ZDOTDIR (e.g. to ~/.config/zsh): the later files live there.
DAIMON_USER_ZDOTDIR="$ZDOTDIR"
ZDOTDIR="$_daimon_zdotdir"
unset _daimon_zdotdir
