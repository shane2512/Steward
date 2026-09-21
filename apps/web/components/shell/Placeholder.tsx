import { EmptyState } from '@/components/ui/primitives';

/** Screens owned by later Phase 7 tasks. They exist so the tab bar never 404s; they do nothing else. */
export function Placeholder({
  title,
  task,
  screen,
}: {
  title: string;
  task: string;
  screen: string;
}) {
  return (
    <EmptyState
      title={title}
      body={`This screen (${screen}) is built in task ${task}. Nothing here can move money.`}
    />
  );
}
