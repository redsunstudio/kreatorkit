'use client';

import { useState } from 'react';
import { Loader2, MessageSquare, Shield } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

type Role = 'ADMIN' | 'COMMENTATOR';
type AccessValue = Role | 'NONE';

interface WorkspaceRow {
  id: string;
  name: string;
  ownerId: string;
  owner: { id: string; name: string | null; email: string | null };
}

interface Membership {
  id: string;
  workspaceId: string;
  role: Role;
}

interface WorkspaceAccessClientProps {
  userId: string;
  workspaces: WorkspaceRow[];
  initialMemberships: Membership[];
}

export function WorkspaceAccessClient({
  userId,
  workspaces,
  initialMemberships,
}: WorkspaceAccessClientProps) {
  const [access, setAccess] = useState<Record<string, AccessValue>>(() => {
    const map: Record<string, AccessValue> = {};
    for (const workspace of workspaces) map[workspace.id] = 'NONE';
    for (const membership of initialMemberships) map[membership.workspaceId] = membership.role;
    return map;
  });
  const [pendingWorkspaceId, setPendingWorkspaceId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const handleChange = async (workspaceId: string, value: AccessValue) => {
    const previous = access[workspaceId];
    setPendingWorkspaceId(workspaceId);
    setError('');
    setAccess((current) => ({ ...current, [workspaceId]: value }));

    try {
      const url = `/api/admin/users/${userId}/workspace-access/${workspaceId}`;
      const res =
        value === 'NONE'
          ? await fetch(url, { method: 'DELETE' })
          : await fetch(url, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ role: value }),
            });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Failed to update workspace access');
        setAccess((current) => ({ ...current, [workspaceId]: previous }));
        return;
      }
    } catch {
      setError('Failed to update workspace access');
      setAccess((current) => ({ ...current, [workspaceId]: previous }));
    } finally {
      setPendingWorkspaceId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Workspace Access</CardTitle>
        <CardDescription>
          Add or remove this user from any workspace, with a role per workspace. Direct — no invite
          email is sent.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
        )}

        {workspaces.map((workspace) => {
          const isOwner = workspace.ownerId === userId;
          const value = access[workspace.id];
          const isPending = pendingWorkspaceId === workspace.id;

          return (
            <div
              key={workspace.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-0 p-3 rounded-lg border"
            >
              <div>
                <p className="text-sm font-medium">{workspace.name}</p>
                <p className="text-xs text-muted-foreground">
                  Owner: {workspace.owner.name || workspace.owner.email || 'Unknown'}
                </p>
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                {isOwner ? (
                  <Badge variant="secondary">Owner</Badge>
                ) : (
                  <>
                    {isPending && (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    )}
                    <Select
                      value={value}
                      disabled={isPending}
                      onValueChange={(v) => handleChange(workspace.id, v as AccessValue)}
                    >
                      <SelectTrigger className="w-full sm:w-40 h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NONE">No access</SelectItem>
                        <SelectItem value="ADMIN">
                          <span className="flex items-center gap-1.5">
                            <Shield className="h-3.5 w-3.5" />
                            Admin
                          </span>
                        </SelectItem>
                        <SelectItem value="COMMENTATOR">
                          <span className="flex items-center gap-1.5">
                            <MessageSquare className="h-3.5 w-3.5" />
                            Commentator
                          </span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </>
                )}
              </div>
            </div>
          );
        })}

        {workspaces.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">No workspaces exist.</p>
        )}
      </CardContent>
    </Card>
  );
}
