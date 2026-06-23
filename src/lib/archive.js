// Pure helpers for the personal task-archive feature. Archive state is a
// per-user junction (task_archives); useTasks.fetchTasks tags each enriched
// task with a boolean `archived`. Keeping the active/archived split here (out
// of the page components) makes it unit-testable.

export function splitByArchived(tasks) {
  const active = []
  const archived = []
  for (const t of tasks || []) {
    if (t && t.archived) archived.push(t)
    else active.push(t)
  }
  return { active, archived }
}
