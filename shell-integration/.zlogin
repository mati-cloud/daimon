# daimon shell integration — runs the user's .zlogin (login shells), the last startup
# file, and leaves the user's ZDOTDIR in place for nested shells. See .zshenv.
ZDOTDIR="$DAIMON_USER_ZDOTDIR"
unset DAIMON_USER_ZDOTDIR
[[ -f "$ZDOTDIR/.zlogin" ]] && source "$ZDOTDIR/.zlogin"
