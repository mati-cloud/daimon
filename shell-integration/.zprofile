# daimon shell integration — runs the user's .zprofile (login shells). See .zshenv.
_daimon_zdotdir="$ZDOTDIR"
ZDOTDIR="$DAIMON_USER_ZDOTDIR"
[[ -f "$ZDOTDIR/.zprofile" ]] && source "$ZDOTDIR/.zprofile"
ZDOTDIR="$_daimon_zdotdir"
unset _daimon_zdotdir
