# daimon shell integration for fish.
#
# fish loads this from vendor_conf.d, before the user's config.fish, because the daemon
# put this directory first in XDG_DATA_DIRS. Hooks use fish events rather than
# fish_prompt/fish_preexec functions, so the user's prompt config can't replace them.

# Hand XDG_DATA_DIRS back so programs started from this shell don't see our directory.
if set -q DAIMON_USER_XDG_DATA_DIRS
    set -gx XDG_DATA_DIRS $DAIMON_USER_XDG_DATA_DIRS
    set -e DAIMON_USER_XDG_DATA_DIRS
else
    set -e XDG_DATA_DIRS
end

status is-interactive; or return

set -q DAIMON_BIN; or set -gx DAIMON_BIN daimon

# The app points DAIMON_BIN at its bundled CLI, which isn't on PATH — make
# `daimon <command>` work at the prompt too.
if test "$DAIMON_BIN" != daimon
    function daimon
        $DAIMON_BIN $argv
    end
end

# Force color in pipes — grep --color=auto suppresses color when stdout is not a TTY
function grep --wraps grep
    command grep --color=always $argv
end

set -g fish_greeting

set -g __daimon_status 0

function __daimon_postexec --on-event fish_postexec
    set -g __daimon_status $status
end

function __daimon_preexec --on-event fish_preexec
    $DAIMON_BIN preexec
end

function __daimon_precmd --on-event fish_prompt
    env DAIMON_EXIT_CODE=$__daimon_status $DAIMON_BIN precmd
end

# Minimal prompt — daimon renders its own chrome. Set at the first prompt, after
# config.fish has defined the user's.
function __daimon_minimal_prompt --on-event fish_prompt
    functions -e __daimon_minimal_prompt
    function fish_prompt
        echo -n ' '
    end
    function fish_right_prompt
    end
    function fish_mode_prompt
    end
end
