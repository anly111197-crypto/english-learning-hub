// When two mistakes are merged (or a mistake takes over a deleted card's identity), the exercises that mention the old
// one must point at the new one: both the list `errorIds` and the `errorId` of every question. Pure.
export function remapExerciseErrorId(exercise, fromId, toId) {
  const errorIds = [...new Set((exercise.errorIds ?? []).map((id) => (id === fromId ? toId : id)))];
  const items = Array.isArray(exercise.items) ? exercise.items.map((it) => (it.errorId === fromId ? { ...it, errorId: toId } : it)) : exercise.items;
  return { ...exercise, errorIds, ...(items ? { items } : {}) };
}