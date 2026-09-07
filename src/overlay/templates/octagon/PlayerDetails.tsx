import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { OverlayPlayer } from "../../../shared/contracts.ts";
import type { OverlayMetadataField } from "../../../shared/overlay-metadata.ts";
import { cancelAnimations } from "./animations.ts";
import {
  fitMetadataChips,
  fitPlayerName,
  selectMetadataChips,
  type MetadataChip,
  type PlayerNameLayout,
} from "./readability.ts";

function observeSizing(elements: readonly HTMLElement[], measure: () => void): () => void {
  measure();
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
  for (const element of elements) {
    observer?.observe(element);
  }
  document.fonts?.addEventListener("loadingdone", measure);
  window.addEventListener("resize", measure);
  return () => {
    observer?.disconnect();
    document.fonts?.removeEventListener("loadingdone", measure);
    window.removeEventListener("resize", measure);
  };
}

export function PlayerName({
  name,
  prefix,
}: {
  readonly name: string;
  readonly prefix: string | null;
}): ReactNode {
  const rowRef = useRef<HTMLDivElement>(null);
  const nameProbeRef = useRef<HTMLElement>(null);
  const prefixProbeRef = useRef<HTMLSpanElement>(null);
  const [layout, setLayout] = useState<PlayerNameLayout>({
    fontSize: 31,
    prefixWidth: 0,
    ellipsized: false,
  });

  useLayoutEffect(() => {
    const row = rowRef.current;
    const nameProbe = nameProbeRef.current;
    const prefixProbe = prefixProbeRef.current;
    if (row === null || nameProbe === null || prefixProbe === null) {
      return;
    }
    return observeSizing([row, nameProbe, prefixProbe], () => {
      const next = fitPlayerName(row.clientWidth, (fontSize) => {
        nameProbe.style.fontSize = `${String(fontSize)}px`;
        // offsetWidth stays in the 1920px stage's coordinates when OBS scales it.
        return nameProbe.offsetWidth + 1;
      }, prefix?.trim() ? prefixProbe.offsetWidth + 1 : 0);
      setLayout((current) =>
        current.fontSize === next.fontSize &&
        current.prefixWidth === next.prefixWidth &&
        current.ellipsized === next.ellipsized ? current : next,
      );
    });
  }, [name, prefix]);

  return (
    <div className="player-name" ref={rowRef}>
      {layout.prefixWidth > 0 && (
        <span
          className="player-prefix"
          dir="auto"
          style={{ width: layout.prefixWidth }}
          title={prefix ?? undefined}
        >
          {prefix}
        </span>
      )}
      <strong
        dir="auto"
        style={{ fontSize: layout.fontSize, flexShrink: layout.ellipsized ? 1 : 0 }}
        title={name}
      >
        {name}
      </strong>
      <div className="player-name-probe" aria-hidden="true">
        <span className="player-prefix" ref={prefixProbeRef}>{prefix}</span>
        <strong ref={nameProbeRef}>{name}</strong>
      </div>
    </div>
  );
}

function ChipContent({ chip }: { readonly chip: MetadataChip }): ReactNode {
  return (
    <>
      {chip.label === null ? null : <b>{chip.label}</b>}
      {chip.flag === null ? null : (
        <span className="chip-flag" role="img" aria-label={chip.flagLabel ?? undefined}>
          {chip.flag}
        </span>
      )}
      <span className="chip-value" dir="auto">{chip.value}</span>
    </>
  );
}

function chipAnimationRef(element: HTMLSpanElement | null): (() => void) | undefined {
  return element === null ? undefined : () => { cancelAnimations(element.getAnimations()); };
}

function MetadataRow({ chips }: { readonly chips: readonly MetadataChip[] }): ReactNode {
  const rowRef = useRef<HTMLDivElement>(null);
  const probesRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState<readonly OverlayMetadataField[]>([]);

  useLayoutEffect(() => {
    const row = rowRef.current;
    const probes = probesRef.current;
    if (row === null || probes === null) {
      return;
    }
    const elements = Array.from(probes.children) as HTMLElement[];
    return observeSizing([row, ...elements], () => {
      const next = fitMetadataChips(
        chips,
        elements.map((element) => element.offsetWidth + 1),
        row.clientWidth,
      ).map((chip) => chip.field);
      setVisible((current) =>
        current.length === next.length && current.every((field, index) => field === next[index])
          ? current
          : next,
      );
    });
  }, [chips]);

  return (
    <div className="chips" ref={rowRef}>
      {chips.filter((chip) => visible.includes(chip.field)).map((chip) => (
        <span
          className="chip"
          data-field={chip.field}
          key={chip.field}
          ref={chipAnimationRef}
        >
          <ChipContent chip={chip} />
        </span>
      ))}
      <div className="metadata-probes" ref={probesRef} aria-hidden="true">
        {chips.map((chip) => (
          <span className="chip-probe" key={chip.field}><ChipContent chip={chip} /></span>
        ))}
      </div>
    </div>
  );
}

export function PlayerMetadata({
  player,
  fields,
}: {
  readonly player: OverlayPlayer | null;
  readonly fields: readonly OverlayMetadataField[];
}): ReactNode {
  const chips = selectMetadataChips(player, fields);
  return <MetadataRow key={JSON.stringify(chips)} chips={chips} />;
}
