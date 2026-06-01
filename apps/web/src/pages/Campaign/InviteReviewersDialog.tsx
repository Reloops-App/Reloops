"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
// ...existing code...
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { MailPlus, X } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName?: string | null;
  onSend: (emails: string[], message: string) => void;
};

const emailRegex = /^(?:[a-zA-Z0-9_'^&\+\-])+(?:\.(?:[a-zA-Z0-9_'^&\+\-])+)*@(?:(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,})$/;

export default function InviteReviewersDialog({ open, onOpenChange, projectName, onSend }: Props) {
  const [inputValue, setInputValue] = useState("");
  const [emails, setEmails] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [enableLink] = useState(true);

  const addEmailsFromText = (text: string) => {
    const parts = text
      .split(/[\s,;]+/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (!parts.length) return;
    const next = [...emails];
    for (const p of parts) {
      if (emailRegex.test(p) && !next.includes(p)) {
        next.push(p);
      }
    }
    setEmails(next);
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addEmailsFromText(inputValue);
      setInputValue("");
    } else if (e.key === "Backspace" && inputValue.length === 0 && emails.length > 0) {
      setEmails((prev) => prev.slice(0, prev.length - 1));
    }
  };

  const removeEmail = (email: string) => setEmails((prev) => prev.filter((e) => e !== email));

  const canSubmit = emails.length > 0 || enableLink;


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MailPlus className="h-5 w-5" /> Invite reviewers <Badge variant="secondary">Experimental</Badge>
          </DialogTitle>
          <DialogDescription>
            Bring reviewers into
            {" "}
            <span className="font-medium text-foreground">{projectName || "this project"}</span>
            . Add emails below
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="emails">Invite by email</Label>
            <div className="flex flex-wrap items-center gap-2 rounded-md border bg-background px-3 py-2">
              {emails.map((email) => (
                <Badge key={email} variant="secondary" className="flex items-center gap-1">
                  {email}
                  <button
                    aria-label={`Remove ${email}`}
                    className="ml-1 rounded hover:bg-muted/60"
                    onClick={() => removeEmail(email)}
                    type="button"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </Badge>
              ))}
              <Input
                id="emails"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={onInputKeyDown}
                onBlur={(e) => {
                  addEmailsFromText(e.target.value);
                  setInputValue("");
                }}
                placeholder="name@company.com, reviewer@example.com"
                className="border-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1 min-w-[180px]"
              />
            </div>
            <p className="text-xs text-muted-foreground">Press Enter or comma to add multiple emails.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="message">Add a message (optional)</Label>
            <Textarea
              id="message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Hi! I’d love your quick review on the assets in this project. Feel free to leave comments or approve when ready."
              className="min-h-[90px]"
            />
          </div>

          <Separator />
        </div>

        <DialogFooter className="mt-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!canSubmit}
            onClick={() => {
              // pass the collected emails and optional message back to the parent
              onSend(emails, message);
            }}
          >
            Send invites
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
