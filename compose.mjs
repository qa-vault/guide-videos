// Builds the ffmpeg filter graph that turns captured frames into the final picture:
// constant frame rate, the cursor composited along the logged pointer path (smooth at
// any capture rate), click ripples, and the BT.709 conversion. Used by build.sh.
//
//   node compose.mjs <videos/<id>/capture/recording.json> <out-dir> <range>
// Writes <out-dir>/filter.txt (for -filter_complex_script) and prints the extra -i inputs, one per line.
// Guaranteed: input order and indices, cursor/ripple positions and timing, the [v] output label, fps/scale defaults.
// Not guaranteed: intermediate label names, line separators, scaler flags, number formatting of times.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Builds the filter graph for a recording. Returns { filter, inputs }: the filter_complex script text
 *  and the extra image inputs (in the order they must follow the frames input). */
export function compose(j, captureDir, range = "tv") {
  const fps = j.fps ?? 30, S = j.scale ?? 1;
  const P = j.pointer;
  const RIPPLE_STEPS = 5, RIPPLE_STEP_S = 0.08, RIPPLE_HALF = 24; // ripple artwork is 48x48 CSS px

  const inputs = [];
  // Some captured frames come back at a multiple of the target size (Chrome renders the
  // blurred chapter card at a higher scale); normalise every frame to the video size first.
  const chain = [`[0:v]fps=${fps},scale=${j.size.width}:${j.size.height}:flags=lanczos,format=gbrp[b]`];
  let cur = "b";
  if (P) {
    // Cursor: one overlay whose x/y are piecewise expressions of t built from the move log
    // (eased in-out inside a move, resting position between moves).
    inputs.push(path.join(captureDir, "cursor.png"));
    const [hx, hy] = P.hotspot ?? [0, 0];
    const px = (v, h) => Math.round((v - h) * S);
    const expr = (axis) => {
      const h = axis === 0 ? hx : hy;
      const centre = [j.size.width / 2, j.size.height / 2];
      let rest = px((P.moves[0]?.from ?? centre)[axis], h);
      let e = "";
      const parts = [];
      for (const m of P.moves) {
        const a = px(m.from[axis], h), b = px(m.to[axis], h);
        const t0 = (m.t0 / 1000).toFixed(3), t1 = (m.t1 / 1000).toFixed(3);
        // st(0, progress 0..1); st(1, eased); value = a + (b - a) * eased
        const eased = `st(0,(t-${t0})/(${t1}-${t0}))*0+if(lt(ld(0),0.5),4*ld(0)*ld(0)*ld(0),1-pow(-2*ld(0)+2,3)/2)`;
        parts.push({ t0, t1, before: rest, during: `${a}+(${b}-${a})*(${eased})` });
        rest = b;
      }
      // Build nested ifs from the last move backwards.
      e = String(rest);
      for (let i = parts.length - 1; i >= 0; i--) {
        const q = parts[i];
        e = `if(lt(t,${q.t0}),${q.before},if(lt(t,${q.t1}),${q.during},${e}))`;
      }
      return e;
    };
    chain.push(`[${cur}][1:v]overlay@cur=x='${expr(0)}':y='${expr(1)}':eval=frame:format=gbrp[c]`);
    cur = "c";
    // Click ripples: a short sequence of ring images, each enabled for one step.
    for (let k = 0; k < RIPPLE_STEPS; k++) inputs.push(path.join(captureDir, `ripple${k}.png`));
    P.clicks.forEach((c, i) => {
      for (let k = 0; k < RIPPLE_STEPS; k++) {
        const t0 = c.t / 1000 + k * RIPPLE_STEP_S, t1 = t0 + RIPPLE_STEP_S;
        const next = `r${i}_${k}`;
        chain.push(`[${cur}][${2 + k}:v]overlay=x=${Math.round((c.x - RIPPLE_HALF) * S)}:y=${Math.round((c.y - RIPPLE_HALF) * S)}:format=gbrp:enable='between(t,${t0.toFixed(3)},${t1.toFixed(3)})'[${next}]`);
        cur = next;
      }
    });
  }
  chain.push(`[${cur}]scale=out_color_matrix=bt709:out_range=${range}:flags=lanczos+accurate_rnd+full_chroma_int,format=yuv420p[v]`);
  return { filter: chain.join(";\n") + "\n", inputs };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [jsonFile, outDir, range = "tv"] = process.argv.slice(2);
  const { filter, inputs } = compose(JSON.parse(readFileSync(jsonFile, "utf8")), path.dirname(jsonFile), range);
  writeFileSync(path.join(outDir, "filter.txt"), filter);
  console.log(inputs.join("\n"));
}
