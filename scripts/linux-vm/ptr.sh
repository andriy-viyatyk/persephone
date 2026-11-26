#!/bin/bash
# Real pointer and keyboard input in the VM's GNOME session, through ydotool (uinput), for window-chrome and
# drag-and-drop checks that need input the compositor treats as the user's. Run in the VM:
#   ptr.sh move X Y | click X Y | dclick X Y | drag X1 Y1 X2 Y2 | key <code>:1 <code>:0 ...
# X/Y are screen pixels; GNOME pointer acceleration must be flat (vm.ps1 input-setup does that).
# Drags move in relative steps: Wayland drag sources ignore a single absolute jump.
# Key codes are Linux input codes: 29 Ctrl, 42 Shift, 56 Alt, 125 Super, 1 Esc, 105/106 Left/Right, 47 V.
export YDOTOOL_SOCKET=/run/user/1000/.ydotool_socket
if [ ! -S "$YDOTOOL_SOCKET" ]; then
    sudo systemd-run --unit=ydotoold /usr/bin/ydotoold --socket-path="$YDOTOOL_SOCKET" --socket-own=1000:1000 >/dev/null
    sleep 1
fi
mv() { ydotool mousemove --absolute -x "$1" -y "$2" >/dev/null; }
case "$1" in
  move) mv "$2" "$3";;
  click) mv "$2" "$3"; sleep 0.2; ydotool click 0xC0 >/dev/null;;
  dclick) mv "$2" "$3"; sleep 0.2; ydotool click -r 2 -D 80 0xC0 >/dev/null;;
  drag) mv "$2" "$3"; sleep 0.3; ydotool click 0x40 >/dev/null; sleep 0.3
        dx=$(( ($4 - $2) / 20 )); dy=$(( ($5 - $3) / 20 ))
        for i in $(seq 20); do ydotool mousemove -x $dx -y $dy >/dev/null; sleep 0.03; done
        sleep 0.3; ydotool click 0x80 >/dev/null;;
  key) shift; ydotool key "$@" >/dev/null;;
  *) echo "usage: ptr.sh move|click|dclick|drag|key ..." >&2; exit 2;;
esac
