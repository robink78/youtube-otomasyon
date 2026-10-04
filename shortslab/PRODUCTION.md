# Failure Reconstructed production runner

Scope: local narration → voice → visuals → MP4, with an opt-in YouTube upload
and every-3-days GitHub Actions scheduling. Visuals default to a **2.5D
cinematic camera** (zoom + diagonal drift via the render's zoompan path;
`efekt: sinematik`) and fall back to archival stills. Still open: real
depth-based parallax (needs an ML depth model), factual review and automatic
research selection.

A completed render is **never** auto-published. `run` never uploads. `publish`
is a separate, explicit command; it uploads as **private** by default and
refuses without credentials. See `../MALIYET-VE-YETKILER.md` for the account
permissions and costs of live operation.

```sh
python3 -m shortslab.production run first-documentary          # produce only, no upload
python3 -m shortslab.production publish first-documentary --verify   # dry run
python3 -m shortslab.production publish first-documentary      # upload PRIVATE (needs YT_* creds)
```

Requires Python 3.10+, Node 18+, `npm install`, ffmpeg and ffprobe on PATH.
macOS: `brew install ffmpeg`; Linux also needs DejaVu fonts; custom fonts can
be selected with VIDEO_FONT / VIDEO_FONT_BOLD. No credentials are stored in Git.

```sh
python3 -m shortslab.production init first-documentary --title "Documentary title" --brief "Verified facts and sources, narrative requirements" --script /absolute/path/narration.txt
python3 -m shortslab.production doctor first-documentary
python3 -m shortslab.production run first-documentary
python3 -m shortslab.production status first-documentary
```

Omit `--script` only if paid script generation is intended. That path requires
ANTHROPIC_API_KEY and ANTHROPIC_MODEL for a model available to your API account.
The runner does not assume a subscription covers API usage. Supplied narration
is preserved, allowing agent-authored, source-reviewed scripts without that API.
The existing visual collector uses remote archival searches; it is not a 3D
generator. Edge TTS also needs network access and can fail independently.

`--until script|voice|visuals|render` stops after a chosen stage. The same command
resumes completed stages only when input and output fingerprints still match.
Execution has a two-hour per-stage timeout. A failure halts subsequent stages.
Review errors locally by running the named JS adapter with the job name; raw
provider errors are intentionally not copied into saved status files.

State and all media live in ignored `uretim/<job>/`. An exclusive lock prevents
concurrent workers for the same job. After a hard crash, check no worker is alive
before removing that job's `.production.lock`. Never remove a live worker's lock.
Stages rerun as a whole after interruption; a failed paid script request may have
been billed, so inspect usage before retrying. Imported narration must be edited
directly to revise it; reruns never silently regenerate an existing script.

Review narration accuracy, asset attribution (`GORSEL-KAYNAKLARI.txt`), visual
relevance, subtitle alignment and actual video duration before publishing.
Render validation checks nonempty outputs plus video/audio streams, not editorial
quality. Unit tests use fake adapters; they do not prove remote providers work.
