import { For, Show, createMemo } from "solid-js";
import { blockTop } from "../lib/layout";
import { regionLayout } from "../lib/render";
import type { Box, Meta, Panel, Region, Translation } from "../lib/types";

type Props = {
  meta: Meta;
  panels: Panel[];
  regions: Region[];
  translation: Translation | null;
  lang: string;
  loading?: boolean;
  imageUrl: string;
  showOriginal: boolean;
  fontsReady: boolean;
  overlaySrc: (r: Region) => string | undefined;
  hovered?: string | null;
  active?: string | null;
  onHover?: (rid: string | null) => void;
  onPick?: (rid: string) => void;
  boxRef?: (rid: string, el: HTMLElement) => void;
  ref?: (el: HTMLDivElement) => void;
};

export default function Strip(p: Props) {
  const W = () => p.meta.width;
  const H = () => p.meta.height;
  const interactive = () => !!p.onPick;
  const pct = (b: Box) => ({
    left: `${(b[0] / W()) * 100}%`,
    top: `${(b[1] / H()) * 100}%`,
    width: `${(b[2] / W()) * 100}%`,
    height: `${(b[3] / H()) * 100}%`,
  });
  const cq = (px: number) => `${(px / W()) * 100}cqw`;

  return (
    <div
      ref={p.ref}
      class="strip"
      classList={{ loading: p.loading, original: p.showOriginal }}
      style={{ "aspect-ratio": `${W()} / ${H()}` }}
    >
      <img class="strip-img" src={p.imageUrl} alt={p.meta.origName} draggable={false} />
      <Show when={interactive()}>
        <For each={p.panels}>{(panel) => <div class="panel-box" style={pct(panel.bbox)} />}</For>
      </Show>
      <For each={p.regions}>
        {(r) => {
          const fit = createMemo(() => (p.fontsReady && p.translation ? regionLayout(r, p.translation, p.lang) : null));
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
              <Show when={interactive()}>
              <div
                ref={(el) => p.boxRef?.(r.id, el)}
                class="region-box"
                classList={{
                  pending: !r.source,
                  read: !!r.source,
                  hovered: p.hovered === r.id,
                  active: p.active === r.id,
                  keep: !r.replace,
                }}
                style={pct(r.bubbleBox ?? r.textBox)}
                onMouseEnter={() => p.onHover?.(r.id)}
                onMouseLeave={() => p.onHover?.(null)}
                onClick={() => p.onPick?.(r.id)}
              >
                <span class="region-num">{r.order + 1}</span>
              </div>
              </Show>
            </>
          );
        }}
      </For>
    </div>
  );
}
