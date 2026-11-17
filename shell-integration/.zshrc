# daimon shell integration — runs the user's .zshrc, then overlays daimon hooks. See .zshenv.
_daimon_zdotdir="$ZDOTDIR"
ZDOTDIR="$DAIMON_USER_ZDOTDIR"
[[ -f "$ZDOTDIR/.zshrc" ]] && source "$ZDOTDIR/.zshrc"
source "${_daimon_zdotdir}/daimon.zsh"
if [[ -o login ]]; then
  # .zlogin still comes, from ZDOTDIR; it hands ZDOTDIR back to the user.
  ZDOTDIR="$_daimon_zdotdir"
else
  # Last startup file: leave the user's ZDOTDIR so nested shells load their own config.
  unset DAIMON_USER_ZDOTDIR
fi
unset _daimon_zdotdir
