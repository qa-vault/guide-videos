#!/usr/bin/env bash
# Encodes a recorded guide into its final MP4. Everything is read from and written to the
# guide's own folder, videos/<id>/:
#   capture/            input: frames/, frames.txt, narration.vtt, chapters.txt, recording.json, cursor + ripple art
#   narration/          input: synthesised narration clips referenced from recording.json
#   <id>.mp4            H.264 (High 5.1, constant frame rate, crf 17) + AAC narration + mov_text subtitles
#   <id>.vtt, <id>.json narration cues; cues + chapters + pointer log + card texts
#
# The cursor is not in the frames: the recorder logs the pointer path and compose.mjs draws it
# per output frame, so its motion is smooth regardless of the capture rate.
# Colour: frames are RGB PNG. They are converted to BT.709 YUV 4:2:0, TV range, through
# an RGB intermediate (format=gbrp) with accurate rounding, and the transfer
# characteristic is tagged sRGB (iec61966-2-1). This combination renders the same in
# colour-managed players (macOS QuickTime/Safari) and in players that assume sRGB
# (Windows, VLC, Chrome). RANGE=pc switches to full range.
#
# Usage: ./build.sh <guide-id>
set -euo pipefail
cd "$(dirname "$0")"
id="$1"
videos_dir="$(node -e 'import("./config.mjs").then((m) => console.log(m.loadConfig().dirs.videos))')"
guide="$videos_dir/$id"; cap="$guide/capture"; range="${RANGE:-tv}"
[ -f "$cap/recording.json" ] || { echo "no recording in $cap — run: node record.mjs $id" >&2; exit 1; }
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

fps="$(node -e 'const j=require(require("path").resolve(process.argv[1])); if (!j.fps) { console.error("recording.json has no fps"); process.exit(1); } console.log(j.fps)' "$cap/recording.json")"
# Picture: constant frame rate, cursor + click ripples composited from the pointer log, BT.709.
# -reinit_filter 0: captured frames can change size mid-stream; a graph re-init would drop the
# single-image cursor/ripple inputs, so the graph is kept and compose.mjs scales every frame.
extra=(); while IFS= read -r f; do [ -n "$f" ] && extra+=(-i "$f"); done < <(node compose.mjs "$cap/recording.json" "$tmp" "$range")
ffmpeg -v error -y -reinit_filter 0 -f concat -safe 0 -i "$cap/frames.txt" ${extra[@]+"${extra[@]}"} \
  -filter_complex_script "$tmp/filter.txt" -map "[v]" -r "$fps" \
  -c:v libx264 -crf 17 -preset slow -profile:v high -level 5.1 -tag:v avc1 \
  -x264-params "keyint=$((fps * 2)):min-keyint=$fps:bframes=2" \
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range "$range" \
  -movflags +faststart "$tmp/video.mp4"
# Retag the transfer characteristic to sRGB in the bitstream VUI and the container; no re-encode.
ffmpeg -v error -y -i "$tmp/video.mp4" -map 0 -c copy \
  -bsf:v "h264_metadata=colour_primaries=1:transfer_characteristics=13:matrix_coefficients=1" \
  -color_primaries bt709 -color_trc iec61966-2-1 -colorspace bt709 -color_range "$range" \
  -movflags +faststart "$tmp/tagged.mp4"
# Narration: place every synthesised line at its cue start and mix into one AAC track.
audio_args=(); audio_map=()
if node -e 'const j=require(require("path").resolve(process.argv[1]));process.exit(j.cues.some(c=>c.voice)?0:1)' "$cap/recording.json"; then
  node - "$cap/recording.json" "$tmp/audio.txt" <<'NODE'
const [jsonFile, out] = process.argv.slice(2);
const j = require(require("path").resolve(jsonFile));
const cues = j.cues.filter((c) => c.voice);
const inputs = cues.map((c) => `-i\n${c.voice}`).join("\n");
const chain = cues.map((c, i) => `[${i + 2}:a]adelay=${c.start}|${c.start}[a${i}]`).join(";")
  + ";" + cues.map((_, i) => `[a${i}]`).join("") + `amix=inputs=${cues.length}:normalize=0:dropout_transition=0,apad[aout]`;
require("fs").writeFileSync(out, inputs + "\n---\n" + chain + "\n");
NODE
  while IFS= read -r line; do [ "$line" = "---" ] && break; audio_args+=("$line"); done < "$tmp/audio.txt"
  filter="$(sed -n '/^---$/{n;p;}' "$tmp/audio.txt")"
  duration="$(node -e 'console.log((require(require("path").resolve(process.argv[1])).durationMs/1000).toFixed(3))' "$cap/recording.json")"
  audio_args+=(-filter_complex "$filter" -c:a aac -b:a 160k -t "$duration"); audio_map=(-map "[aout]")
fi
ffmpeg -v error -y -i "$tmp/tagged.mp4" -i "$cap/narration.vtt" ${audio_args[@]+"${audio_args[@]}"} -map 0:v ${audio_map[@]+"${audio_map[@]}"} -map 1:s -c:v copy \
  -c:s mov_text -metadata:s:s:0 language=eng -metadata:s:s:0 title=Narration -movflags +faststart "$guide/$id.mp4"
cp "$cap/narration.vtt" "$guide/$id.vtt"
cp "$cap/recording.json" "$guide/$id.json"
echo "== $guide/$id.mp4"
ffprobe -v error -show_entries stream=index,codec_type,codec_name,width,height,avg_frame_rate,color_range,color_transfer:format=duration -of csv=p=0 "$guide/$id.mp4"
