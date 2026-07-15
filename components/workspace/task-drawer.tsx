'use client';

import { useState, useEffect, useRef, useTransition, useCallback } from 'react';
import { CheckSquare, Plus, Trash2, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

interface Task {
  id: string;
  text: string;
  done: boolean;
  sortOrder: number;
}

interface TaskDrawerProps {
  workspaceId: string;
  accent?: string | null;
}

export function TaskDrawer({ workspaceId, accent }: TaskDrawerProps) {
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newText, setNewText] = useState('');
  const [loading, setLoading] = useState(false);
  const [, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/tasks`);
      if (res.ok) {
        const { data } = await res.json();
        setTasks(data.tasks ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (open) fetchTasks();
  }, [open, fetchTasks]);

  async function addTask() {
    const text = newText.trim();
    if (!text) return;
    const optimistic: Task = {
      id: `tmp-${Date.now()}`,
      text,
      done: false,
      sortOrder: tasks.length,
    };
    setTasks((prev) => [...prev, optimistic]);
    setNewText('');
    inputRef.current?.focus();

    const res = await fetch(`/api/workspaces/${workspaceId}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (res.ok) {
      const { data } = await res.json();
      setTasks((prev) => prev.map((t) => (t.id === optimistic.id ? data.task : t)));
    } else {
      setTasks((prev) => prev.filter((t) => t.id !== optimistic.id));
    }
  }

  async function toggleDone(task: Task) {
    const next = !task.done;
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, done: next } : t)));
    startTransition(async () => {
      await fetch(`/api/workspaces/${workspaceId}/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ done: next }),
      });
    });
  }

  async function deleteTask(taskId: string) {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    await fetch(`/api/workspaces/${workspaceId}/tasks/${taskId}`, { method: 'DELETE' });
  }

  const pending = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="flex-1 sm:flex-none relative">
          <CheckSquare className="h-4 w-4 mr-2" />
          Tasks
          {pending.length > 0 && (
            <span
              className="ml-1.5 inline-flex items-center justify-center rounded-full h-4 w-4 text-[10px] font-semibold text-white"
              style={{ background: accent || 'hsl(var(--primary))' }}
            >
              {pending.length}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col gap-0 p-0">
        <SheetHeader className="px-5 pt-5 pb-4 border-b border-border/50">
          <SheetTitle className="flex items-center gap-2">
            <CheckSquare className="h-4 w-4" style={{ color: accent || undefined }} />
            Tasks
          </SheetTitle>
        </SheetHeader>

        {/* Add input */}
        <div className="px-5 py-3 border-b border-border/50">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              addTask();
            }}
            className="flex gap-2"
          >
            <input
              ref={inputRef}
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              placeholder="Add a task…"
              maxLength={500}
              className="flex-1 bg-muted/40 border border-border/50 rounded-md px-3 py-1.5 text-sm outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 placeholder:text-muted-foreground/60 transition"
            />
            <Button
              type="submit"
              size="sm"
              disabled={!newText.trim()}
              style={accent ? { background: accent, borderColor: accent } : undefined}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </form>
        </div>

        {/* Task list */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-1">
          {loading && (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Loading…
            </div>
          )}

          {!loading && tasks.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-8">
              No tasks yet — add one above.
            </p>
          )}

          {!loading &&
            pending.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                accent={accent}
                onToggle={toggleDone}
                onDelete={deleteTask}
              />
            ))}

          {!loading && done.length > 0 && (
            <>
              <p className="text-xs text-muted-foreground/60 uppercase tracking-wide pt-3 pb-1">
                Done ({done.length})
              </p>
              {done.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  accent={accent}
                  onToggle={toggleDone}
                  onDelete={deleteTask}
                />
              ))}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function TaskRow({
  task,
  accent,
  onToggle,
  onDelete,
}: {
  task: Task;
  accent?: string | null;
  onToggle: (t: Task) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="group flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/40 transition-colors">
      <button
        onClick={() => onToggle(task)}
        className="mt-0.5 flex-none w-4 h-4 rounded border border-border/70 flex items-center justify-center transition-colors hover:border-primary/60"
        style={
          task.done
            ? { background: accent || 'hsl(var(--primary))', borderColor: accent || undefined }
            : undefined
        }
        aria-label={task.done ? 'Mark incomplete' : 'Mark complete'}
      >
        {task.done && <X className="h-2.5 w-2.5 text-white" />}
      </button>
      <span
        className={cn(
          'flex-1 text-sm leading-snug break-words',
          task.done && 'line-through text-muted-foreground/50'
        )}
      >
        {task.text}
      </span>
      <button
        onClick={() => onDelete(task.id)}
        className="flex-none opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/50 hover:text-destructive"
        aria-label="Delete task"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
