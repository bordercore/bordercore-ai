# TTS systemd units

Three user-scope units, one per engine:

| Unit                        | Engine     | Host         | Python                                           |
|-----------------------------|------------|--------------|--------------------------------------------------|
| `kokoro-tts.service`        | Kokoro     | wumpus       | `~/dev/bordercoreai/.venv/bin/python`            |
| `chatterbox-tts.service`    | Chatterbox | deepvirtual  | `~/dev/bordercoreai/tts/chatterbox_tts/.venv/bin/python` (isolated 3.11 venv) |
| `qwen3-tts.service`         | Qwen3      | deepvirtual  | `~/dev/envs/bordercoreai/bin/python`             |

All three listen on port 5001 and carry `Conflicts=` entries naming the other
two, so starting one automatically stops the others (mutex). Only one engine
runs at a time by design.

## Install

Edit the files in this directory on wumpus; watchman syncs them to
deepvirtual. On each host, symlink the relevant unit(s) into
`~/.config/systemd/user/` and reload systemd.

### wumpus (kokoro only)

```sh
mkdir -p ~/.config/systemd/user
# If an older kokoro-tts.service exists as a real file, delete it first:
rm -f ~/.config/systemd/user/kokoro-tts.service
ln -s ~/dev/bordercoreai/deploy/linux/systemd/kokoro-tts.service \
      ~/.config/systemd/user/kokoro-tts.service
systemctl --user daemon-reload
systemctl --user enable --now kokoro-tts
```

### deepvirtual (chatterbox + qwen3)

```sh
mkdir -p ~/.config/systemd/user
for unit in chatterbox-tts qwen3-tts; do
    ln -s ~/dev/bordercoreai/deploy/linux/systemd/$unit.service \
          ~/.config/systemd/user/$unit.service
done
systemctl --user daemon-reload
# Start whichever you want running; the other will be stopped automatically
# if/when you start it:
systemctl --user enable --now qwen3-tts
```

## Day-to-day use

```sh
# Swap engines (Conflicts= stops the current one automatically):
systemctl --user start qwen3-tts
systemctl --user start chatterbox-tts

# Check what's running:
systemctl --user status qwen3-tts

# Tail logs:
journalctl --user -u qwen3-tts -f

# Stop entirely:
systemctl --user stop qwen3-tts
```

## Notes

- The service files hardcode one Python path per engine because each engine has a
  canonical host. If you ever move chatterbox or qwen3 to wumpus, or kokoro to
  deepvirtual, point the `ExecStart` at whichever venv has the dependency
  installed on that host.
- Watchman syncs the files to both hosts, but you only symlink the units you
  actually want to run on each host. Extra files on disk are harmless.
- `Conflicts=` is an explicit mutex; the port 5001 binding is an implicit
  backstop — if somehow both tried to start, the second would fail on bind.
