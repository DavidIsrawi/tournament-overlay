import type {
  NormalizedEvent,
  NormalizedSet,
} from "../shared/contracts.ts";

export function mergeCachedPhaseGroups(
  event: NormalizedEvent,
  previous: NormalizedEvent | null,
): NormalizedEvent {
  if (previous?.id !== event.id || previous.providerId !== event.providerId) {
    return event;
  }
  return {
    ...event,
    phaseGroups: event.phaseGroups.map((group) => {
      const cached = previous.phaseGroups.find(
        (candidate) => candidate.id === group.id && candidate.setsLoaded,
      );
      return cached === undefined ? group : {
        ...group,
        setsLoaded: cached.setsLoaded,
        setsFetchedAt: cached.setsFetchedAt,
        sets: cached.sets,
      };
    }),
  };
}

export function resolvePhaseGroupSelection(
  event: NormalizedEvent,
  requested: string | null,
): string | null {
  if (requested !== null && event.phaseGroups.some((group) => group.id === requested)) {
    return requested;
  }
  return event.phaseGroups[0]?.id ?? null;
}

export function resolveSetSelection(
  event: NormalizedEvent,
  phaseGroupId: string | null,
  requested: string | null,
): string | null {
  const group = event.phaseGroups.find((candidate) => candidate.id === phaseGroupId);
  if (group === undefined) {
    return null;
  }
  if (!group.setsLoaded && requested !== null) {
    return requested;
  }
  if (requested !== null && group.sets.some((set) => set.id === requested)) {
    return requested;
  }
  return group.sets.find((set) => set.state === "active")?.id ?? group.sets[0]?.id ?? null;
}

export function replaceBracketSet(
  event: NormalizedEvent,
  updatedSet: NormalizedSet,
): NormalizedEvent {
  return {
    ...event,
    fetchedAt: new Date().toISOString(),
    phaseGroups: event.phaseGroups.map((group) =>
      group.id === updatedSet.phaseGroupId
        ? {
            ...group,
            sets: group.sets.map((set) => set.id === updatedSet.id ? updatedSet : set),
          }
        : group,
    ),
  };
}

export function replacePhaseGroupSets(
  event: NormalizedEvent,
  phaseGroupId: string,
  sets: readonly NormalizedSet[],
  setsLoaded: boolean,
): NormalizedEvent {
  const mergedSets = mergeCachedSetProfiles(event, phaseGroupId, sets);
  return {
    ...event,
    fetchedAt: new Date().toISOString(),
    phaseGroups: event.phaseGroups.map((group) =>
      group.id === phaseGroupId
        ? {
            ...group,
            setsLoaded,
            setsFetchedAt: setsLoaded ? new Date().toISOString() : group.setsFetchedAt,
            sets: mergedSets,
          }
        : group,
    ),
  };
}

function mergeCachedSetProfiles(
  event: NormalizedEvent,
  phaseGroupId: string,
  sets: readonly NormalizedSet[],
): readonly NormalizedSet[] {
  const cachedGroup = event.phaseGroups.find((group) => group.id === phaseGroupId);
  if (cachedGroup === undefined) {
    return sets;
  }

  return sets.map((set) => {
    const cachedSet = cachedGroup.sets.find((candidate) => candidate.id === set.id);
    if (cachedSet === undefined) {
      return set;
    }

    const mergeSlot = (index: 0 | 1): NormalizedSet["entrants"][number] => {
      const slot = set.entrants[index];
      const cachedSlot = cachedSet.entrants[index];
      if (slot === null || cachedSlot === null || slot.entrant.id !== cachedSlot.entrant.id) {
        return slot;
      }
      return {
        ...slot,
        entrant: {
          ...slot.entrant,
          prefix: slot.entrant.prefix ?? cachedSlot.entrant.prefix,
          pronouns: slot.entrant.pronouns ?? cachedSlot.entrant.pronouns,
          social: slot.entrant.social ?? cachedSlot.entrant.social,
          location: slot.entrant.location ?? cachedSlot.entrant.location,
        },
      };
    };

    return { ...set, entrants: [mergeSlot(0), mergeSlot(1)] };
  });
}
