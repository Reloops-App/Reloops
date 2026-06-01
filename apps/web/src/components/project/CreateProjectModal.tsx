// components/project/CreateProjectModal.tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createProject } from "@/api/project";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workspaceId: string;
  onCreated?: () => void; // refresh hook
};

export function CreateProjectModal({
  open,
  onOpenChange,
  workspaceId,
  onCreated,
}: Props) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmed = name.trim();
    if (!trimmed) {
      setError("Please enter a project name.");
      return;
    }

    try {
      setSubmitting(true);

      // Create project
      const response = await createProject({ name: trimmed, workspaceId });
      if (!response.ok) {
        throw new Error("Failed to create project.");
      }
      const payload = await response.json().catch(() => null);
      const createdProjectId =
        payload &&
        typeof payload === "object" &&
        payload.data &&
        typeof payload.data.id === "string"
          ? payload.data.id
          : null;

      window.dispatchEvent(new CustomEvent("projects:changed", {
        detail: { workspaceId, projectId: createdProjectId, action: "created" },
      }));

      // optional: toast here
      // Clear form, close dialog, ask parent to refresh
      setName("");
      onOpenChange(false);
      onCreated?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create project.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create Project</DialogTitle>
            <DialogDescription className="mt-2 mb-2">
              Name your project. You can add assets and posts after creating it.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="project-name">Name</Label>
              <Input
                id="project-name"
                name="name"
                placeholder="Black Friday Launch"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
              {error && (
                <p className="text-sm text-destructive mt-1">{error}</p>
              )}
            </div>
          </div>

          <DialogFooter className="mt-4">
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={submitting}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
