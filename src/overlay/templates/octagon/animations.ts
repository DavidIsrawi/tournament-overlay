import type { OverlaySide } from "../../../shared/overlay-events.ts";

export const WHEEL_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
export const SCORE_WHEEL_EASE = "cubic-bezier(0.34, 1.56, 0.64, 1)";

const SET_EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
const SIDES: readonly OverlaySide[] = ["port", "starboard"];

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function animateElement(
  element: Element | null,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
  cancelExisting = true,
): Animation | null {
  if (element === null) {
    return null;
  }
  if (cancelExisting) {
    for (const animation of element.getAnimations()) {
      animation.cancel();
    }
  }
  return element.animate(keyframes, options);
}

export function cancelAnimations(animations: readonly Animation[]): void {
  for (const animation of animations) {
    animation.cancel();
  }
}

export function runSetEntrance(
  root: HTMLElement,
  initial: boolean,
): Animation[] {
  if (prefersReducedMotion()) {
    return [];
  }

  const animations: Animation[] = [];
  const add = (animation: Animation | null): void => {
    if (animation !== null) {
      animations.push(animation);
    }
  };
  const fadeOptions = {
    duration: 200,
    easing: SET_EASE,
    fill: "backwards" as const,
  };

  add(
    animateElement(
      root.querySelector(".player-port"),
      [
        { opacity: 0, transform: "translateX(-20px)" },
        { opacity: 1, transform: "translateX(0)" },
      ],
      fadeOptions,
    ),
  );
  add(
    animateElement(
      root.querySelector(".player-starboard"),
      [
        { opacity: 0, transform: "translateX(20px)" },
        { opacity: 1, transform: "translateX(0)" },
      ],
      fadeOptions,
    ),
  );

  for (const selector of [
    ".match-plate",
    ".event-plate",
    ...(initial ? [".helm-rig"] : [".helm-rig", ".tentacle"]),
  ]) {
    add(
      animateElement(
        root.querySelector(selector),
        [{ opacity: 0 }, { opacity: 1 }],
        fadeOptions,
      ),
    );
  }

  for (const side of SIDES) {
    const chips = Array.from(
      root.querySelectorAll(`.player-${side} .chip`),
    ).reverse();
    for (const [index, chip] of chips.entries()) {
      add(
        animateElement(
          chip,
          [{ opacity: 0 }, { opacity: 1 }],
          {
            duration: 200,
            delay: index * 50,
            fill: "backwards",
          },
        ),
      );
    }
  }

  if (initial) {
    add(
      animateElement(
        root.querySelector(".helm-rig"),
        [
          {
            transform: "translateX(-50%) rotate(-3deg) scale(0.94)",
          },
          { transform: "translateX(-50%) rotate(0) scale(1)" },
        ],
        {
          duration: 450,
          easing: SCORE_WHEEL_EASE,
          fill: "backwards",
        },
        false,
      ),
    );
    add(
      animateElement(
        root.querySelector(".tentacle"),
        [
          { opacity: 0, transform: "translateX(-18px)" },
          { opacity: 1, transform: "translateX(0)" },
        ],
        {
          duration: 500,
          delay: 80,
          easing: SET_EASE,
          fill: "backwards",
        },
      ),
    );
  }

  return animations;
}
