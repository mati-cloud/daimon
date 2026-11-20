# daimon remote daimonify payload — eval'd into the remote shell over SSH (bash or zsh).
# No binary: emits the same OSC 133 markers daimon's local integration emits, so the
# daemon parses remote command boundaries exactly like local ones.
# Git info via `git` subprocess; silent when git is absent.
# Sourcing twice (the UI's retry) is harmless: hooks are added once.

_daimon_remote_mark() {
  local code=$1 esc="${PWD//\\/\\\\}" branch="" dirty=false
  if command git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    branch=$(command git symbolic-ref --short HEAD 2>/dev/null || command git rev-parse --short HEAD 2>/dev/null)
    command git diff --quiet >/dev/null 2>&1 && command git diff --cached --quiet >/dev/null 2>&1 || dirty=true
  fi
  # Hand-built JSON (no jq): escape backslash, then double-quote.
  esc="${esc//\"/\\\"}"
  local json="{\"pwd\":\"${esc}\",\"exitCode\":${code},\"ssh\":\"${_daimon_remote_id}\""
  if [[ -n "$branch" ]]; then
    branch="${branch//\\/\\\\}"; branch="${branch//\"/\\\"}"
    json="${json},\"gitBranch\":\"${branch}\",\"gitDirty\":${dirty}"
  fi
  # This folder's entries for path completion (daimon can't read this machine's disk): one
  # per line, folders ending in / (-L: links to folders too). base64, since a name can hold
  # anything JSON can't; capped so a huge folder doesn't slow every prompt.
  local entries
  entries=$(command ls -1ApL 2>/dev/null | command head -n 2000 | command base64 2>/dev/null | command tr -d '\n')
  json="${json},\"ls\":\"${entries}\""
  printf '\033]133;A%s}\033\\' "$json"
}

_daimon_remote_preexec() { printf '\033]133;C\033\\'; }

if [[ -z "${_daimon_remote_on-}" ]]; then
  _daimon_remote_on=1
  # user@host for daimon's SSH status item (JSON-safe: no quotes/backslashes in either).
  _daimon_remote_id="$(id -un 2>/dev/null || echo "$USER")@${HOSTNAME:-${HOST:-$(uname -n)}}"
  _daimon_remote_id="${_daimon_remote_id//[\\\"]/}"
  if [[ -n "${ZSH_VERSION-}" ]]; then
    _daimon_remote_precmd() { _daimon_remote_mark $?; }
    precmd_functions+=(_daimon_remote_precmd)
    preexec_functions+=(_daimon_remote_preexec)
    PROMPT=' '; RPROMPT=''
    unsetopt PROMPT_CR PROMPT_SP 2>/dev/null
  elif [[ -n "${BASH_VERSION-}" ]]; then
    # PROMPT_COMMAND: keep the command's status first, run the user's prompt commands
    # (with $? intact), emit the marker last.
    _daimon_remote_save() { _daimon_rs=$?; return $_daimon_rs; }
    _daimon_remote_precmd() { _daimon_remote_mark "$_daimon_rs"; _daimon_armed=1; }
    # ponytail: a 5.1+ PROMPT_COMMAND *array* only gets its first element wrapped; fine
    # unless a host's later elements print text.
    PROMPT_COMMAND="_daimon_remote_save"$'\n'"${PROMPT_COMMAND:-:}"$'\n'"_daimon_remote_precmd"
    if (( BASH_VERSINFO[0] > 4 || (BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 4) )); then
      PS0='\e]133;C\e\\'   # prompt escapes: ESC ]133;C ESC \
    else
      # bash < 4.4 has no PS0: the first command after a prompt fires preexec.
      _daimon_remote_debug() {
        [[ -n "${_daimon_armed-}" ]] || return
        _daimon_armed=
        _daimon_remote_preexec
      }
      trap '_daimon_remote_debug' DEBUG
    fi
    PS1=' '
  fi
fi
