import { useState, useRef, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { toast } from "sonner";
import { getSessionToken, supabase } from "@/lib/supabaseClient";

interface InviteOrgMemberDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    organizationId: string | null;
    onInviteSent?: (data: any) => void;
}

export function InviteOrgMemberDialog({
    open,
    onOpenChange,
    organizationId,
    onInviteSent,
}: InviteOrgMemberDialogProps) {
    const [email, setEmail] = useState("");
    const [role, setRole] = useState<"member" | "admin">("member");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const emailRef = useRef<HTMLInputElement>(null);

    // Focus input when dialog opens
    useEffect(() => {
        if (open) {
            setTimeout(() => emailRef.current?.focus(), 50);
        }
    }, [open]);

    const handleInvite = async () => {
        if (!organizationId) {
            toast.error("Organization ID is missing.");
            return;
        }
        if (!email) {
            toast.error("Please enter an email");
            return;
        }
        const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRe.test(email)) {
            toast.error("Enter a valid email address");
            return;
        }

        try {
            setIsSubmitting(true);
            let userId: string | undefined;
            const token = await getSessionToken();

            const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`,
                },
                body: JSON.stringify({ action: "org", organizationId, emails: [email], role }),
            });

            if (!response.ok) {
                // Try to parse the error if it is a stringified JSON
                let msg = response.statusText || "Unknown error";
                try {
                    const body = await response.json();
                    if (body.error) msg = body.error;
                } catch (parseErr) {
                    // ignore
                    console.error(parseErr);
                }
                throw new Error(msg);
            }

            toast.success("Invite sent");
            setEmail("");
            setRole("member");
            onBtnOpenChange(false);
            const data = await response.json();
            if (data.results.length > 0) {
                data.results.forEach((result: any) => {
                    if (result.success) {
                        toast.success("Invite sent successfully to " + result.email);
                        if (result.invitation && onInviteSent) {
                            onInviteSent(result.invitation);
                        }
                    } else {
                        toast.error(result.error);
                    }
                });
            } else {
                onInviteSent?.(data);
            }
        } catch (e: any) {
            console.error(e);
            let msg = "Failed to send invite";
            if (e.message) {
                // Try to see if message is JSON
                try {
                    const parsed = JSON.parse(e.message);
                    if (parsed.error) msg = parsed.error;
                    else msg = e.message;
                } catch {
                    msg = e.message;
                }
            }
            toast.error(msg);
        } finally {
            setIsSubmitting(false);
        }
    };



    const onBtnOpenChange = (val: boolean) => {
        if (!val) {
            // reset logic if needed or just close
        }
        onOpenChange(val);
    };

    return (
        <Dialog open={open} onOpenChange={onBtnOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Invite Team Member</DialogTitle>
                    <DialogDescription>
                        Send an invitation email to add a new member to your organization.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    <div className="space-y-2">
                        <Label htmlFor="invite-email">Email Address</Label>
                        <Input
                            id="invite-email"
                            placeholder="colleague@company.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            ref={emailRef}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="invite-role">Role</Label>
                        <Select
                            value={role}
                            onValueChange={(v) => setRole(v as "member" | "admin")}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Select role" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="member">
                                    <div className="flex flex-col">
                                        <span className="font-medium">Member</span>
                                        <span className="text-xs text-muted-foreground">
                                            Can view and edit projects
                                        </span>
                                    </div>
                                </SelectItem>
                                <SelectItem value="admin">
                                    <div className="flex flex-col">
                                        <span className="font-medium">Admin</span>
                                        <span className="text-xs text-muted-foreground">
                                            Full access to organization settings
                                        </span>
                                    </div>
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onBtnOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button onClick={handleInvite} disabled={isSubmitting}>
                        {isSubmitting ? "Sending..." : "Send Invitation"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
