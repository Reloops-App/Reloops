import { useState } from "react";
import { useNavigate } from "react-router-dom";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";
import { Dialog, DialogDescription, DialogHeader, DialogOverlay, DialogPortal, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface ShareAuthDialogProps {
    open: boolean;
    onIdentify: (identity: { type: "guest"; name: string; email: string }) => void;
    onClose: () => void;
    /**
     * `"comment"` — the user is already viewing the asset and tapped to comment.
     * Retitles the sheet, aligns the CTA with that intent, and drops the
     * Guest/Member segmented control (just name + email + a "Sign in" link) to
     * cut the "what kind of user am I?" decision before "I want to leave
     * feedback". Used by the mobile review shell. Omitted = the original
     * "View Shared Asset" dialog with tabs (desktop + every other caller).
     */
    context?: "comment";
}

export function ShareAuthDialog({ open, onIdentify, onClose, context }: ShareAuthDialogProps) {
    const navigate = useNavigate();
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const isComment = context === "comment";

    const handleGuestSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (name.trim() && email.trim()) {
            onIdentify({ type: "guest", name: name.trim(), email: email.trim() });
        }
    };

    const handleLogin = () => {
        // Navigate to the app's local auth page, passing the current path
        // (not the full origin-qualified URL — Auth.tsx passes this straight
        // into react-router's navigate(), which treats an absolute URL string
        // as a route-relative segment instead of following it) so the user is
        // redirected back after signing in.
        const returnPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        navigate(`/auth?redirectTo=${encodeURIComponent(returnPath)}`);
    };

    return (
        <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
            <DialogPortal>
                <DialogOverlay />
                {/*
                  Bottom sheet on mobile: anchored to the bottom edge so it stays
                  above the on-screen keyboard, `max-h-[90dvh] overflow-y-auto` so
                  the submit button is always reachable, safe-area padded. Reverts
                  to the standard centred modal from `sm` up.
                */}
                <DialogPrimitive.Content
                    onPointerDownOutside={(event) => event.preventDefault()}
                    onInteractOutside={(event) => event.preventDefault()}
                    className={cn(
                        "bg-background fixed z-50 grid gap-4 border shadow-lg duration-200",
                        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
                        "inset-x-0 bottom-0 max-h-[90dvh] overflow-y-auto rounded-t-2xl border-b-0 p-6",
                        "pb-[max(1.5rem,calc(env(safe-area-inset-bottom)+0.5rem))]",
                        "data-[state=open]:slide-in-from-bottom-4 data-[state=closed]:slide-out-to-bottom-4",
                        "sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2",
                        "sm:rounded-2xl sm:border-b sm:pb-6 sm:data-[state=open]:slide-in-from-bottom-0 sm:data-[state=open]:zoom-in-95 sm:data-[state=closed]:zoom-out-95",
                    )}
                >
                    <DialogHeader>
                        <DialogTitle>{isComment ? "Leave a comment" : "View Shared Asset"}</DialogTitle>
                        <DialogDescription>
                            {isComment
                                ? "Tell us who you are so your feedback can be attributed."
                                : "Please identify yourself to view and comment on this asset."}
                        </DialogDescription>
                    </DialogHeader>

                    {isComment ? (
                        <form onSubmit={handleGuestSubmit} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="name">Name</Label>
                                <Input
                                    id="name"
                                    placeholder="Jane Doe"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    enterKeyHint="next"
                                    autoComplete="name"
                                    autoFocus
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="email">Email</Label>
                                <Input
                                    id="email"
                                    type="email"
                                    placeholder="jane@example.com"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    enterKeyHint="go"
                                    autoComplete="email"
                                    required
                                />
                            </div>
                            <Button type="submit" className="w-full">
                                Continue to comment
                            </Button>
                            <button
                                type="button"
                                onClick={handleLogin}
                                className="w-full text-center text-sm text-primary hover:underline"
                            >
                                Already a member? Sign in
                            </button>
                        </form>
                    ) : (
                    <Tabs defaultValue="guest" className="w-full">
                        <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="guest">Guest</TabsTrigger>
                            <TabsTrigger value="login">Member</TabsTrigger>
                        </TabsList>
                        <TabsContent value="guest">
                            <form onSubmit={handleGuestSubmit} className="space-y-4 pt-4">
                                <div className="space-y-2">
                                    <Label htmlFor="name">Your Name</Label>
                                    <Input
                                        id="name"
                                        placeholder="Jane Doe"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        enterKeyHint="next"
                                        autoComplete="name"
                                        required
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="email">Email Address</Label>
                                    <Input
                                        id="email"
                                        type="email"
                                        placeholder="jane@example.com"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        enterKeyHint="go"
                                        autoComplete="email"
                                        required
                                    />
                                </div>
                                <Button type="submit" className="w-full">
                                    Continue as Guest
                                </Button>
                            </form>
                        </TabsContent>
                        <TabsContent value="login">
                            <div className="flex flex-col items-center justify-center space-y-4 pt-4 py-6">
                                <p className="text-center text-muted-foreground text-sm">
                                    Already have an account? Log in to access your workspace and history.
                                </p>
                                <Button onClick={handleLogin} variant="outline" className="w-full">
                                    Log In / Sign Up
                                </Button>
                            </div>
                        </TabsContent>
                    </Tabs>
                    )}
                    <DialogPrimitive.Close
                        className="ring-offset-background focus:ring-ring absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
                    >
                        <XIcon />
                        <span className="sr-only">Close</span>
                    </DialogPrimitive.Close>
                </DialogPrimitive.Content>
            </DialogPortal>
        </Dialog>
    );
}
