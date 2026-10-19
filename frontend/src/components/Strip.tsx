import { For, Show, createMemo } from "solid-js";
import { blockTop } from "../lib/layout";
import { regionLayout } from "../lib/render";
import type { Box, Region } from "../lib/types";
import type { Work } from "../lib/work";

type Props = {
  work: Work;
  imageUrl: string;
  showOriginal: boolean;
  fontsReady: boolean;
  hovered: string | null;
  active: string | null;
  onHover: (rid: string | null) => void;
  onPick: (rid: string) => void;
  overlaySrc: (r: Region) => string | undefined;
  boxRef: (rid: string, el: HTMLElement) => void;
};

export default function Strip(p: Props) {
  const s = p.work.state;
  const W = () => s.meta!.width;
  const H = () => s.meta!.height;
  const pct = (b: Box) => ({
    left: `${(b[0] / W()) * 100}%`,
    top: `${(b[1] / H()) * 100}%`,
    width: `${(b[2] / W()) * 100}%`,
    height: `${(b[3] / H()) * 100}%`,
  });
  const cq = (px: number) => `${(px / W()) * 100}cqw`;

  return (
    <div
      class="strip"
      classList={{ loading: s.phase !== "done", original: p.showOriginal }}
      style={{ "aspect-ratio": `${W()} / ${H()}` }}
    >
      <img class="strip-img" src={p.imageUrl} alt={s.meta!.origName} draggable={false} />
      <For each={s.panels}>{(panel) => <div class="panel-box" style={pct(panel.bbox)} />}</For>
      <For each={s.regions}>
        {(r) => {
          const fit = createMemo(() => (p.fontsReady && s.translation ? regionLayout(r, s.translation, p.work.lang()) : null));
          const showOverlay = () => !p.showOriginal && r.replace && r.overlayBox && p.overlaySrc(r);
          return (
            <>
              <Show when={showOverlay()}>
                <img class="overlay" src={p.overlaySrc(r)} style={pct(r.overlayBox!)} alt="" />
              </Show>
              <Show when={!p.showOriginal && fit()}>
                {(l) => (
                  <div
                    class="fit"
                    classList={{ overflow: !l().fits }}
                    style={{
                      ...pct([l().box[0], blockTop(l()), l().box[2], l().lines.length * l().lineHeight]),
                      "font-size": cq(l().fontSize),
                      "line-height": cq(l().lineHeight),
                      "text-align": l().align,
                    }}
                  >
                    <For each={l().lines}>{(line) => <div>{line || " "}</div>}</For>
                  </div>
                )}
              </Show>
              <div
                ref={(el) => p.boxRef(r.id, el)}
                class="region-box"
                classList={{
                  pending: !r.source,
                  read: !!r.source,
                  hovered: p.hovered === r.id,
                  active: p.active === r.id,
                  keep: !r.replace,
                }}
                style={pct(r.bubbleBox ?? r.textBox)}
                onMouseEnter={() => p.onHover(r.id)}
                onMouseLeave={() => p.onHover(null)}
                onClick={() => p.onPick(r.id)}
              >
                <span class="region-num">{r.order + 1}</span>
              </div>
            </>
          );
        }}
      </For>
    </div>
  );
}
