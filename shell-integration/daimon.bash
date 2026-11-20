# daimon shell integration for bash.
#
# The daemon starts `bash --posix` with ENV pointing here: in POSIX mode an interactive
# bash reads only $ENV, so this file runs instead of the usual startup files. It
# switches back to normal mode, runs the startup files a login shell would (so PATH
# matches Terminal.app/iTerm), then adds daimon's OSC 133 hooks. Everything is sourced
# at top level so the user's `declare`s stay global.

builtin set +o posix
if [[ -n "${DAIMON_USER_ENV-}" ]]; then
  ENV="$DAIMON_USER_ENV"
else
  builtin unset ENV
fi
builtin unset DAIMON_USER_ENV

# Login startup files, as bash(1) INVOCATION describes. ~/.bash_profile usually
# sources ~/.bashrc itself.
[[ -r /etc/profile ]] && builtin source /etc/profile
for _daimon_rc in ~/.bash_profile ~/.bash_login ~/.profile; do
  if [[ -r "$_daimon_rc" ]]; then
    builtin source "$_daimon_rc"
    break
  fi
done
builtin unset _daimon_rc

# A command typed with a leading space stays out of history (daimon's store skips it too).
[[ "${HISTCONTROL-}" == *ignorespace* || "${HISTCONTROL-}" == *ignoreboth* ]] || HISTCONTROL="${HISTCONTROL:+$HISTCONTROL:}ignorespace"

DAIMON_BIN="${DAIMON_BIN:-daimon}"

# The app points DAIMON_BIN at its bundled CLI, which isn't on PATH — make
# `daimon <command>` work at the prompt too.
if [[ "$DAIMON_BIN" != daimon ]]; then
  daimon() { "$DAIMON_BIN" "$@"; }
fi

# Load user opt-in modules (written by `daimon setup`; plain `export` lines)
[[ -f "$HOME/.config/daimon/config.zsh" ]] && builtin source "$HOME/.config/daimon/config.zsh"

# Force color in pipes — grep --color=auto suppresses color when stdout is not a TTY
alias grep='grep --color=always'

# PROMPT_COMMAND runs the user's prompt commands between these two: the first keeps the
# command's exit code (and hands it on as $?), the last emits the prompt marker.
_daimon_save_status() {
  _daimon_status=$?
  return $_daimon_status
}

_daimon_precmd() {
  DAIMON_EXIT_CODE=$_daimon_status "$DAIMON_BIN" precmd
  _daimon_armed=1
}

if (( BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 1) )); then
  # 5.1+: PROMPT_COMMAND may be an array, which a string assignment would truncate.
  PROMPT_COMMAND=(_daimon_save_status "${PROMPT_COMMAND[@]}" _daimon_precmd)
else
  PROMPT_COMMAND="_daimon_save_status"$'\n'"${PROMPT_COMMAND:-:}"$'\n'"_daimon_precmd"
fi

if (( BASH_VERSINFO[0] > 4 || (BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 4) )); then
  # PS0 is expanded after a command line is read, right before it runs.
  PS0='$("$DAIMON_BIN" preexec)'"${PS0-}"
elif [[ -z "$(builtin trap -p DEBUG)" ]]; then
  # bash < 4.4 (macOS /bin/bash) has no PS0: fire once on the first command after the
  # prompt. Skipped if the user already has a DEBUG trap (e.g. bash-preexec).
  _daimon_debug() {
    [[ -n "${_daimon_armed-}" ]] || return
    _daimon_armed=
    "$DAIMON_BIN" preexec
  }
  builtin trap '_daimon_debug' DEBUG
fi

# Minimal prompt — daimon renders its own chrome
PS1=' '
